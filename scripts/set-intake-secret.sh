#!/usr/bin/env bash
# Set SaaS intake HMAC secret (and optional URL) on Cloudflare Pages.
# Same HMAC value as VPS AMASTAN_INTAKE_HMAC_SECRET. See Amastan-SAAS docs/INTAKE-HMAC.md.
#
# Usage:
#   export CF_API_TOKEN='…'
#   export CF_ACCOUNT_ID='2a850af464bf487db689792a1dc5425e'
#   export AMASTAN_INTAKE_HMAC_SECRET='…'
#   export AMASTAN_INTAKE_URL='https://saas.example.com/public/intake'
#   ./scripts/set-intake-secret.sh
set -euo pipefail
: "${CF_API_TOKEN:?}"
: "${CF_ACCOUNT_ID:?}"
: "${AMASTAN_INTAKE_HMAC_SECRET:?}"
export CLOUDFLARE_API_TOKEN="$CF_API_TOKEN"
export CLOUDFLARE_ACCOUNT_ID="$CF_ACCOUNT_ID"
PROJECT="${CF_PAGES_PROJECT:-amastan-site}"
printf '%s' "$AMASTAN_INTAKE_HMAC_SECRET" | npx --yes wrangler@4 pages secret put AMASTAN_INTAKE_HMAC_SECRET --project-name="$PROJECT"
if [[ -n "${AMASTAN_INTAKE_URL:-}" ]]; then
  printf '%s' "$AMASTAN_INTAKE_URL" | npx --yes wrangler@4 pages secret put AMASTAN_INTAKE_URL --project-name="$PROJECT"
fi
echo "Intake secret set. Redeploy or wait for next deploy; then test POST /api/contact."
