#!/usr/bin/env bash
# Set Resend API key as a Cloudflare Pages secret for the live Pages project.
# Usage:
#   export CF_API_TOKEN='…'
#   export CF_ACCOUNT_ID='2a850af464bf487db689792a1dc5425e'
#   export RESEND_API_KEY='re_…'
#   ./scripts/set-resend-secret.sh
set -euo pipefail
: "${CF_API_TOKEN:?}"
: "${CF_ACCOUNT_ID:?}"
: "${RESEND_API_KEY:?}"
export CLOUDFLARE_API_TOKEN="$CF_API_TOKEN"
export CLOUDFLARE_ACCOUNT_ID="$CF_ACCOUNT_ID"
PROJECT="${CF_PAGES_PROJECT:-amastan-site}"
printf '%s' "$RESEND_API_KEY" | npx --yes wrangler@4 pages secret put RESEND_API_KEY --project-name="$PROJECT"
echo "Secret set. Redeploy or wait for next deploy; then test POST /api/contact."
