import { corsOptions, json, markVerdictSeen } from "../../../_check_shared.js";

export async function onRequestOptions() {
  return corsOptions();
}

export async function onRequestPost(context) {
  const parts = new URL(context.request.url).pathname.split("/").filter(Boolean);
  // /api/check-url/jobs/:id/seen
  const jobsIdx = parts.indexOf("jobs");
  const jobId = jobsIdx >= 0 ? parts[jobsIdx + 1] || "" : "";
  if (!jobId) return json({ ok: false, error: "not_found" }, 404);
  const job = await markVerdictSeen(context.env, jobId);
  if (!job) return json({ ok: false, error: "not_found" }, 404);
  return json(job);
}

export async function onRequest(context) {
  if (context.request.method === "OPTIONS") return onRequestOptions();
  if (context.request.method === "POST") return onRequestPost(context);
  return json({ ok: false, error: "method_not_allowed" }, 405);
}
