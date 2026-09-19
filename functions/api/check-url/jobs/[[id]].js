import { corsOptions, json, markVerdictSeen, readJob } from "../../_check_shared.js";

export async function onRequestOptions() {
  return corsOptions();
}

function parseJobPath(pathname) {
  const parts = pathname.split("/").filter(Boolean);
  // /api/check-url/jobs/:id[/seen]
  const jobsIdx = parts.indexOf("jobs");
  if (jobsIdx < 0 || jobsIdx + 1 >= parts.length) return { jobId: "", seen: false };
  const jobId = parts[jobsIdx + 1] || "";
  const seen = parts[jobsIdx + 2] === "seen";
  if (jobId === "jobs" || jobId === "history" || jobId === "health") {
    return { jobId: "", seen: false };
  }
  return { jobId, seen };
}

export async function onRequestGet(context) {
  const { jobId, seen } = parseJobPath(new URL(context.request.url).pathname);
  if (!jobId || seen) return json({ ok: false, error: "not_found" }, 404);
  const job = await readJob(context.env, jobId);
  if (!job) return json({ ok: false, error: "not_found" }, 404);
  return json(job);
}

export async function onRequestPost(context) {
  const { jobId, seen } = parseJobPath(new URL(context.request.url).pathname);
  if (!jobId || !seen) return json({ ok: false, error: "not_found" }, 404);
  const job = await markVerdictSeen(context.env, jobId);
  if (!job) return json({ ok: false, error: "not_found" }, 404);
  return json(job);
}

export async function onRequest(context) {
  if (context.request.method === "OPTIONS") return onRequestOptions();
  if (context.request.method === "GET") return onRequestGet(context);
  if (context.request.method === "POST") return onRequestPost(context);
  return json({ ok: false, error: "method_not_allowed" }, 405);
}
