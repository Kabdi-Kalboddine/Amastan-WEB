/**
 * POST /api/contact — send pilot/contact requests via Resend.
 *
 * Secrets / vars (Cloudflare Pages → Settings → Environment variables):
 *   RESEND_API_KEY   (secret, required)
 *   CONTACT_TO       (plain, default kabdi.kalboddine@gmail.com)
 *   CONTACT_FROM     (plain, default Amastan <onboarding@resend.dev>
 *                    — switch to noreply@amastansolution.com after Resend domain verify)
 */
const ALLOWED_INTEREST = new Set([
  "pilot",
  "vm",
  "compute",
  "support",
  "partner",
  "features",
  "other",
]);
const DEFAULT_TO = "kabdi.kalboddine@gmail.com";
const DEFAULT_FROM = "Amastan <onboarding@resend.dev>";
const MAX_LEN = {
  name: 120,
  email: 200,
  company: 160,
  country: 80,
  interest: 40,
  message: 5000,
  language: 16,
};

function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...extra,
    },
  });
}

function corsHeaders(request) {
  const origin = request.headers.get("Origin") || "";
  const allowed =
    !origin ||
    origin.endsWith("amastansolution.com") ||
    origin.endsWith("amastan-website.pages.dev") ||
    origin.endsWith("amastan-site.pages.dev") ||
    origin.startsWith("http://127.0.0.1") ||
    origin.startsWith("http://localhost");
  if (!allowed) return {};
  return {
    "access-control-allow-origin": origin || "*",
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "content-type",
  };
}

function clean(value, max) {
  return String(value || "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .trim()
    .slice(0, max);
}

function validEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= MAX_LEN.email;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export async function onRequestOptions(context) {
  return new Response(null, { status: 204, headers: corsHeaders(context.request) });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const headers = corsHeaders(request);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "invalid_json" }, 400, headers);
  }

  // Honeypot — bots fill this; humans never see it.
  if (clean(body.website, 200)) {
    return json({ ok: true }, 200, headers);
  }

  const payload = {
    name: clean(body.name, MAX_LEN.name),
    email: clean(body.email, MAX_LEN.email).toLowerCase(),
    company: clean(body.company, MAX_LEN.company),
    country: clean(body.country, MAX_LEN.country),
    interest: ALLOWED_INTEREST.has(clean(body.interest, MAX_LEN.interest))
      ? clean(body.interest, MAX_LEN.interest)
      : "pilot",
    message: clean(body.message, MAX_LEN.message),
    language: clean(body.language, MAX_LEN.language) || "en",
  };

  if (!payload.name || !payload.email) {
    return json({ ok: false, error: "missing_fields" }, 400, headers);
  }
  if (!validEmail(payload.email)) {
    return json({ ok: false, error: "invalid_email" }, 400, headers);
  }
  if (!payload.message) {
    payload.message = "Request from the Amastan website.";
  }

  const apiKey = (env.RESEND_API_KEY || "").trim();
  if (!apiKey) {
    return json({ ok: false, error: "not_configured" }, 503, headers);
  }

  const to = clean(env.CONTACT_TO, 200) || DEFAULT_TO;
  const from = clean(env.CONTACT_FROM, 200) || DEFAULT_FROM;
  const subject =
    payload.interest === "pilot"
      ? `Amastan pilot request — ${payload.company || payload.name}`
      : `[Amastan] ${payload.interest} — ${payload.company || payload.name}`;

  const text = [
    `Name: ${payload.name}`,
    `Email: ${payload.email}`,
    `Company: ${payload.company || "-"}`,
    `Country: ${payload.country || "-"}`,
    `Interest: ${payload.interest}`,
    `Language: ${payload.language}`,
    "",
    payload.message,
  ].join("\n");

  const html = `
    <h2>Amastan contact</h2>
    <p><b>Name:</b> ${escapeHtml(payload.name)}<br/>
    <b>Email:</b> ${escapeHtml(payload.email)}<br/>
    <b>Company:</b> ${escapeHtml(payload.company || "-")}<br/>
    <b>Country:</b> ${escapeHtml(payload.country || "-")}<br/>
    <b>Interest:</b> ${escapeHtml(payload.interest)}<br/>
    <b>Language:</b> ${escapeHtml(payload.language)}</p>
    <hr/>
    <pre style="white-space:pre-wrap;font-family:inherit">${escapeHtml(payload.message)}</pre>
  `;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [to],
      reply_to: payload.email,
      subject,
      text,
      html,
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    console.error("resend_failed", res.status, detail.slice(0, 500));
    return json({ ok: false, error: "send_failed" }, 502, headers);
  }

  return json({ ok: true }, 200, headers);
}

export async function onRequest(context) {
  if (context.request.method === "OPTIONS") return onRequestOptions(context);
  if (context.request.method === "POST") return onRequestPost(context);
  return json({ ok: false, error: "method_not_allowed" }, 405, corsHeaders(context.request));
}
