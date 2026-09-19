#!/usr/bin/env bash
# Deploy Amastan marketing site to Cloudflare Pages and attach amastansolution.com.
# Requires a token with: Zone DNS Edit, Zone Read, Account Cloudflare Pages Edit,
# Account Workers KV Storage Edit (for CHECK_HISTORY mailbox).
#
# Usage:
#   export CF_API_TOKEN='…'
#   export CF_ACCOUNT_ID='2a850af464bf487db689792a1dc5425e'
#   export CF_ZONE_ID='e37402af503cf534a9a9a6195e792086'
#   # optional: export AMASTAN_AGENT_TOKEN="$(openssl rand -hex 24)"
#   ./scripts/cloudflare-setup.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DOMAIN="${CF_DOMAIN:-amastansolution.com}"
PROJECT="${CF_PAGES_PROJECT:-amastan-site}"
OUT="${CF_PAGES_OUT:-/tmp/amastan-pages-out}"

: "${CF_API_TOKEN:?set CF_API_TOKEN}"
: "${CF_ACCOUNT_ID:?set CF_ACCOUNT_ID}"
: "${CF_ZONE_ID:?set CF_ZONE_ID}"

API="https://api.cloudflare.com/client/v4"
auth=(-H "Authorization: Bearer ${CF_API_TOKEN}" -H "Content-Type: application/json")

echo "==> verify token"
curl -sS "${auth[@]}" "$API/user/tokens/verify" | python3 -c 'import json,sys; d=json.load(sys.stdin); assert d.get("success"), d; print("token ok")'

echo "==> zone"
curl -sS "${auth[@]}" "$API/zones/${CF_ZONE_ID}" | python3 -c 'import json,sys; d=json.load(sys.stdin); assert d.get("success"), d; r=d["result"]; print(r["name"], r["status"])'

echo "==> ensure KV namespace (CHECK_HISTORY mailbox) — optional"
KV_ID=""
if KV_OUT="$("$ROOT/scripts/ensure-check-kv.sh" 2>/tmp/amastan-kv.err | tail -n1)"; then
  KV_ID="$KV_OUT"
  echo "KV_ID=${KV_ID}"
else
  echo "KV unavailable (token may lack Workers KV permission). Using Cache API mailbox."
  cat /tmp/amastan-kv.err 2>/dev/null | tail -5 || true
fi

echo "==> build Pages bundle (static + Functions)"
rm -rf "$OUT"
mkdir -p "$OUT"
rsync -a \
  --exclude '__pycache__' --exclude 'data' --exclude '*.py' \
  --exclude 'env.example' --exclude 'lab-agent.env' --exclude 'lab-agent.env.example' \
  --exclude 'lab-agent.service.example' \
  --exclude 'README.md' --exclude 'scripts' --exclude '.git' \
  --exclude '.wrangler' --exclude '.env' \
  "$ROOT/" "$OUT/"

# Ensure Functions are present
test -f "$OUT/functions/api/check-url.js"
test -f "$OUT/functions/api/agent/inbox.js"

if ! command -v wrangler >/dev/null 2>&1; then
  echo "==> using npx wrangler"
  WRANGLER=(npx --yes wrangler@4)
else
  WRANGLER=(wrangler)
fi

echo "==> ensure pages project ${PROJECT}"
CREATE=$(curl -sS "${auth[@]}" -X POST \
  "$API/accounts/${CF_ACCOUNT_ID}/pages/projects" \
  --data "{\"name\":\"${PROJECT}\",\"production_branch\":\"main\"}")
python3 -c 'import json,sys; d=json.load(sys.stdin); print("project", "created" if d.get("success") else (d.get("errors") or [{"message":"exists"}])[0].get("message","?"))' <<<"$CREATE"

echo "==> pages deploy → project=${PROJECT}"
# Pin the production branch so wrangler does not follow a dirty git worktree.
PAGES_BRANCH="${CF_PAGES_BRANCH:-main}"
DEPLOY_ARGS=(pages deploy "$OUT" --project-name="$PROJECT" --branch="$PAGES_BRANCH" --commit-dirty=true)
if [[ -n "$KV_ID" ]]; then
  DEPLOY_ARGS+=(--kv="CHECK_HISTORY=${KV_ID}")
  echo "binding CHECK_HISTORY=${KV_ID}"
fi
CLOUDFLARE_API_TOKEN="$CF_API_TOKEN" CLOUDFLARE_ACCOUNT_ID="$CF_ACCOUNT_ID" \
  "${WRANGLER[@]}" "${DEPLOY_ARGS[@]}"

if [[ -n "${AMASTAN_AGENT_TOKEN:-}" ]]; then
  echo "==> set AMASTAN_AGENT_TOKEN Pages secret"
  AMASTAN_AGENT_TOKEN="$AMASTAN_AGENT_TOKEN" \
    CF_API_TOKEN="$CF_API_TOKEN" \
    CF_ACCOUNT_ID="$CF_ACCOUNT_ID" \
    CF_PAGES_PROJECT="$PROJECT" \
    "$ROOT/scripts/set-agent-secret.sh"
else
  echo "==> skip agent secret (set AMASTAN_AGENT_TOKEN and re-run scripts/set-agent-secret.sh)"
fi

echo "==> attach custom domains ${DOMAIN} and www.${DOMAIN}"
attach_domain() {
  local host="$1"
  curl -sS "${auth[@]}" -X POST \
    "$API/accounts/${CF_ACCOUNT_ID}/pages/projects/${PROJECT}/domains" \
    --data "{\"name\":\"${host}\"}" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(host:=sys.argv[1], "ok" if d.get("success") else d)' "$host" || true
}
attach_domain "$DOMAIN"
attach_domain "www.$DOMAIN"

ensure_cname() {
  local name="$1"
  local fqdn="$2"
  echo "==> ensure ${fqdn} CNAME → ${PROJECT}.pages.dev (proxied)"
  EXISTING=$(curl -sS "${auth[@]}" \
    "$API/zones/${CF_ZONE_ID}/dns_records?type=CNAME&name=${fqdn}")
  REC_ID=$(python3 -c 'import json,sys; d=json.load(sys.stdin); r=d.get("result") or []; print(r[0]["id"] if r else "")' <<<"$EXISTING")
  PAYLOAD=$(python3 - <<PY
import json
print(json.dumps({
  "type": "CNAME",
  "name": "${name}",
  "content": "${PROJECT}.pages.dev",
  "proxied": True,
  "ttl": 1,
}))
PY
)
  if [[ -n "$REC_ID" ]]; then
    curl -sS "${auth[@]}" -X PUT \
      "$API/zones/${CF_ZONE_ID}/dns_records/${REC_ID}" \
      --data "$PAYLOAD" | python3 -c 'import json,sys; d=json.load(sys.stdin); assert d.get("success"), d; print(sys.argv[1], "updated")' "$fqdn"
  else
    curl -sS "${auth[@]}" -X POST \
      "$API/zones/${CF_ZONE_ID}/dns_records" \
      --data "$PAYLOAD" | python3 -c 'import json,sys; d=json.load(sys.stdin); assert d.get("success"), d; print(sys.argv[1], "created")' "$fqdn"
  fi
}
ensure_cname "@" "$DOMAIN"
ensure_cname "www" "www.$DOMAIN"

echo
echo "Done."
echo "  Pages URL: https://${PROJECT}.pages.dev"
echo "  Custom:    https://${DOMAIN}"
echo "  Health:    https://${DOMAIN}/api/check-url/health"
echo
echo "On the appliance (after secret is set):"
echo "  export AMASTAN_MAILBOX_URL=https://${DOMAIN}"
echo "  export AMASTAN_AGENT_TOKEN='…same as Pages secret…'"
echo "  export AMASTAN_CLASSIFY_URL=http://127.0.0.1:8010/classify"
echo "  export AMASTAN_CLASSIFY_TOKEN='…JWT…'"
echo "  python3 lab-agent.py"
echo
echo "Expect health: agent_configured=true, lab_online=true while the agent polls."
