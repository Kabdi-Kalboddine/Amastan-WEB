# Amastan AI-SWG — Admin Guide (Pilot RC1)

**Audience:** Deployment engineers and security administrators  
**Related:** User/Client Guide · System Specifications  
**Updated:** 2026-08-23

## Scope
Install appliance, HA stack, identity, policies, verification, capacity planning, roadmap.

## Capacity planning (named users)
| Named users | Peak concurrent (est.) | Nodes | vCPU/node | RAM/node | Disk/node |
|-------------|------------------------|-------|-----------|----------|-----------|
| Lab (&lt;100) | &lt;30 | 1 | 8+ | 32 GB | 200+ GB |
| 500 | ~50–100 | 1 | 12–16 | 48–64 GB | 500 GB |
| **2,000** | ~200–400 | **2 HA** | **16** | **64 GB** | **1 TB** |
| **4,000** | ~400–800 | **2 HA** | **24** | **96 GB** | **1.5 TB** |
| 10,000 | ~1k–2k | 2–3 | 32 | 128 GB | 2 TB |
| **20,000** | ~2k–4k | **3–4** | **32–48** | **128–192 GB** | **4 TB** |

Guidance assumes TLS inspect and typical office mix; heavy RBI needs more headroom. Validate in pilot load tests.

## Coming next
Filter bypass hardening · Azure AD/SAML/OIDC · safer ChatGPT/Copilot · finer CASB controls · ZTNA · multi-site fleet · stronger malware blocking · SOAR-style follow-up · richer SIEM/audit packs · sector packs.

See the HTML guide for full admin procedures.
