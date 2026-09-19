import { agentAuthorized, agentInbox, corsOptions, json } from "../_check_shared.js";

export async function onRequestOptions() {
  return corsOptions();
}

export async function onRequestGet(context) {
  if (!agentAuthorized(context.request, context.env)) {
    return json({ ok: false, error: "unauthorized" }, 401);
  }
  return json(await agentInbox(context.env));
}

export async function onRequest(context) {
  if (context.request.method === "OPTIONS") return onRequestOptions();
  if (context.request.method === "GET") return onRequestGet(context);
  return json({ ok: false, error: "method_not_allowed" }, 405);
}
