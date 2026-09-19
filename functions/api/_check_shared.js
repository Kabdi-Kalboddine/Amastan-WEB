/**
 * Shared Check URL helpers for Cloudflare Pages Functions (demo policy + history).
 */
const ALLOW_HOSTS = new Set([
  "example.com",
  "www.example.com",
  "wikipedia.org",
  "www.wikipedia.org",
  "en.wikipedia.org",
  "google.com",
  "www.google.com",
  "github.com",
  "microsoft.com",
  "apple.com",
  "cloudflare.com",
]);

const BLOCK_EXACT = {
  "malware-test.amastan.demo": ["malware", "Matched demo malware block list"],
  "phishing-login.amastan.demo": ["phishing", "Matched demo phishing block list"],
  "casino-offers.amastan.demo": ["gambling", "Matched demo gambling policy"],
};

const BLOCK_KEYWORDS = [
  ["phish", "phishing", "Suspected phishing pattern in hostname"],
  ["malware", "malware", "Suspected malware pattern in hostname"],
  ["casino", "gambling", "Gambling category policy"],
  ["bet365", "gambling", "Gambling category policy"],
  ["porn", "adult", "Adult content category policy"],
];

const RBI_KEYWORDS = ["pastebin", "raw.githubusercontent"];
const HISTORY_KEY = "https://amastansolution.com/__amastan_check_history_v1";
const JOB_KEY_PREFIX = "https://amastansolution.com/__amastan_check_job_v1/";
const MAX_HISTORY = 200;

export function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "access-control-allow-origin": "*",
      ...extra,
    },
  });
}

export function corsOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET, POST, OPTIONS",
      "access-control-allow-headers": "content-type, authorization",
    },
  });
}

export function normalizeUrl(raw) {
  let text = String(raw || "").trim();
  if (!text || text.length > 2048) return null;
  if (!text.includes("://")) text = "https://" + text;
  let parsed;
  try {
    parsed = new URL(text);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  if (parsed.username || parsed.password) return null;
  let host = (parsed.hostname || "").toLowerCase().replace(/^\.+|\.+$/g, "");
  if (!host || !/^[a-z0-9.-]+$/.test(host)) return null;
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return null;
  const labels = host.split(".").filter(Boolean);
  const isIp = /^\d{1,3}(\.\d{1,3}){3}$/.test(host);
  if (!isIp) {
    if (labels.length < 2) return null;
    if (!host.startsWith("www.")) host = "www." + host;
  }
  const path = parsed.pathname || "/";
  const query = parsed.search || "";
  return { url: `${parsed.protocol}//${host}${path}${query}`, host, path, query };
}

export function destinationMeta(url, host) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    parsed = null;
  }
  const labels = String(host || "")
    .split(".")
    .filter(Boolean);
  const registered = labels.length >= 2 ? labels.slice(-2).join(".") : host || "";
  return {
    scheme: parsed ? parsed.protocol.replace(":", "") : "",
    host: host || "",
    path: (parsed && parsed.pathname) || "/",
    has_query: Boolean(parsed && parsed.search),
    registered_domain: String(registered).slice(0, 253),
    is_https: Boolean(parsed && parsed.protocol === "https:"),
  };
}

export function clientFromRequest(request) {
  const cf = request.cf || {};
  const fwd = request.headers.get("X-Forwarded-For") || "";
  const ip =
    request.headers.get("CF-Connecting-IP") ||
    fwd.split(",")[0].trim() ||
    "";
  const out = {};
  if (ip) out.ip = String(ip).slice(0, 45);
  if (cf.country) out.country = String(cf.country).toUpperCase().slice(0, 2);
  if (cf.asn) out.asn = `AS${cf.asn}`;
  if (cf.colo) out.colo = String(cf.colo).slice(0, 8);
  return out;
}

export function demoClassify(url, host) {
  const lowerUrl = String(url || "").toLowerCase();
  const h = String(host || "").toLowerCase();

  // Google Safe Browsing intentional test hosts (public QA URLs).
  if (
    h.includes("testsafebrowsing.appspot.com") ||
    h.includes("testsafebrowsing.withgoogle.com")
  ) {
    if (lowerUrl.includes("social_engineering")) {
      return {
        verdict: "block",
        category: "phishing",
        reason: "Google Safe Browsing social-engineering test URL",
        confidence: 0.99,
        source: "demo-policy",
      };
    }
    if (lowerUrl.includes("malware")) {
      return {
        verdict: "block",
        category: "malware",
        reason: "Google Safe Browsing malware test URL",
        confidence: 0.99,
        source: "demo-policy",
      };
    }
    if (lowerUrl.includes("unwanted")) {
      return {
        verdict: "block",
        category: "unwanted-software",
        reason: "Google Safe Browsing unwanted-software test URL",
        confidence: 0.99,
        source: "demo-policy",
      };
    }
    return {
      verdict: "block",
      category: "threat-test",
      reason: "Google Safe Browsing test host",
      confidence: 0.95,
      source: "demo-policy",
    };
  }

  if (BLOCK_EXACT[host]) {
    const [category, reason] = BLOCK_EXACT[host];
    return { verdict: "block", category, reason, confidence: 0.99, source: "demo-policy" };
  }
  for (const [needle, category, reason] of BLOCK_KEYWORDS) {
    if (host.includes(needle)) {
      return { verdict: "block", category, reason, confidence: 0.92, source: "demo-policy" };
    }
  }
  for (const needle of RBI_KEYWORDS) {
    if (host.includes(needle)) {
      return {
        verdict: "rbi",
        category: "untrusted-content",
        reason: "Host marked for Remote Browser Isolation in demo policy",
        confidence: 0.8,
        source: "demo-policy",
      };
    }
  }
  if (ALLOW_HOSTS.has(host) || host.endsWith(".example.com")) {
    return {
      verdict: "allow",
      category: "business",
      reason: "Matched demo allow list",
      confidence: 0.97,
      source: "demo-policy",
    };
  }
  return {
    verdict: "unknown",
    category: "unknown",
    reason: "No demo policy matched. Live lab did not classify this host.",
    confidence: 0.2,
    source: "demo-fallback",
  };
}

async function readHistory(env) {
  if (env && env.CHECK_HISTORY) {
    const raw = await env.CHECK_HISTORY.get("items", "json");
    if (Array.isArray(raw)) return raw;
  }
  try {
    const cache = caches.default;
    const hit = await cache.match(HISTORY_KEY);
    if (hit) {
      const data = await hit.json();
      if (Array.isArray(data.items)) return data.items;
      if (Array.isArray(data)) return data;
    }
  } catch {
    /* ignore */
  }
  return [];
}

async function writeHistory(env, items) {
  const trimmed = items.slice(0, MAX_HISTORY);
  if (env && env.CHECK_HISTORY) {
    await env.CHECK_HISTORY.put("items", JSON.stringify(trimmed));
  }
  try {
    const cache = caches.default;
    const body = JSON.stringify({ ok: true, updated_at: Date.now() / 1000, items: trimmed });
    await cache.put(
      HISTORY_KEY,
      new Response(body, {
        headers: {
          "content-type": "application/json",
          "cache-control": "public, max-age=31536000",
        },
      }),
    );
  } catch {
    /* ignore */
  }
}

export async function recordHistory(env, entry) {
  const host = String(entry.host || "").toLowerCase();
  if (!host) return;
  const items = (await readHistory(env)).filter((i) => i && i.host !== host);
  items.unshift({
    url: String(entry.url || "").slice(0, 2048),
    host: host.slice(0, 253),
    verdict: String(entry.verdict || "unknown").toLowerCase().slice(0, 40),
    category: String(entry.category || "n/a").slice(0, 200),
    reason: String(entry.reason || "").slice(0, 400),
    source: String(entry.source || "").slice(0, 80),
    mode: String(entry.mode || "demo").slice(0, 40),
    checked_at: Date.now() / 1000,
  });
  await writeHistory(env, items);
}

export async function listHistory(env, limit = 50) {
  const lim = Math.max(1, Math.min(Number(limit) || 50, 100));
  const items = (await readHistory(env)).slice(0, lim);
  return {
    ok: true,
    count: items.length,
    updated_at: items[0] ? items[0].checked_at : 0,
    items,
  };
}

const JOB_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const META_PING = "mailbox:last_ping";
const META_LIVE = "mailbox:live_created";
const META_QUEUE = "mailbox:queue";
const MAIL_CACHE_PREFIX = "https://amastansolution.com/__amastan_mailbox_v1/";

function kv(env) {
  return env && env.CHECK_HISTORY ? env.CHECK_HISTORY : null;
}

function numEnv(env, key, fallback) {
  const n = Number(env && env[key]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function agentConfigured(env) {
  const token = String((env && env.AMASTAN_AGENT_TOKEN) || "").trim();
  // Demo mode is disabled on the public site permanently.
  return Boolean(token);
}

export function agentAuthorized(request, env) {
  const token = String((env && env.AMASTAN_AGENT_TOKEN) || "").trim();
  if (!token) return false;
  const header = request.headers.get("Authorization") || "";
  if (!header.toLowerCase().startsWith("bearer ")) return false;
  const offered = header.slice(7).trim();
  if (offered.length !== token.length) return false;
  let ok = true;
  for (let i = 0; i < token.length; i += 1) {
    if (offered.charCodeAt(i) !== token.charCodeAt(i)) ok = false;
  }
  return ok;
}

export function isJobId(id) {
  return JOB_ID_RE.test(String(id || ""));
}

async function cacheGetJson(key, fallback) {
  try {
    const hit = await caches.default.match(MAIL_CACHE_PREFIX + encodeURIComponent(key));
    if (!hit) return fallback;
    const data = await hit.json();
    return data && Object.prototype.hasOwnProperty.call(data, "v") ? data.v : fallback;
  } catch {
    return fallback;
  }
}

async function cachePutJson(key, value, ttlSec = 600) {
  try {
    const body = JSON.stringify({ v: value, t: Date.now() / 1000 });
    await caches.default.put(
      MAIL_CACHE_PREFIX + encodeURIComponent(key),
      new Response(body, {
        headers: {
          "content-type": "application/json",
          "cache-control": `public, max-age=${Math.max(60, Math.floor(ttlSec))}`,
        },
      }),
    );
  } catch {
    /* ignore */
  }
}

async function getJson(store, key, fallback) {
  if (store) {
    try {
      const raw = await store.get(key, "json");
      if (raw != null) return raw;
    } catch {
      /* fall through to cache */
    }
  }
  return cacheGetJson(key, fallback);
}

async function putJson(store, key, value, ttlSec = 600) {
  if (store) {
    try {
      await store.put(key, JSON.stringify(value), {
        expirationTtl: Math.max(60, Math.floor(ttlSec)),
      });
    } catch {
      /* still write cache */
    }
  }
  await cachePutJson(key, value, ttlSec);
}

export function publicResult(job) {
  if (!job || !job.id) return null;
  const live = job.live;
  const doneLive = job.status === "done" && live && typeof live === "object";
  let mode;
  let verdict = null;
  let category = null;
  let reason = "";
  let confidence = null;
  let source = null;
  let latency_ms = null;
  if (doneLive) {
    mode = "live";
    verdict = live.verdict || "unknown";
    category = live.category || "n/a";
    reason = live.reason || "";
    confidence = live.confidence;
    source = live.source || "sidecar";
    latency_ms = live.latency_ms;
  } else if (job.status === "queued" || job.status === "running") {
    mode = "pending";
  } else if (job.status === "demo_only" && job.demo) {
    mode = "demo";
    verdict = job.demo.verdict;
    category = job.demo.category;
    reason = job.demo.reason || "";
    confidence = job.demo.confidence;
    source = job.demo.source;
  } else {
    mode = job.status || "error";
    reason = job.error || "Lab did not return a live verdict";
  }
  const client = job.client && typeof job.client === "object" ? job.client : {};
  const destination =
    job.destination && typeof job.destination === "object"
      ? job.destination
      : destinationMeta(job.url, job.host);
  return {
    ok: true,
    job_id: job.id,
    status: job.status,
    lab_pending: job.status === "queued" || job.status === "running",
    new_url: job.status === "queued" || job.status === "running",
    new_verdict: Boolean(doneLive && !job.verdict_seen),
    mode,
    url: job.url,
    host: job.host,
    verdict,
    category,
    reason,
    confidence,
    source,
    latency_ms,
    client,
    destination,
  };
}

export function sanitizeLiveResult(payload) {
  const raw = payload && typeof payload === "object" ? payload : {};
  const verdict = String(raw.verdict || raw.action || raw.decision || "unknown")
    .trim()
    .toLowerCase();
  return {
    verdict: verdict || "unknown",
    category: String(raw.category || raw.cat || "n/a").slice(0, 200),
    reason: String(raw.reason || raw.message || raw.detail || "").slice(0, 500),
    confidence: raw.confidence != null ? raw.confidence : raw.score,
    source: "sidecar",
    latency_ms: raw.latency_ms,
  };
}

async function readInternalJob(env, jobId) {
  const id = String(jobId || "");
  if (!isJobId(id)) return null;
  const store = kv(env);
  if (store) {
    const raw = await store.get(`job:${id}`, "json");
    if (raw && raw.id) return raw;
  }
  try {
    const hit = await caches.default.match(JOB_KEY_PREFIX + encodeURIComponent(id));
    if (hit) {
      const data = await hit.json();
      if (data && data.id) return data;
      // Legacy public payload shape from earlier demo-only deploy.
      if (data && data.job_id) {
        return {
          id: data.job_id,
          url: data.url,
          host: data.host,
          status: data.status || "done",
          created_at: Date.now() / 1000,
          expires_at: Date.now() / 1000 + 600,
          live:
            data.mode === "live"
              ? {
                  verdict: data.verdict,
                  category: data.category,
                  reason: data.reason,
                  confidence: data.confidence,
                  source: data.source,
                  latency_ms: data.latency_ms,
                }
              : null,
          demo:
            data.mode === "demo"
              ? {
                  verdict: data.verdict,
                  category: data.category,
                  reason: data.reason,
                  confidence: data.confidence,
                  source: data.source,
                }
              : null,
          verdict_seen: !data.new_verdict,
          client: data.client || {},
          destination: data.destination || {},
        };
      }
    }
  } catch {
    /* ignore */
  }
  return null;
}

async function writeInternalJob(env, job, ttlSec = 600) {
  if (!job || !job.id) return;
  const body = JSON.stringify(job);
  const store = kv(env);
  if (store) {
    await store.put(`job:${job.id}`, body, { expirationTtl: Math.max(60, ttlSec) });
  }
  try {
    await caches.default.put(
      JOB_KEY_PREFIX + encodeURIComponent(job.id),
      new Response(body, {
        headers: {
          "content-type": "application/json",
          "cache-control": `public, max-age=${Math.max(60, ttlSec)}`,
        },
      }),
    );
  } catch {
    /* ignore */
  }
}

/** @deprecated use writeInternalJob / publicResult */
export async function storeJob(env, job) {
  if (!job) return;
  if (job.id) {
    await writeInternalJob(env, job);
    return;
  }
  if (job.job_id) {
    await writeInternalJob(env, {
      id: job.job_id,
      url: job.url,
      host: job.host,
      status: job.status || "done",
      created_at: Date.now() / 1000,
      expires_at: Date.now() / 1000 + 600,
      live: job.mode === "live" ? sanitizeLiveResult(job) : null,
      demo: job.mode === "demo" ? sanitizeLiveResult(job) : null,
      verdict_seen: false,
      client: job.client || {},
      destination: job.destination || {},
    });
  }
}

export async function readJob(env, jobId) {
  const job = await readInternalJob(env, jobId);
  return job ? publicResult(job) : null;
}

export async function labOnline(env) {
  if (!agentConfigured(env)) return false;
  const store = kv(env);
  const last = Number(await getJson(store, META_PING, 0)) || 0;
  const windowSec = numEnv(env, "AMASTAN_LAB_ONLINE_SEC", 20);
  return Date.now() / 1000 - last < windowSec;
}

export async function mailboxHealth(env) {
  const configured = agentConfigured(env);
  const online = await labOnline(env);
  const store = kv(env);
  const queueRaw = await getJson(store, META_QUEUE, []);
  const queue = Array.isArray(queueRaw) ? queueRaw : [];
  return {
    ok: true,
    demo: false,
    lab_online: online,
    live_queue_enabled: configured,
    agent_configured: configured,
    new_url: queue.length > 0,
    new_verdict: false,
    kv_bound: Boolean(store),
    storage: store ? "kv" : "cache",
  };
}

export async function agentPing(env) {
  const store = kv(env);
  await putJson(store, META_PING, Date.now() / 1000);
}

async function underLiveCap(env, now) {
  const store = kv(env);
  const max = numEnv(env, "AMASTAN_MAX_LIVE_PER_HOUR", 20);
  let stamps = await getJson(store, META_LIVE, []);
  if (!Array.isArray(stamps)) stamps = [];
  stamps = stamps.map(Number).filter((t) => now - t <= 3600);
  if (stamps.length >= max) {
    await putJson(store, META_LIVE, stamps);
    return false;
  }
  stamps.push(now);
  await putJson(store, META_LIVE, stamps);
  return true;
}

async function queueAdd(env, jobId) {
  const store = kv(env);
  let queue = await getJson(store, META_QUEUE, []);
  if (!Array.isArray(queue)) queue = [];
  if (!queue.includes(jobId)) queue.push(jobId);
  // Keep queue bounded.
  if (queue.length > 200) queue = queue.slice(-200);
  await putJson(store, META_QUEUE, queue);
}

async function queueRemove(env, jobIds) {
  const store = kv(env);
  const drop = new Set(jobIds);
  let queue = await getJson(store, META_QUEUE, []);
  if (!Array.isArray(queue)) queue = [];
  queue = queue.filter((id) => !drop.has(id));
  await putJson(store, META_QUEUE, queue);
}

export async function createLiveCheck(env, rawUrl, client) {
  const normalized = normalizeUrl(rawUrl);
  if (!normalized || !normalized.url) return { error: "invalid_url", code: 400 };

  if (!agentConfigured(env)) {
    return { error: "agent_unconfigured", code: 503 };
  }
  if (!(await labOnline(env))) {
    return { error: "lab_offline", code: 503 };
  }

  const now = Date.now() / 1000;
  const ttl = numEnv(env, "AMASTAN_JOB_TTL_SEC", 120);
  if (!(await underLiveCap(env, now))) {
    return { error: "live_busy", code: 429 };
  }

  const job = {
    id: crypto.randomUUID(),
    url: normalized.url,
    host: normalized.host,
    status: "queued",
    created_at: now,
    expires_at: now + ttl,
    live: null,
    demo: null,
    verdict_seen: false,
    client: client || {},
    destination: destinationMeta(normalized.url, normalized.host),
  };
  await writeInternalJob(env, job, ttl + 60);
  await queueAdd(env, job.id);
  const payload = publicResult(job);
  payload.lab_online = true;
  payload.queued_live = true;
  return { payload };
}

export async function createDemoCheck(env, rawUrl, client) {
  const normalized = normalizeUrl(rawUrl);
  if (!normalized) return { error: "invalid_url", code: 400 };
  const classified = demoClassify(normalized.url, normalized.host);
  const now = Date.now() / 1000;
  const job = {
    id: crypto.randomUUID(),
    url: normalized.url,
    host: normalized.host,
    status: "demo_only",
    created_at: now,
    expires_at: now + 600,
    live: null,
    demo: classified,
    verdict_seen: false,
    client: client || {},
    destination: destinationMeta(normalized.url, normalized.host),
  };
  await writeInternalJob(env, job, 600);
  await recordHistory(env, {
    ...classified,
    url: normalized.url,
    host: normalized.host,
    mode: "demo",
  });
  const payload = publicResult(job);
  // Match prior Cloudflare demo shape used by the verdict page cache path.
  payload.status = "done";
  payload.mode = "demo";
  payload.verdict = classified.verdict;
  payload.category = classified.category;
  payload.reason = classified.reason;
  payload.confidence = classified.confidence;
  payload.source = classified.source;
  payload.lab_pending = false;
  payload.new_url = false;
  payload.new_verdict = true;
  payload.lab_online = false;
  payload.queued_live = false;
  return { payload };
}

export async function agentInbox(env) {
  await agentPing(env);
  const store = kv(env);
  let queue = await getJson(store, META_QUEUE, []);
  if (!Array.isArray(queue)) queue = [];
  const urls = [];
  const stillQueued = [];
  const now = Date.now() / 1000;
  for (const id of queue) {
    const job = await readInternalJob(env, id);
    if (!job) continue;
    if (job.expires_at && job.expires_at <= now && (job.status === "queued" || job.status === "running")) {
      job.status = "timeout";
      await writeInternalJob(env, job, 120);
      continue;
    }
    if (job.status === "queued") {
      urls.push({ id: job.id, url: job.url, host: job.host });
      stillQueued.push(id);
    } else if (job.status === "running") {
      stillQueued.push(id);
    }
  }
  if (stillQueued.length !== queue.length) {
    await putJson(store, META_QUEUE, stillQueued);
  }
  return { ok: true, new_url: urls.length > 0, urls };
}

export async function agentAck(env, jobIds) {
  const ids = (Array.isArray(jobIds) ? jobIds : []).map(String).filter(isJobId);
  let taken = 0;
  const now = Date.now() / 1000;
  for (const id of ids) {
    const job = await readInternalJob(env, id);
    if (!job || job.status !== "queued") continue;
    job.status = "running";
    job.claimed_at = now;
    await writeInternalJob(env, job, Math.max(60, (job.expires_at || now + 120) - now + 60));
    taken += 1;
  }
  const inbox = await agentInbox(env);
  return { ok: true, taken, new_url: inbox.new_url };
}

export async function agentClaim(env) {
  const inbox = await agentInbox(env);
  const first = (inbox.urls || [])[0];
  if (!first) return null;
  await agentAck(env, [first.id]);
  return first;
}

export async function agentComplete(env, jobId, livePayload) {
  if (!isJobId(jobId)) return false;
  const job = await readInternalJob(env, jobId);
  if (!job || (job.status !== "queued" && job.status !== "running")) return false;
  job.live = sanitizeLiveResult(livePayload);
  job.status = "done";
  job.verdict_seen = false;
  job.demo = null;
  const now = Date.now() / 1000;
  await writeInternalJob(env, job, Math.max(60, (job.expires_at || now + 120) - now + 60));
  await queueRemove(env, [jobId]);
  await recordHistory(env, {
    url: job.url,
    host: job.host,
    verdict: job.live.verdict,
    category: job.live.category,
    reason: job.live.reason,
    source: job.live.source,
    mode: "live",
  });
  return true;
}

export async function agentFail(env, jobId, reason) {
  if (!isJobId(jobId)) return false;
  const job = await readInternalJob(env, jobId);
  if (!job || (job.status !== "queued" && job.status !== "running")) return false;
  job.status = "error";
  job.live = null;
  job.error = String(reason || "error").slice(0, 300);
  const now = Date.now() / 1000;
  await writeInternalJob(env, job, Math.max(60, (job.expires_at || now + 120) - now + 60));
  await queueRemove(env, [jobId]);
  return true;
}

export async function markVerdictSeen(env, jobId) {
  const job = await readInternalJob(env, jobId);
  if (!job) return null;
  job.verdict_seen = true;
  const now = Date.now() / 1000;
  await writeInternalJob(env, job, Math.max(60, (job.expires_at || now + 120) - now + 60));
  return publicResult(job);
}
