import { agentAuthorized, agentClaim, corsOptions, json } from "../_check_shared.js";

export async function onRequestOptions() {
  return corsOptions();
}

export async function onRequestPost(context) {
  if (!agentAuthorized(context.request, context.env)) {
    return json({ ok: false, error: "unauthorized" }, 401);
  }
  try {
    await context.request.json();
  } catch {
    /* empty ok */
  }
  const job = await agentClaim(context.env);
  if (!job) {
    return new Response(null, {
      status: 204,
      headers: {
        "access-control-allow-origin": "*",
        "cache-control": "no-store",
      },
    });
  }
  return json(job);
}

export async function onRequest(context) {
  if (context.request.method === "OPTIONS") return onRequestOptions();
  if (context.request.method === "POST") return onRequestPost(context);
  return json({ ok: false, error: "method_not_allowed" }, 405);
}
