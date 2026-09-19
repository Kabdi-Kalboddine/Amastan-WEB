import {
  agentAuthorized,
  agentComplete,
  agentFail,
  corsOptions,
  isJobId,
  json,
} from "../_check_shared.js";

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
    return json({ ok: false, error: "invalid_json" }, 400);
  }
  const jobId = String(body.job_id || "");
  if (!isJobId(jobId)) {
    return json({ ok: false, error: "invalid_job" }, 400);
  }
  let ok;
  if (body.error) {
    ok = await agentFail(context.env, jobId, String(body.error));
  } else {
    ok = await agentComplete(context.env, jobId, body);
  }
  if (!ok) return json({ ok: false, error: "not_found" }, 404);
  return json({ ok: true });
}

export async function onRequest(context) {
  if (context.request.method === "OPTIONS") return onRequestOptions();
  if (context.request.method === "POST") return onRequestPost(context);
  return json({ ok: false, error: "method_not_allowed" }, 405);
}
