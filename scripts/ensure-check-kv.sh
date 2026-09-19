#!/usr/bin/env bash
# Create (or reuse) KV namespace and print the id on the last line.
set -euo pipefail
: "${CF_API_TOKEN:?}"
: "${CF_ACCOUNT_ID:?}"
API="https://api.cloudflare.com/client/v4"
TITLE="${CF_KV_TITLE:-amastan-check-mailbox}"

LIST=$(curl -sS \
  -H "Authorization: Bearer ${CF_API_TOKEN}" \
  -H "Content-Type: application/json" \
  "$API/accounts/${CF_ACCOUNT_ID}/storage/kv/namespaces?per_page=100")

EXISTING=$(LIST_JSON="$LIST" TITLE="$TITLE" python3 - <<'PY'
import json, os
d = json.loads(os.environ["LIST_JSON"])
assert d.get("success"), d
title = os.environ["TITLE"]
for n in d.get("result") or []:
    if n.get("title") == title:
        print(n["id"])
        break
PY
)

if [[ -n "$EXISTING" ]]; then
  echo "KV exists title=${TITLE} id=${EXISTING}" >&2
  echo "$EXISTING"
  exit 0
fi

CREATE=$(curl -sS \
  -H "Authorization: Bearer ${CF_API_TOKEN}" \
  -H "Content-Type: application/json" \
  -X POST \
  "$API/accounts/${CF_ACCOUNT_ID}/storage/kv/namespaces" \
  --data "{\"title\":\"${TITLE}\"}")

ID=$(CREATE_JSON="$CREATE" python3 - <<'PY'
import json, os
d = json.loads(os.environ["CREATE_JSON"])
assert d.get("success"), d
print(d["result"]["id"])
PY
)
echo "KV created title=${TITLE} id=${ID}" >&2
echo "$ID"
