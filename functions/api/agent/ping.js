import { agentAuthorized, agentPing, corsOptions, json } from "../_check_shared.js";

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
    /* empty body ok */
  }
  await agentPing(context.env);
  return json({ ok: true, lab_online: true });
}

export async function onRequest(context) {
  if (context.request.method === "OPTIONS") return onRequestOptions();
  if (context.request.method === "POST") return onRequestPost(context);
  return json({ ok: false, error: "method_not_allowed" }, 405);
}
