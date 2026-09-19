import { corsOptions, json, mailboxHealth } from "../_check_shared.js";

export async function onRequestOptions() {
  return corsOptions();
}

export async function onRequestGet(context) {
  return json(await mailboxHealth(context.env));
}

export async function onRequest(context) {
  if (context.request.method === "OPTIONS") return onRequestOptions();
  if (context.request.method === "GET") return onRequestGet(context);
  return json({ ok: false, error: "method_not_allowed" }, 405);
}
