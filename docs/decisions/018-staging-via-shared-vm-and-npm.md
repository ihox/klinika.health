# ADR 018: Staging via shared Proxmox VM + sibling NPM + GitHub-hosted runner

Date: 2026-05-17
Status: Accepted (supersedes the staging portion of [ADR-002](002-deployment-topology.md); ADR-002 still governs production cloud + on-premise topology)

## Context

ADR-002 (Accepted 2026-05-13) pinned staging at `klinika.ihox.net`, gated by Cloudflare Tunnel + Cloudflare Access, with HTTPS terminated by a per-stack Caddy. That plan was sound when written, but by the time Slice 18a landed the infrastructure picture had moved:

- The founder's Proxmox cluster already hosts other production-grade staging stacks (`montelgo`, `tregu-online`). Each lives at `/srv/sites/<slug>/`, exposes a unique host port on `0.0.0.0`, and is fronted by an **Nginx Proxy Manager (NPM) container running on a sibling VM** on the same LAN. The pattern is in place, tested, and operated routinely.
- Adding Cloudflare Tunnel to a clinic environment would have introduced a second ingress path that diverges from how the rest of the founder's services are operated. Tunnel auth, route maintenance, and outage debugging are all new surface area for a project where staging is supposed to be the *cheap* environment.
- A self-hosted GitHub runner on the staging VM was considered and rejected: the VM already hosts unrelated tenants, and a self-hosted runner is a credentialed execution surface for any compromise of GitHub. The simpler model — GitHub-hosted runners that SSH in over the LAN-routable host — is the same authentication boundary the founder already uses for manual ops.

This ADR records the staging-only topology used in Slice 18a. ADR-002's decisions about production cloud (Frankfurt VPS + Caddy + wildcard TLS) and on-premise (mini-PC + Caddy + Cloudflare Tunnel) are unchanged.

## Decision

Staging runs on the **shared Proxmox VM**, fronted by the **sibling NPM**, deployed by **GitHub-hosted runners over SSH**.

Concretely:

- **Hostname suffix:** `klinika.health.ihox.net` (apex). Tenant subdomains: `*.klinika.health.ihox.net`. Driven by `CLINIC_HOST_SUFFIX` env var in the api + Next.js middlewares — see [apps/api/src/common/middleware/clinic-resolution.middleware.ts](../../apps/api/src/common/middleware/clinic-resolution.middleware.ts) and [apps/web/lib/scope.ts](../../apps/web/lib/scope.ts).
- **Filesystem layout:** `/srv/sites/klinika-health/{repo,postgres_data,storage}`. Mirrors the per-site convention already in use for `montelgo` and `tregu-online`. Bind mounts are absolute host paths; no Docker named volumes, no collisions with the other site stacks.
- **Compose file:** [infra/compose/docker-compose.staging.yml](../../infra/compose/docker-compose.staging.yml). Container names prefixed `klinika-staging-` so `docker ps` stays readable across the shared host.
- **Port exposure:** the `web` service binds `0.0.0.0:8003:3000` so the sibling NPM (different VM on the same LAN, 10.2.1.0/24) can reach it. The `api` and `postgres` services expose no host ports — `api` talks to `postgres` over the `klinika-staging-internal` bridge, and `web` reaches `api` over `klinika-staging-public`.
- **Ingress:** the sibling NPM proxies `klinika.health.ihox.net` and `*.klinika.health.ihox.net` to `10.2.1.101:8003`. SSL via Let's Encrypt (wildcard requires DNS challenge). NPM is the only host on the LAN listening on 80/443 — the staging VM does not.
- **CI/CD:** [.github/workflows/deploy-staging.yml](../../.github/workflows/deploy-staging.yml) — GitHub-hosted `ubuntu-latest` runner, SSH agent via `webfactory/ssh-agent@v0.9.0`, SSHs to the VM as the `deploy` user, runs `git fetch && reset --hard && docker compose build && prisma migrate deploy && docker compose up -d`. Health-check against `https://klinika.health.ihox.net/health/ready` from the runner.
- **Migrations:** explicit `pnpm exec prisma migrate deploy` step in the workflow, before `up -d`. Never on container start (matches [docs/deployment.md](../deployment.md) for the production cloud path).
- **Secrets:** `.env.staging` lives ONLY on the VM at `/srv/sites/klinika-health/repo/.env.staging`, gitignored. Generated once during the on-VM bootstrap with `openssl rand -hex …`. GitHub repo secret `STAGING_SSH_KEY` holds the ed25519 private key for the deploy keypair generated on the VM.

What changes vs. ADR-002 for staging:

| Aspect | ADR-002 (was) | ADR-018 (now) |
|---|---|---|
| URL | `klinika.ihox.net` | `klinika.health.ihox.net` |
| Ingress | Caddy on the staging host | NPM on a sibling VM |
| TLS | Caddy + Let's Encrypt DNS challenge | NPM + Let's Encrypt (wildcard via DNS challenge) |
| Access gate | Cloudflare Access | None (LAN + NPM only) |
| Remote reach | Cloudflare Tunnel | Direct SSH from GitHub runner |
| CI runner | unspecified | GitHub-hosted, SSH to VM |

The marketing-page Phase 4 in ADR-002 is unaffected.

## Consequences

**Pros:**
- Reuses existing infrastructure — no new ingress system to operate, no new auth provider to learn.
- Staging deploys are end-to-end testable from `git push` to live HTTPS in a couple of minutes. The deploy path matches what an operator does manually.
- The boundary between staging and production stays clean: staging is reachable, production needs a separate setup. No accidental cross-environment routing.
- A test clinic seed (subdomain `clinic`) gives the founder + invited reviewers a recognisable "log into the clinic" flow without exposing real patient data.

**Cons:**
- Staging sits behind the founder's NPM/LAN — no Cloudflare-style WAF, no edge rate-limiting beyond what NPM does natively. Acceptable because staging carries no real patient data and is meant to be exercised intentionally, not to absorb internet traffic.
- The GitHub-hosted runner needs an internet-routable path to SSH into the VM (Tailscale, public hostname, or LAN VPN). Trade-off for not running a self-hosted runner: each org operates this differently and the workflow stays portable.
- Health-checking from the runner relies on DNS + NPM being configured. On a fresh VM the workflow's HTTPS check fails until those are in place — acceptable bootstrap cost, documented in [infra/STAGING.md](../../infra/STAGING.md).

**Accepted trade-offs:**
- The shared VM means a `docker compose down` in another site's compose file can't take Klinika down (different compose project), but a kernel panic on the host takes everything with it. Klinika's staging needn't survive that; production cloud will.
- Staging starts empty (no real data) — diverges from ADR-002's "real DonetaMED data migrated here." Re-introducing real data on staging requires a separate decision because the Kosovo consent picture has changed since ADR-002 was written.

## Revisit when

- The shared VM stops being viable (resource pressure from other stacks, security boundary concerns, etc.).
- A second on-premise install needs its own staging environment — consider moving staging to a per-clinic model.
- Production cloud goes live — staging should mirror production's ingress (Caddy vs NPM) closely enough that catching prod-only bugs in staging is realistic. May force ingress unification.
- Cloudflare Access is reintroduced (regulatory or internal-audit requirement to gate non-public environments).

## URL scheme refinement (2026-05-17)

Status: Accepted (supplements the original decision; does not supersede)

### The constraint

The original decision pinned the apex at `klinika.health.ihox.net` and tenants at `*.klinika.health.ihox.net` — both **level-2** subdomains of `ihox.net`. The operator's existing wildcard cert covers only **level-1** subdomains (`*.ihox.net`), so the level-2 wildcard would have required a separate cert issued via DNS-01 challenge against `_acme-challenge.klinika.health.ihox.net`. That's possible but pushes a new operational dependency (a DNS-API token tied to the staging cert) for no application benefit.

### The fix

Switch staging to a flat hyphen-joined scheme that keeps every Klinika host at level-1:

| Was | Is |
|---|---|
| `klinika.health.ihox.net` (apex) | `klinika-health.ihox.net` |
| `<slug>.klinika.health.ihox.net` (tenant) | `klinika-health-<slug>.ihox.net` |

The staging seed creates one tenant with slug `donetamed` (matching the NPM proxy host the operator pre-configured at `klinika-health-donetamed.ihox.net`). Note that the originally-accepted body above refers to this tenant by an earlier placeholder slug `clinic` — the slug name is operational, not a decision change.

The middleware grew a second resolution mode (PREFIX), driven by `CLINIC_HOST_APEX` + `CLINIC_HOST_PREFIX`. Production continues to use SUFFIX mode (`CLINIC_HOST_SUFFIX=klinika.health`) unchanged; the dotted scheme there has wildcard-cert headroom because `klinika.health` is the production zone apex, not a delegation.

See `HostResolutionConfig` in [apps/api/src/common/middleware/clinic-resolution.middleware.ts](../../apps/api/src/common/middleware/clinic-resolution.middleware.ts) and the mirror in [apps/web/lib/scope.ts](../../apps/web/lib/scope.ts) for the routing logic.

### What changed in NPM / DNS

NPM proxy hosts are now one per Klinika host (the apex + one per tenant slug), all forwarded to the same `10.2.1.101:8003` and all reusing the existing `*.ihox.net` wildcard cert. No DNS-01 challenge for Klinika; no per-host cert issuance. The operator can alternatively use a single `*.ihox.net` proxy host if no other site stack needs to claim a competing host name.

DNS keeps the same shape — either per-host A records or a `*.ihox.net` wildcard pointing at the NPM IP.

### What changed in code

- Added `HostResolutionConfig` interface + prefix-mode branch to `resolveScope` (api) and `classifyHost` (web). Backwards-compat shim: the third arg still accepts a bare string treated as `{ suffix }`.
- CORS regex in `main.ts` picks the mode at startup from env and builds the tenant-origin pattern accordingly.
- Existing suffix-mode tests stay green. +21 prefix-mode test cases across api + web.

### Trade-off accepted

Adding two operating modes raises the middleware's surface area. The two-mode interface is documented on `HostResolutionConfig` and gated by env, so the routing logic in either mode is the same code path that already ran in production for months. The simpler alternative — issuing a level-2 wildcard for staging — was rejected because the new DNS-API dependency cost more than the second mode does to maintain.
