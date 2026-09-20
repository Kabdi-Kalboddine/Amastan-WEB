# Amastan official website

GitHub: https://github.com/Kabdi-Kalboddine/Amastan-WEB  
Live: https://amastansolution.com  

This repository is the **marketing site** only. It is not the appliance (`swg-project`) and not the vendor SaaS (`Amastan-SAAS`). Do not commit `lab-agent.env`, classify JWTs, or Cloudflare tokens.

Owner: **Kabdi-Kalboddine** (Kalboddine Mohamed Charif Kabdi).

Multi-language site (EN / FR / AR). Contact and pilot forms POST `/api/contact` (Pages Function), which HMAC-signs the raw JSON and forwards it to SaaS `POST /public/intake`. Resend is used only if that webhook fails.

Check URL is **pull-based**: the website never opens a connection to your PC.
Your appliance agent polls the public mailbox, classifies on localhost `:8010`, then writes the verdict back.

```
Visitor → POST /api/check-url  (queued when lab_online)
                ↑
lab-agent.py → GET /api/agent/inbox  (every ~1s)
             → POST /api/agent/ack
             → POST /classify on 127.0.0.1:8010
             → POST /api/agent/result
Visitor → polls /api/check-url/jobs/:id until new_verdict
```

## Pages

| Page | Path |
|------|------|
| Home | `index.html` |
| Use cases | `use-cases.html` |
| Pilot | `pilot.html` |
| Features & roadmap | `features.html` |
| **Check URL** | `check-url.html` |
| Verdict | `verdict.html?job=…` |
| About | `about.html` |
| What is SWG | `what-is-swg.html` |
| Privacy | `privacy.html` |

## Local run (demo only, no agent)

```bash
cd website
python3 serve.py
# http://127.0.0.1:8765/check-url.html
```

Without `AMASTAN_AGENT_TOKEN`, Cloudflare and local demo policy still answer alone.

## Production: Cloudflare Pages + appliance agent

### 1) Deploy site (KV + Functions)

```bash
export CF_API_TOKEN='…'
export CF_ACCOUNT_ID='…'
export CF_ZONE_ID='…'
export AMASTAN_AGENT_TOKEN="$(openssl rand -hex 24)"
./scripts/cloudflare-setup.sh
# save AMASTAN_AGENT_TOKEN — same value on the appliance
```

Or set the secret later:

```bash
export AMASTAN_AGENT_TOKEN='…'
./scripts/set-agent-secret.sh
```

Intake webhook (same HMAC secret as the VPS):

```bash
export AMASTAN_INTAKE_HMAC_SECRET='…'
export AMASTAN_INTAKE_URL='https://saas.example.com/public/intake'
./scripts/set-intake-secret.sh
```

Bindings:

| Binding / secret | Purpose |
|------------------|---------|
| `CHECK_HISTORY` (KV) | Jobs, queue, history, last agent ping |
| `AMASTAN_AGENT_TOKEN` | Bearer token for `/api/agent/*` |
| `AMASTAN_INTAKE_HMAC_SECRET` | HMAC key for SaaS `POST /public/intake` (same as VPS) |
| `AMASTAN_INTAKE_URL` | SaaS intake URL, e.g. `https://saas.example.com/public/intake` |
| `RESEND_API_KEY` | Fallback mailer if the intake webhook fails |

### 2) Run agent on the appliance

Sidecar must be healthy: `curl -sf http://127.0.0.1:8010/health`

```bash
cd /home/swg/swg-project/website   # or your synced path
cp env.example lab-agent.env       # edit secrets — do not commit
# AMASTAN_MAILBOX_URL=https://amastansolution.com
# AMASTAN_AGENT_TOKEN=…same as Pages…
# AMASTAN_CLASSIFY_URL=http://127.0.0.1:8010/classify
# AMASTAN_CLASSIFY_TOKEN=…from scripts/identity/generate_jwt.py…

set -a && source lab-agent.env && set +a
python3 lab-agent.py
# optional: systemd using lab-agent.service.example
```

### 3) Verify

```bash
curl -sS https://amastansolution.com/api/check-url/health
# expect: agent_configured=true, lab_online=true, kv_bound=true while agent runs

curl -sS -X POST https://amastansolution.com/api/check-url \
  -H 'content-type: application/json' \
  -d '{"url":"https://example.com"}'
# expect: queued_live=true, mode=pending, job_id=…
```

If the agent stops, Check URL returns `lab_offline` (503) when the token is configured — it will not silently fake a live verdict.

## Public API

| Method | Path | Who |
|--------|------|-----|
| `POST` | `/api/contact` | Browser (HMAC-forwarded to SaaS `/public/intake`) |
| `POST` | `/api/check-url` | Browser |
| `GET` | `/api/check-url/jobs/{id}` | Browser poll |
| `POST` | `/api/check-url/jobs/{id}/seen` | Browser displayed live result |
| `GET` | `/api/check-url/health` | `{ lab_online, agent_configured, kv_bound }` |
| `GET` | `/api/agent/inbox` | Appliance agent |
| `POST` | `/api/agent/ack` | Appliance agent |
| `POST` | `/api/agent/result` | Appliance agent |
| `POST` | `/api/agent/ping` | Appliance agent (optional) |

Never expose sidecar `:8010` or Keycloak to the internet. Never put classify JWT or agent token in browser JS.
