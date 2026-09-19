# Amastan AI-SWG — System Specifications (Pilot RC1)

**Updated:** 2026-08-23

Self-hosted AI Secure Web Gateway. Verdicts: Allow · Block · Isolate (RBI).

Architecture diagram (HAProxy → Envoy/Wasm → sidecar chain callout) removed from public specs — see Admin Guide / internal runbooks for deploy detail.

## Capacity by named users
| Named users | Nodes | vCPU/node | RAM/node | Disk/node |
|-------------|-------|-----------|----------|-----------|
| 500 | 1 | 12–16 | 48–64 GB | 500 GB |
| **2,000** | **2 HA** | **16** | **64 GB** | **1 TB** |
| **4,000** | **2 HA** | **24** | **96 GB** | **1.5 TB** |
| 10,000 | 2–3 | 32 | 128 GB | 2 TB |
| **20,000** | **3–4** | **32–48** | **128–192 GB** | **4 TB** |

See HTML System Specifications for ports, security properties, and documentation set.
