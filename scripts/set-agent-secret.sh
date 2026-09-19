#!/usr/bin/env bash
# Set AMASTAN_AGENT_TOKEN on Cloudflare Pages (must match lab-agent.py).
# Usage:
#   export CF_API_TOKEN='…'
#   export CF_ACCOUNT_ID='2a850af464bf487db689792a1dc5425e'
#   export AMASTAN_AGENT_TOKEN="$(openssl rand -hex 24)"   # or reuse existing
#   ./scripts/set-agent-secret.sh
set -euo pipefail
: "${CF_API_TOKEN:?}"
: "${CF_ACCOUNT_ID:?}"
: "${AMASTAN_AGENT_TOKEN:?}"
PROJECT="${CF_PAGES_PROJECT:-amastan-site}"
export CLOUDFLARE_API_TOKEN="$CF_API_TOKEN"
export CLOUDFLARE_ACCOUNT_ID="$CF_ACCOUNT_ID"
printf '%s' "$AMASTAN_AGENT_TOKEN" | npx --yes wrangler@4 pages secret put AMASTAN_AGENT_TOKEN --project-name="$PROJECT"
echo
echo "Secret set on Pages project ${PROJECT}."
echo "Put the SAME token in lab-agent.env on the appliance:"
echo "  AMASTAN_AGENT_TOKEN=…"
echo "  AMASTAN_MAILBOX_URL=https://amastansolution.com"
echo "Then redeploy Pages so Functions pick up bindings, and start lab-agent.py."
