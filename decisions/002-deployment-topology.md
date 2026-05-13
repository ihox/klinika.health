# ADR 002: Deployment topology

Date: 2026-05-13
Status: Accepted

## Context

Klinika serves both cloud-hosted clinics (small clinics that prefer SaaS) and on-premise installs (clinics that require local data sovereignty or need offline operation). DonetaMED specifically wants on-premise because their ultrasound (GE Versana Balance) speaks DICOM only on the local network, and the doctor values internet-outage resilience.

We need a deployment strategy that:
- Serves the founder's testing needs (staging environment with real data)
- Supports a public cloud production for small clinics
- Supports on-premise installs at clinics that need it
- Has a path to a marketing site eventually
- Lets us iterate without exposing patient data publicly

## Decision

Four deployment phases:

**Phase 1 — Staging on founder's Proxmox.** URL: `klinika.ihox.net`. Accessible via Cloudflare Tunnel, gated by Cloudflare Access (allowlist: founder + doctor email). Real DonetaMED data migrated here (with written consent) for iteration. HTTPS via Caddy + Let's Encrypt DNS challenge.

**Phase 2 — Production cloud at klinika.health.** IONOS VPS in Frankfurt, ~€20-25/month. Ubuntu LTS, Caddy + wildcard TLS. Multi-tenant via `*.klinika.health` subdomain routing. Subdomains, not path-based (clean separation, simpler RLS).

**Phase 3 — DonetaMED on-premise at donetamed.klinika.health.** Mini-PC at the clinic (32GB RAM, 1TB NVMe + 2TB HDD, UPS, RAID 1 recommended). Cloudflare Tunnel for remote access. Split-horizon DNS: clinic LAN resolves `donetamed.klinika.health` to the local server IP for LAN bypass; remote access goes through the tunnel. Orthanc DICOM receiver runs locally. **No bidirectional sync** between cloud and on-premise — each clinic picks one model.

**Phase 4 — Marketing landing page at klinika.health root.** Deferred until after initial launches. Same domain.

For cloud-hosted clinics, **Tier 2 offline resilience** is required: Service Worker + IndexedDB cache + write queue + idempotent endpoints + connection status indicator. Handles outages up to ~1 hour gracefully.

For on-premise installs, offline resilience is inherent (the server is on the clinic's LAN).

## Consequences

**Pros:**
- Staging environment exists from day one with real data
- Cloud production launches without building on-premise complexity
- Each clinic gets the model that fits their constraints
- Subdomain routing makes multi-tenancy natural and isolatable
- Cloudflare Tunnel solves NAT/firewall issues at clinics without exposing ports
- Cloudflare Access keeps staging private without password gates

**Cons:**
- Two distinct deploy paths to maintain (cloud + on-premise)
- On-premise installs require physical hardware management at the clinic
- DICOM cannot be cloud-only (always requires a local box at the clinic)
- No federated cross-clinic features (no sync = no shared patient lookup across clinics)

**Accepted trade-offs:**
- Cloud and on-premise diverge slightly in operational characteristics (acceptable — both deploy from the same code)
- DICOM stays local (acceptable — required by ultrasound protocol)
- No automated horizontal scaling in v1 (acceptable — clinic-scale workloads are tiny)

## Revisit when

- We have 5+ clinics and operational burden of on-premise becomes significant (might offer cloud-only tier)
- A clinic asks for cross-clinic patient lookup (would require sync layer)
- IONOS VPS becomes a bottleneck (move to managed Kubernetes or another provider)
- We need geographic redundancy (multi-region cloud deployment)
