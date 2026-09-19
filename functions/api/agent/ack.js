import { agentAck, agentAuthorized, corsOptions, json } from "../_check_shared.js";

export async function onRequestOptions() {
  return corsOptions();
}

export async function onRequestPost(context) {
  if (!agentAuthorized(context.request, context.env)) {
    return json({ ok: false, error: "unauthorized" }, 401);
  }
  let body = {};
  try {
    body = await context.request.json();
  } catch {
    body = {};
  }
  const ids = body.job_ids || body.ids || [];
  return json(await agentAck(context.env, Array.isArray(ids) ? ids : []));
}

export async function onRequest(context) {
  if (context.request.method === "OPTIONS") return onRequestOptions();
  if (context.request.method === "POST") return onRequestPost(context);
  return json({ ok: false, error: "method_not_allowed" }, 405);
}
