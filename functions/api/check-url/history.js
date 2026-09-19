import { corsOptions, json, listHistory } from "../_check_shared.js";

export async function onRequestOptions() {
  return corsOptions();
}

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const limit = url.searchParams.get("limit") || "50";
  const data = await listHistory(context.env, limit);
  return json(data);
}

export async function onRequest(context) {
  if (context.request.method === "OPTIONS") return onRequestOptions();
  if (context.request.method === "GET") return onRequestGet(context);
  return json({ ok: false, error: "method_not_allowed" }, 405);
}
