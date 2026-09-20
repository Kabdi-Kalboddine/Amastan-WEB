/**
 * POST /api/contact — website intake webhook, then Resend only if it fails.
 *
 * Signs HMAC-SHA256(secret, timestamp + '.' + idempotency UUID + '.' + raw JSON)
 * and POSTs that exact body to SaaS POST /public/intake (docs/INTAKE-HMAC.md).
 * Do not send classify, URL-check, or cloud-SWG fields.
 *
 * Secrets / vars (Cloudflare Pages → Settings → Environment variables):
 *   AMASTAN_INTAKE_HMAC_SECRET  (secret, same value as the VPS)
 *   AMASTAN_INTAKE_URL          (plain, e.g. https://saas.example.com/public/intake)
 *   RESEND_API_KEY              (secret, fallback only)
 *   CONTACT_TO                  (plain, default kabdi.kalboddine@gmail.com)
 *   CONTACT_FROM                (plain, default Amastan <onboarding@resend.dev>)
 */
const ALLOWED_INTEREST = new Set([
  "pilot",
  "lab",
  "vm",
  "download",
  "compute",
  "support",
  "partner",
  "feature",
  "features",
  "other",
]);
const INTEREST_TO_INTAKE = {
  features: "feature",
};
const DEFAULT_TO = "kabdi.kalboddine@gmail.com";
const DEFAULT_FROM = "Amastan <onboarding@resend.dev>";
const MAX_LEN = {
  name: 120,
  email: 200,
  company: 160,
  country: 80,
  interest: 40,
  message: 4000,
  language: 16,
  utm: 200,
};
const INTAKE_MAX_MESSAGE = 4000;

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

function mapInterest(raw) {
  const value = clean(raw, MAX_LEN.interest);
  if (!ALLOWED_INTEREST.has(value)) return "";
  return INTEREST_TO_INTAKE[value] || value;
}

function utmField(value) {
  const text = clean(value, MAX_LEN.utm);
  return text || undefined;
}

function readUtm(body) {
  const raw = body && body.utm;
  if (typeof raw === "string") {
    const source = utmField(raw);
    return source ? source : undefined;
  }
  if (!raw || typeof raw !== "object") return undefined;
  const utm = {};
  const source = utmField(raw.source);
  const medium = utmField(raw.medium);
  const campaign = utmField(raw.campaign);
  if (source) utm.source = source;
  if (medium) utm.medium = medium;
  if (campaign) utm.campaign = campaign;
  return Object.keys(utm).length ? utm : undefined;
}

function composeMessage(payload) {
  const parts = [];
  if (payload.message) parts.push(payload.message);
  const meta = [];
  if (payload.company) meta.push(`Company: ${payload.company}`);
  if (payload.country) meta.push(`Country: ${payload.country}`);
  if (payload.language) meta.push(`Language: ${payload.language}`);
  if (meta.length) {
    if (parts.length) parts.push("");
    parts.push(...meta);
  }
  const text = parts.join("\n");
  return text ? text.slice(0, INTAKE_MAX_MESSAGE) : "";
}

function intakeJson(payload) {
  const body = {
    name: payload.name,
    email: payload.email,
  };
  if (payload.interest) body.interest = payload.interest;
  if (payload.utm) body.utm = payload.utm;
  if (payload.message) body.message = payload.message;
  return JSON.stringify(body);
}

function hex(buffer) {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function signIntake(secret, timestamp, idempotency, rawBody) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const payload = enc.encode(`${timestamp}.${idempotency}.${rawBody}`);
  const digest = await crypto.subtle.sign("HMAC", key, payload);
  return hex(digest);
}

async function postIntake(env, rawBody) {
  const secret = (env.AMASTAN_INTAKE_HMAC_SECRET || "").trim();
  const url = (env.AMASTAN_INTAKE_URL || "").trim();
  if (!secret || !url) return { ok: false, reason: "not_configured" };

  const timestamp = String(Math.floor(Date.now() / 1000));
  const idempotency = crypto.randomUUID();
  const signature = await signIntake(secret, timestamp, idempotency, rawBody);

  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "X-Amastan-Signature": signature,
        "X-Amastan-Timestamp": timestamp,
        "X-Amastan-Idempotency-Key": idempotency,
      },
      body: rawBody,
    });
  } catch {
    console.error("intake_failed", "network");
    return { ok: false, reason: "webhook_failed" };
  }

  const data = await res.json().catch(() => ({}));
  if (res.ok && data.accepted === true) {
    return { ok: true, id: data.id, ackId: data.ackId };
  }
  console.error("intake_failed", res.status);
  return { ok: false, reason: "webhook_failed" };
}

async function sendResend(env, payload) {
  const apiKey = (env.RESEND_API_KEY || "").trim();
  if (!apiKey) return { ok: false, reason: "not_configured" };

  const to = clean(env.CONTACT_TO, 200) || DEFAULT_TO;
  const from = clean(env.CONTACT_FROM, 200) || DEFAULT_FROM;
  const subject =
    payload.interest === "pilot" || payload.interest === "lab"
      ? `Amastan pilot request — ${payload.company || payload.name}`
      : `[Amastan] ${payload.interest || "lead"} — ${payload.company || payload.name}`;

  const text = [
    `Name: ${payload.name}`,
    `Email: ${payload.email}`,
    `Company: ${payload.company || "-"}`,
    `Country: ${payload.country || "-"}`,
    `Interest: ${payload.interest || "lead"}`,
    `Language: ${payload.language}`,
    "",
    payload.message || "Request from the Amastan website.",
  ].join("\n");

  const html = `
    <h2>Amastan contact</h2>
    <p><b>Name:</b> ${escapeHtml(payload.name)}<br/>
    <b>Email:</b> ${escapeHtml(payload.email)}<br/>
    <b>Company:</b> ${escapeHtml(payload.company || "-")}<br/>
    <b>Country:</b> ${escapeHtml(payload.country || "-")}<br/>
    <b>Interest:</b> ${escapeHtml(payload.interest || "lead")}<br/>
    <b>Language:</b> ${escapeHtml(payload.language)}</p>
    <hr/>
    <pre style="white-space:pre-wrap;font-family:inherit">${escapeHtml(
      payload.message || "Request from the Amastan website.",
    )}</pre>
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
    console.error("resend_failed", res.status);
    return { ok: false, reason: "send_failed" };
  }
  return { ok: true };
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
    interest: mapInterest(body.interest),
    message: clean(body.message, MAX_LEN.message),
    language: clean(body.language, MAX_LEN.language) || "en",
    utm: readUtm(body),
  };

  if (!payload.name || !payload.email) {
    return json({ ok: false, error: "missing_fields" }, 400, headers);
  }
  if (!validEmail(payload.email)) {
    return json({ ok: false, error: "invalid_email" }, 400, headers);
  }

  const rawBody = intakeJson({
    name: payload.name,
    email: payload.email,
    interest: payload.interest,
    utm: payload.utm,
    message: composeMessage(payload),
  });

  const intake = await postIntake(env, rawBody);
  if (intake.ok) {
    return json({ ok: true, id: intake.id, ackId: intake.ackId }, 200, headers);
  }

  const mailed = await sendResend(env, payload);
  if (mailed.ok) {
    return json({ ok: true }, 200, headers);
  }
  if (mailed.reason === "not_configured") {
    return json({ ok: false, error: "not_configured" }, 503, headers);
  }
  return json({ ok: false, error: "send_failed" }, 502, headers);
}

export async function onRequest(context) {
  if (context.request.method === "OPTIONS") return onRequestOptions(context);
  if (context.request.method === "POST") return onRequestPost(context);
  return json({ ok: false, error: "method_not_allowed" }, 405, corsHeaders(context.request));
}
