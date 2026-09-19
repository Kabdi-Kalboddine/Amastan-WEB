import {
  agentConfigured,
  clientFromRequest,
  corsOptions,
  createLiveCheck,
  json,
  labOnline,
  normalizeUrl,
} from "./_check_shared.js";

export async function onRequestOptions() {
  return corsOptions();
}

export async function onRequestPost(context) {
  let body;
  try {
    body = await context.request.json();
  } catch {
    return json({ ok: false, error: "invalid_json" }, 400);
  }

  const url = body && body.url;
  const client = clientFromRequest(context.request);
  const env = context.env;

  if (!normalizeUrl(url)) {
    return json({ ok: false, error: "invalid_url" }, 400);
  }

  // Live-only: never answer with demo policy on the public site.
  if (!agentConfigured(env)) {
    return json({ ok: false, error: "agent_unconfigured" }, 503);
  }
  if (!(await labOnline(env))) {
    return json({ ok: false, error: "lab_offline" }, 503);
  }

  const live = await createLiveCheck(env, url, client);
  if (live.payload) return json(live.payload);
  return json({ ok: false, error: live.error || "invalid_url" }, live.code || 400);
}

export async function onRequest(context) {
  if (context.request.method === "OPTIONS") return onRequestOptions();
  if (context.request.method === "POST") return onRequestPost(context);
  return json({ ok: false, error: "method_not_allowed" }, 405);
}
