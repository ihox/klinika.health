# Klinika DonetaMED on-prem — operational guide

This is the runbook for the **on-premise** DonetaMED install: one Lenovo ThinkBook laptop at the clinic in Prizren, Kosovo. Staging (`klinika-health.ihox.net`, see [STAGING.md](STAGING.md)) and the future production cloud (slice 18c) are separate environments and live in their own runbooks.

The laptop is currently in bring-up (slices 18b.2a / 18b.2b / 18b.2c / 18b.3 / 18b.4 / 18b.5 complete). 18b.6 (cutover at the clinic) is the remaining slice before it becomes the live production install. Read **Architecture** first, then **What works today**, then **Day-to-day operations**. The bootstrap procedure under **Initial setup** is a record of how we got here — useful for replicating on a fresh laptop.

---

## Architecture

```
Internet
   │
   └── Cloudflare edge (Vienna PoP) ── donetamed.klinika.health
                                       (klinika.health apex when 18c lands)
   │
   │   Cloudflare Tunnel — outbound QUIC from the laptop, no router
   │   port-forward, no public IP. Tunnel name: donetamed-laptop.
   │
laptop (clinic LAN, WiFi-only today, Ethernet at clinic in 18b.6)
   │  ilir            operator account, NOPASSWD sudo
   │  klinika         system user (uid 997), docker group, nologin shell
   │  github-runner   system user (uid 995), docker + klinika groups, no sudo
   │  cloudflared     process runs as root (apt-installed service)
   │
   └─ /srv/sites/klinika-health/
       ├─ .env                       ← root:klinika 0640, secrets only
       ├─ repo/                      ← donetamed branch (read-only clone
       │                                via /var/lib/klinika/.ssh deploy
       │                                key); kept for ops/reference, the
       │                                auto-deploy uses its own checkout
       ├─ postgres_data/             ← Klinika app DB, chown 999:999
       ├─ storage/                   ← clinic logos + signatures,
       │                                chown 10001:10001
       ├─ orthanc/
       │   ├─ postgres_data/         ← Orthanc SQL index, chown 999:999
       │   └─ storage/               ← raw DICOM bytes, chown 999:999
       └─ backup.sh.example          ← template; copy to backup.sh to
                                       activate

Compose stack (project name `klinika-donetamed`):
   ├─ klinika-donetamed-web              Next.js 15 standalone   :3000 → host 127.0.0.1:8003
   ├─ klinika-donetamed-api              NestJS 10               :3001 (internal only)
   ├─ klinika-donetamed-postgres         Postgres 16             :5432 (internal only)
   ├─ klinika-donetamed-orthanc          Orthanc 1.12 / image 26.4.2   DICOM :4242 (LAN), REST + Explorer :8042 (127.0.0.1 only)
   └─ klinika-donetamed-orthanc-postgres Postgres 16             :5432 (internal only, dedicated for Orthanc index)

Networks:
   - klinika-donetamed-internal     postgres ↔ api
   - klinika-donetamed-public       api ↔ web
   - klinika-donetamed-dicom        orthanc ↔ orthanc-postgres ↔ api

External access: HTTPS via Cloudflare Tunnel only (cloudflared on the
laptop dials out to Cloudflare's edge; nothing is published on the LAN).
The web port is bound to 127.0.0.1; api + postgres have no host port
mapping. SSH (port 22) is allowed only from RFC1918 ranges via UFW.
```

The web container's Next.js process proxies `/api/*` and `/health/*` to `api:3001` via a build-time rewrite. The browser only ever talks to the same origin it loaded the page from, so Cloudflare Tunnel only needs **one upstream**: `127.0.0.1:8003`.

Tenancy runs in **SUFFIX mode** (`CLINIC_HOST_SUFFIX=.klinika.health`) — `klinika.health` is the platform apex and `donetamed.klinika.health` is the tenant. Resolved in two places:

- **API** — [apps/api/src/common/middleware/clinic-resolution.middleware.ts](../apps/api/src/common/middleware/clinic-resolution.middleware.ts)
- **Web** — [apps/web/lib/scope.ts](../apps/web/lib/scope.ts)

The image refs are `ghcr.io/ihox/klinika-{api,web}:donetamed` — built and pushed by `.github/workflows/deploy-donetamed.yml` on every green CI run against the `donetamed` branch. The matching sha-tagged variant (`:donetamed-<sha>`) is pushed alongside for rollback (see [Image rollback](#image-rollback-by-sha-tag)).

---

## What works today (post-18b.5)

- ✅ Klinika stack running on the laptop (postgres + api + web)
- ✅ **External HTTPS via Cloudflare Tunnel** — `https://donetamed.klinika.health` reachable from anywhere
- ✅ **Auto-deploy on push to `donetamed` branch** — CI → build → deploy → smoke test in ~5 min total
- ✅ **Dedicated `:donetamed` image tag** built per-commit, with `:donetamed-<sha>` immutable variants for rollback
- ✅ Tenancy resolution at the edge (Cloudflare Tunnel forwards Host header → api middleware reads subdomain)
- ✅ **Orthanc DICOM server** — accepts C-STORE from LAN on TCP 4242 as AET `DONETAMED`; api consumes via internal REST on port 8042
- ✅ OS hardening (UFW, fail2ban, key-only SSH, unattended-upgrades)
- ✅ Idempotent seed (clinic + 4 users, no patients)

### Coming up (still future work)

- ⏳ **18b.6** — Production cutover at the clinic (physical move, ethernet, `.accdb` patient migration, Cloudflare Access for SSH, doctor onboarding, ultrasound DICOM destination configured)
- ⏳ **Production cloud (18c)** — separate environment for non-DonetaMED tenants

---

## Initial setup (one-time per fresh laptop)

> Already done for the current laptop. This section is a record of what was done plus what to do on a fresh box.

### 18b.2a — OS hardening (Ubuntu 24.04 fresh install)

- UFW active, default deny incoming, RFC1918-only SSH allow rules
- `fail2ban` watching the sshd journal (5 retries / 10m / 1h ban)
- Unattended-upgrades installed; security + ESM origins only;
  `Automatic-Reboot=false` (admin reboots outside clinic hours
  10:00–18:00)
- Timezone `Europe/Belgrade` (Kosovo's IANA zone; `Europe/Pristina`
  doesn't exist in tzdata — same offset and DST regardless)
- SSH hardened: `PasswordAuthentication no`, `PermitRootLogin no`,
  key-only auth, drop-in at
  `/etc/ssh/sshd_config.d/10-klinika-hardening.conf`
- Desktop services trimmed: gnome-remote-desktop, bluetooth,
  ModemManager, cups + cups-browsed disabled (no printers, no
  Bluetooth peripherals, no modems on this laptop)

### 18b.2b — klinika user + Docker + GHCR

- `klinika` system user (uid 997), home `/var/lib/klinika`, shell
  `/usr/sbin/nologin`, in `docker` group, NOT in `sudo`
- Docker Engine 29.x + Compose v5.x from the official Docker apt
  repo
- `postgresql-client-16` for one-off `psql` debugging
- `/srv/sites/klinika-health/{repo,postgres_data,storage}` created
  with the right uids
- GHCR auth at `/root/.docker/config.json` AND
  `/var/lib/klinika/.docker/config.json` (mode 0600)

### 18b.2c — Klinika stack first deploy

#### Filesystem ownership (one-time correction after 18b.2b)

```bash
# Postgres container runs as uid 999, api container as uid 10001
sudo chown -R 999:999   /srv/sites/klinika-health/postgres_data
sudo chown -R 10001:10001 /srv/sites/klinika-health/storage
```

#### Deploy key for git clone

Generated on the laptop as the klinika user:

```bash
sudo install -d -o klinika -g klinika -m 0700 /var/lib/klinika/.ssh
sudo -u klinika HOME=/var/lib/klinika \
  ssh-keygen -t ed25519 \
    -f /var/lib/klinika/.ssh/id_github_klinika \
    -N "" \
    -C "donetamed-laptop-readonly" -q
sudo -u klinika HOME=/var/lib/klinika \
  bash -c "ssh-keyscan -t ed25519,rsa github.com > /var/lib/klinika/.ssh/known_hosts 2>/dev/null"
```

The public key is registered as a **read-only Deploy Key** on the GitHub repo (Settings → Deploy keys → `donetamed-laptop-readonly`). `~klinika/.ssh/config` routes `github.com` through this key with `IdentitiesOnly yes` so no other identity is tried.

To rotate: regenerate with the same `ssh-keygen` command, paste the new pubkey into GitHub Deploy Keys, remove the old key.

#### Clone the repo

```bash
sudo -u klinika HOME=/var/lib/klinika bash <<'EOF'
cd /srv/sites/klinika-health
git clone -b donetamed --single-branch git@github.com:ihox/klinika.health.git repo
EOF
```

#### Generate `.env`

The real `.env` is at `/srv/sites/klinika-health/.env`, mode `0640` `root:klinika`. Bootstrap once with:

```bash
sudo bash <<'EOF'
umask 027
cat > /srv/sites/klinika-health/.env <<INNER
NODE_ENV=production
TZ=Europe/Belgrade
APP_VERSION=donetamed
LOG_LEVEL=info

POSTGRES_DB=klinika
POSTGRES_USER=klinika
POSTGRES_PASSWORD=$(openssl rand -hex 32)

AUTH_SECRET=$(openssl rand -hex 32)
AUTH_TRUSTED_DEVICE_TTL_DAYS=30

CLINIC_HOST_SUFFIX=.klinika.health
CORS_ORIGIN=https://klinika.health

EMAIL_FROM=no-reply@klinika.health
EMAIL_FROM_NAME=Klinika
SMTP_HOST=
SMTP_PORT=587
SMTP_USERNAME=
SMTP_PASSWORD=
RESEND_API_KEY=

SEED_PLATFORM_ADMIN_PASSWORD=$(openssl rand -hex 16)
SEED_DOCTOR_PASSWORD=$(openssl rand -hex 16)
SEED_RECEPTIONIST_PASSWORD=$(openssl rand -hex 16)
SEED_CLINIC_ADMIN_PASSWORD=$(openssl rand -hex 16)

IMAGE_TAG=staging
JOBS_DISABLED=0
INNER
chown root:klinika /srv/sites/klinika-health/.env
chmod 0640 /srv/sites/klinika-health/.env
EOF
```

Retrieve seed passwords once (and only once) into a password manager:

```bash
sudo grep ^SEED_ /srv/sites/klinika-health/.env
```

#### First deploy

```bash
cd /srv/sites/klinika-health/repo
COMPOSE="sudo -u klinika docker compose -f infra/compose/docker-compose.donetamed.yml --env-file /srv/sites/klinika-health/.env"

# Pull images
$COMPOSE pull

# Bring up postgres alone, wait for healthy
$COMPOSE up -d postgres
until docker inspect --format '{{.State.Health.Status}}' \
        klinika-donetamed-postgres | grep -q healthy; do
  sleep 2
done

# Run migrations (direct prisma binary call — see "corepack trap" below)
$COMPOSE run --rm api \
  node node_modules/prisma/build/index.js migrate deploy

# Run the donetamed seed (the seed file is baked into the :donetamed image)
$COMPOSE run --rm api ./node_modules/.bin/ts-node \
  --transpile-only prisma/seed-donetamed.ts

# Bring up the full stack
$COMPOSE up -d
```

Verify `/health/ready`:

```bash
curl -fsS http://localhost:8003/health/ready
# {"status":"ok","db":{"ok":true,"latencyMs":N}}
```

### 18b.3 — Cloudflare Tunnel for external HTTPS

The tunnel terminates at Cloudflare's edge and dials out from the laptop — no public IP, no router port-forward, no inbound rule needed on UFW (which still defaults to deny-incoming). Tunnel created in the Cloudflare Zero Trust dashboard:

- **Tunnel name:** `donetamed-laptop`
- **Public hostname routing:** `donetamed.klinika.health → http://localhost:8003`
- **DNS:** CNAME auto-managed by Cloudflare under the `klinika.health` zone
- **Status:** HEALTHY, 4 outbound QUIC connections to Vienna PoP (`vie02 / vie05 / vie06`)

On the laptop:

- Installed via Cloudflare's official apt repo (`pkg.cloudflare.com/cloudflared`); package name `cloudflared`, version 2026.5.0
- Runs as **root** (no separate `cloudflared` user is created by the package)
- Systemd unit: `/etc/systemd/system/cloudflared.service`, enabled on boot
- **Token storage (hardened beyond Cloudflare's default install):**
  - `/etc/cloudflared/cloudflared.env` mode `0600 root:root`, holds `TUNNEL_TOKEN=…`
  - `/etc/cloudflared/` directory mode `0700 root:root`
  - Unit uses `EnvironmentFile=/etc/cloudflared/cloudflared.env`
  - `ExecStart=/usr/bin/cloudflared --no-autoupdate tunnel run` — **no `--token` flag**; cloudflared reads `TUNNEL_TOKEN` directly from env
  - `ps -ef` and `/proc/<pid>/cmdline` therefore show **no token** at all
  - Cloudflare's default `cloudflared service install <TOKEN>` puts the literal token in `ExecStart` (and on the world-readable unit file); we rewrote it post-install. Worth knowing on a fresh laptop install.

To rotate the token: in Cloudflare Zero Trust → Networks → Tunnels → donetamed-laptop → Refresh Token, then on the laptop:

```bash
sudo systemctl stop cloudflared
echo 'TUNNEL_TOKEN=<new-token>' | sudo tee /etc/cloudflared/cloudflared.env > /dev/null
sudo chmod 0600 /etc/cloudflared/cloudflared.env
sudo systemctl start cloudflared
```

**Known harmless warning** in the journal:

```
ICMP proxy feature is disabled error="cannot create ICMPv4 proxy:
Group ID 0 is not between ping group 1 to 0 ..."
```

This is cloudflared's optional ICMP probe feature — disabled because the cloudflared process's GID (0 = root) isn't in `/proc/sys/net/ipv4/ping_group_range`. Doesn't affect HTTPS tunneling. Ignore.

### 18b.4 — Self-hosted runner + auto-deploy

Auto-deploy on push to `donetamed`: CI → build images → deploy on the laptop → smoke test. Total ~5 min wall-clock.

#### Branch flow

```
feature/*   ─PR→  main       ─auto→  STAGING (Proxmox VM)
                  main       ─manual merge→  donetamed   ─auto→  DONETAMED LAPTOP
                  main       ─(future)→  CLOUD PRODUCTION  (when 18c lands)
```

Only the `infra/compose/docker-compose.donetamed.yml` image-tag change (`:donetamed`) stays on the `donetamed` branch — merging it to `main` would break the staging-vm deploy. Every other change in `donetamed` should be a fast-forward of `main`.

#### Runner

- **System user** `github-runner`, uid 995, home `/opt/actions-runner`
- **Groups:** `github-runner` (primary) + `klinika` (reads `.env`, mode 0640) + `docker` (manages compose). **Not** in `sudo`.
- **Runner version:** v2.334.0 (pinned in install). Update by re-downloading the tarball and re-running `config.sh --replace`.
- **Registered as** `donetamed-laptop` with labels `self-hosted, Linux, X64, donetamed`
- **Systemd unit:** `actions.runner.ihox-klinika.health.donetamed-laptop.service` (enabled on boot)
- **Auth credentials** at `/opt/actions-runner/.credentials` and `.credentials_rsaparams`, scoped to the parent `0750 github-runner:github-runner` directory

To rotate / re-register a runner (e.g. fresh registration token from GitHub UI → Settings → Actions → Runners → New self-hosted runner):

```bash
cd /opt/actions-runner
sudo ./svc.sh stop
sudo -u github-runner ./config.sh remove --token <OLD-REMOVAL-TOKEN-FROM-GITHUB>
echo "<NEW-REGISTRATION-TOKEN>" | sudo -u github-runner ./config.sh \
  --url https://github.com/ihox/klinika.health \
  --token "$(cat -)" \
  --name donetamed-laptop \
  --labels self-hosted,donetamed \
  --work _work \
  --unattended --replace
sudo ./svc.sh start
```

#### Workflow files (location matters)

GitHub's `workflow_run` and `workflow_dispatch` triggers only see workflow files on the **default branch (main)**. So:

- `.github/workflows/deploy-donetamed.yml` lives on **both `main` and `donetamed`** (identical content). The `actions/checkout@v4 with: ref: donetamed` step pulls the donetamed code at build/deploy time.
- `.github/workflows/ci.yml` has `[main, donetamed]` in its push branches (also on both branches).

When you merge `main → donetamed` you don't need to do anything special — both files travel with the merge. When you add a new workflow that should fire on `donetamed`, remember it must also land on `main`.

#### What the deploy job does

The deploy job runs on the laptop as `github-runner` (no sudo). Steps:

1. `actions/checkout@v4 ref: donetamed` into `/opt/actions-runner/_work/...`
2. `docker compose pull` (using the workspace compose + `/srv/sites/klinika-health/.env`)
3. `docker compose run --rm api node node_modules/prisma/build/index.js migrate deploy`
4. `docker compose up -d --remove-orphans`
5. Smoke test `http://localhost:8003/health/ready` (12 attempts × 5s)
6. Smoke test `https://donetamed.klinika.health/health/ready` (exercises the full Cloudflare Tunnel chain)
7. Verify the running api container's image tag starts with `ghcr.io/ihox/klinika-api:donetamed`

If any step fails the deploy job fails red in the Actions UI; the previous container generation keeps running because compose only swaps containers on a successful `up -d`.

### 18b.5 — Orthanc DICOM server

The clinic's ultrasound machine pushes DICOM studies to a local PACS via DICOM C-STORE on port 4242. Klinika's API consumes them via Orthanc's REST API on port 8042. Both are on the laptop in dedicated containers.

#### Topology

```
ultrasound (LAN)  ── DICOM C-STORE (TCP 4242, AET DONETAMED) ──▶  klinika-donetamed-orthanc
                                                                   │
                                                                   │  REST :8042 (internal docker net only)
                                                                   ▼
                                                                klinika-donetamed-api (Orthanc REST client
                                                                       in apps/api/src/modules/dicom/)
                                                                   │
                                                                   ▼ Postgres index
                                                                klinika-donetamed-orthanc-postgres
                                                                   │
                                                                   ▼ DICOM file bytes on filesystem
                                                                /srv/sites/klinika-health/orthanc/storage/<dir>/<dir>/<uuid>
```

#### Containers

- `klinika-donetamed-orthanc` — `orthancteam/orthanc:26.4.2`. Runs as uid 999 inside the container.
- `klinika-donetamed-orthanc-postgres` — `postgres:16-alpine`, dedicated DB called `orthanc`. Independent of the main Klinika app DB.

Both containers are on the `klinika-donetamed-dicom` docker network. The api container is **also** on that network so it can reach Orthanc REST at `http://orthanc:8042` for the image-proxy endpoints in `apps/api/src/modules/dicom/`.

#### Ports + auth posture

| Port | Exposure | Auth |
|---|---|---|
| `4242` (DICOM C-STORE) | Published on `0.0.0.0` — reachable from the clinic LAN | None (any AET accepted today; tighten at cutover — see [18b.6 checklist](#18b6--cutover-checklist-planned)) |
| `8042` (Orthanc REST + Explorer UI) | Published on `127.0.0.1` only — reachable from the laptop itself or via SSH local-forward. The api container reaches it container-to-container via the `dicom` docker network (which doesn't go through the host-port mapping at all). | `ORTHANC__AUTHENTICATION_ENABLED=false` — REST and Explorer are anonymous because external reach requires SSH-level auth first. To add Orthanc-level auth see [Accessing Orthanc Explorer](#accessing-orthanc-explorer). |

⚠️ **UFW vs Docker gotcha:** UFW rules do NOT apply to Docker-published ports — Docker manipulates the iptables FORWARD chain while UFW operates on INPUT, so containerized destinations bypass UFW's filter. The `ufw allow from <RFC1918> to any port 4242` rules added in this slice are documentary; the **real LAN-only enforcement** lives in the `DOCKER-USER` iptables chain — see [DOCKER-USER iptables enforcement](#docker-user-iptables-enforcement-lan-only-published-ports).

#### Storage layout

- `/srv/sites/klinika-health/orthanc/postgres_data/` — owner `999:999`, holds the Orthanc Postgres SQL index (study/series/instance metadata, DICOM tags, etc.)
- `/srv/sites/klinika-health/orthanc/storage/` — owner `999:999`, holds the raw DICOM bytes in Orthanc's content-addressed layout (`<hex>/<hex>/<uuid>`)

DICOM bytes deliberately stay on the filesystem (`POSTGRESQL_ENABLE_STORAGE=false`). Putting hundreds of GB of DICOM blobs in Postgres bloats backups, hurts vacuum, and makes the DB the bottleneck. Index in Postgres, payload on disk.

#### Env-var convention

orthancteam/orthanc's `/startup/generateConfiguration.py` walks `os.environ` for keys with the `ORTHANC__` prefix. **Each level of JSON nesting becomes a double underscore.** A few examples:

| Env var | Maps to JSON path |
|---|---|
| `ORTHANC__NAME=DonetaMED` | `"Name": "DonetaMED"` |
| `ORTHANC__DICOM_AET=DONETAMED` | `"DicomAet": "DONETAMED"` |
| `ORTHANC__DICOM_PORT=4242` | `"DicomPort": 4242` |
| `ORTHANC__AUTHENTICATION_ENABLED=false` | `"AuthenticationEnabled": false` |
| `ORTHANC__POSTGRESQL__HOST=orthanc-postgres` | `"PostgreSQL": { "Host": "orthanc-postgres" }` |
| `ORTHANC__POSTGRESQL__ENABLE_INDEX=true` | `"PostgreSQL": { "EnableIndex": true }` |

Plain `POSTGRESQL_HOST` etc. (single underscore) are **not** recognised — the script only inspects keys with the `ORTHANC__` prefix.

#### Required env vars

| Var | Used by | Notes |
|---|---|---|
| `ORTHANC_POSTGRES_PASSWORD` | compose substitution for the orthanc-postgres POSTGRES_PASSWORD and Orthanc's POSTGRESQL__PASSWORD | ≥32 hex chars; independent from `POSTGRES_PASSWORD` |
| `ORTHANC_URL` | api container (`apps/api/src/modules/dicom/orthanc.client.ts`) | `http://orthanc:8042` over the dicom docker net |
| `ORTHANC_WEBHOOK_SECRET` | Klinika api (`apps/api/src/modules/dicom/dicom.controller.ts`) verifies; Orthanc Lua hook sends it as `X-Klinika-Orthanc-Secret` | Shared secret on the webhook path. ≥32 hex chars. The orthanc container also gets a passthrough so the Lua hook can `os.getenv` it. |
| `ORTHANC_WEBHOOK_URL` | Orthanc Lua hook (`infra/compose/orthanc/on-stored.lua`) | Wired in 18b.5d. Points at `http://api:3001/api/dicom/internal/orthanc-event` over the internal `dicom` docker network. |

`ORTHANC_USERNAME` / `ORTHANC_PASSWORD` intentionally **not** set — Orthanc REST authentication is off (port 8042 is on an internal docker network). The api's Orthanc client tolerates absence: `if (user && pass)` gate, no auth header sent otherwise.

#### On-stored webhook flow (18b.5d)

Every time the ultrasound modality C-STOREs an instance into Orthanc, Orthanc fires the `OnStoredInstance` Lua callback in [infra/compose/orthanc/on-stored.lua](compose/orthanc/on-stored.lua). The hook walks **Instance → Study** via Orthanc's in-process REST (`/instances/<id>/study`) to resolve the Orthanc study ID, then POSTs `{studyId, instanceId, timestamp}` to Klinika's bridge endpoint:

```
Orthanc Lua hook → POST http://api:3001/api/dicom/internal/orthanc-event
   Headers:
     Content-Type: application/json
     X-Klinika-Orthanc-Secret: <secret from .env>
     Host: donetamed.klinika.health
```

The **Host header is hard-coded** to the public tenant hostname because Klinika's `ClinicResolutionMiddleware` resolves the tenant from the HTTP Host header — the TCP destination is `api:3001` over the internal docker network, but at the HTTP layer the api needs to see `donetamed.klinika.health` to identify which clinic's `clinicId` to inject into the request context. Hardcoding is acceptable because this Lua file ships with the donetamed compose file (per-clinic deployment). For a future multi-tenant on-prem install the value would become env-driven.

On the receiving end, Klinika's `DicomController.orthancEvent` (no AuthGuard, secret-gated) calls `DicomService.ingestStudyEvent(clinicId, studyId)` which:

1. Calls Orthanc's REST `GET /studies/<id>` for the metadata (description + patient-name DICOM tag).
2. Upserts `dicom_studies` keyed on `(clinic_id, orthanc_study_id)` — idempotent if Orthanc fires multiple stores for the same study (one row, image count updated).

End-to-end smoke test:

```bash
# On the laptop:
python3 /tmp/make_test_dcm.py        # pydicom one-liner generates a fresh DICOM
storescu -aet ULTRASOUND -aec DONETAMED localhost 4242 /tmp/test.dcm
sleep 2

# Confirm the row landed:
docker exec klinika-donetamed-postgres psql -U klinika -d klinika -c \
  "SELECT orthanc_study_id, image_count, study_description, patient_name_dicom
   FROM dicom_studies ORDER BY received_at DESC LIMIT 5;"
```

#### Two gotchas worth knowing

1. **`OnStoredInstance` callback parameters**: Orthanc passes `(instanceId, tags, metadata)` where `metadata` carries transfer-context fields (`RemoteAet`, `CalledAet`, `RemoteIP`, `IndexInSeries`, …) — **not** the parent study ID. You must walk the resource tree via REST (`/instances/<id>` → `ParentSeries` → `/series/<id>` → `ParentStudy`, or the shortcut `/instances/<id>/study` which returns the study directly). The original on-stored.lua tried `metadata['ParentStudy']`, returned early on nil, and silently never fired the webhook. Caught only when running against a live Orthanc — the existing integration tests stub the receiver side, so this bug was invisible in CI.

2. **`ORTHANC__LUA_SCRIPTS` via env var**: orthancteam's `/startup/generateConfiguration.py` runs `json.loads(value)` on every `ORTHANC__`-prefixed env var before merging into the JSON config. So a JSON-encoded array literal `'["/etc/orthanc/lua-scripts/on-stored.lua"]'` works correctly — no need for a mounted `orthanc.json` fragment. The same parser also intercepts env vars ending in `_SECRET` (treats their value as a docker-secrets file path) — for `ORTHANC_WEBHOOK_SECRET` this is a harmless info-log line because no file actually exists at the hex-string path, and Lua's `os.getenv` still returns the true value from the container env.

#### Day-to-day Orthanc commands

```bash
# REST endpoints from inside the api container
docker exec klinika-donetamed-api sh -c 'curl -fsS http://orthanc:8042/system | head -20'
docker exec klinika-donetamed-api sh -c 'curl -fsS http://orthanc:8042/statistics'
docker exec klinika-donetamed-api sh -c 'curl -fsS http://orthanc:8042/studies'

# REST from any one-off container on the dicom net (e.g. for ad-hoc debugging)
docker run --rm --network klinika-donetamed-dicom curlimages/curl:8.10.1 \
  -fsSL http://orthanc:8042/statistics

# DICOM C-ECHO from another machine on the LAN (sanity-check connectivity)
echoscu -aet TESTSCU -aec DONETAMED <laptop-LAN-ip> 4242

# DICOM C-STORE a file from another machine on the LAN
storescu -aet ULTRASOUND -aec DONETAMED <laptop-LAN-ip> 4242 /path/to/sample.dcm

# Delete a study by Orthanc ID (REST)
docker exec klinika-donetamed-api sh -c 'curl -fsS -X DELETE http://orthanc:8042/studies/<orthanc-study-id>'
```

#### Accessing Orthanc Explorer

Orthanc ships with a browser-based admin UI ("Orthanc Explorer 2") at `http://<orthanc>:8042/ui/app/`. It surfaces diagnostics, lets you browse / preview / delete studies, view storage stats, run ad-hoc REST queries, etc. Useful for one-off operator tasks the doctor / receptionist UI doesn't expose. The legacy classic Explorer is still available at `/app/explorer.html` if you prefer the older interface.

The Explorer port (`8042`) is published on the laptop's **loopback only** (`127.0.0.1:8042`). External reach requires SSH local-forward:

```bash
# From your dev machine (or any machine with SSH access to the laptop):
ssh -L 8042:localhost:8042 donetamed-klinika

# Then on your local machine, open in a browser:
#   http://localhost:8042/ui/app/
```

Once Cloudflare Access for SSH lands in 18b.6, this works from anywhere on the internet via your Cloudflare identity — no LAN access to the laptop needed.

**Security posture:** the Explorer is anonymous today — no Orthanc-level auth. This is consistent with the REST API anonymous policy (the REST API and the Explorer share the same `:8042` HTTP listener). Reach is gated at the network layer (loopback binding + SSH-level auth + Cloudflare Access in 18b.6), not by Orthanc itself. To add a second auth layer later:

```yaml
# in infra/compose/docker-compose.donetamed.yml, orthanc service env:
ORTHANC__AUTHENTICATION_ENABLED: "true"
ORTHANC__REGISTERED_USERS: '{"admin": "<bcrypt-or-plaintext-per-orthanc-docs>"}'
```

The Klinika API's Orthanc client then needs `ORTHANC_USERNAME` + `ORTHANC_PASSWORD` (already supported, see [Required env vars](#required-env-vars-1)). Deferred until cutover experience tells us whether the extra auth layer is worth the rotation overhead.

#### Backups

Two tracks — see [Backup procedure](#backup-procedure) for the full strategy:

- **Track A (daily, scripted):** `pg_dump` of the Orthanc Postgres index → included in `backup.sh.example`.
- **Track B (weekly-ish, manual):** rsync of `/srv/sites/klinika-health/orthanc/storage/` (raw DICOM bytes) to external storage — deliberately excluded from the script because ~150 GB/year growth would blow up daily archive size.

#### Current security posture (to revisit at cutover)

- **Any AE title is accepted** (no calling-AET allowlist). The modality just needs to know the called AET (`DONETAMED`) and the laptop's LAN IP+port. Anyone on the clinic LAN who knows those three can push studies.
- **REST + Explorer are anonymous** at the Orthanc layer; reach is gated by the network layer instead (loopback-only publishing on `127.0.0.1:8042` + SSH-level auth to get a tunnel; container-to-container traffic from the api stays on the internal `dicom` docker network and doesn't traverse the host-port mapping at all). See [Accessing Orthanc Explorer](#accessing-orthanc-explorer).
- **TLS** is not configured on DICOM port 4242 (the ultrasound modality probably can't do DICOM-TLS anyway). Plaintext on the clinic LAN is the accepted v1 trade-off; consider modality-side TLS at cutover if the ultrasound supports it.

---

## Required env vars

See [`.env.donetamed.example`](../.env.donetamed.example) for the full annotated template. Required (no defaults):

| Var | Notes |
|---|---|
| `POSTGRES_PASSWORD` | ≥32 hex chars, `openssl rand -hex 32` |
| `AUTH_SECRET` | ≥32 hex chars, `openssl rand -hex 32`. Rotating it invalidates every active session. |
| `SEED_PLATFORM_ADMIN_PASSWORD` | ≥12 chars (seed enforces); the seed aborts otherwise |
| `SEED_DOCTOR_PASSWORD` | same |
| `SEED_RECEPTIONIST_PASSWORD` | same |
| `SEED_CLINIC_ADMIN_PASSWORD` | same |
| `ORTHANC_POSTGRES_PASSWORD` | ≥32 hex chars, independent from `POSTGRES_PASSWORD`. See [18b.5 — Orthanc DICOM](#18b5--orthanc-dicom-server). |
| `ORTHANC_URL` | Defaults to `http://orthanc:8042` (internal docker net). Used by `apps/api/src/modules/dicom/orthanc.client.ts`. |
| `ORTHANC_WEBHOOK_SECRET` | ≥32 hex chars. Validates the `X-Klinika-Orthanc-Secret` header on Orthanc-→-Klinika webhook events. See [On-stored webhook flow](#on-stored-webhook-flow-18b5d). |
| `ORTHANC_WEBHOOK_URL` | `http://api:3001/api/dicom/internal/orthanc-event` — consumed by the Orthanc-side Lua hook. |

Defaults that should be reviewed before first deploy:

| Var | Default | Notes |
|---|---|---|
| `CLINIC_HOST_SUFFIX` | `.klinika.health` | Production suffix mode |
| `JOBS_DISABLED` | `0` | Set to `1` only for one-off CI runs |

The compose file pins image refs to `ghcr.io/ihox/klinika-{api,web}:donetamed` literally — there's no `IMAGE_TAG` env var any more (the 18b.2c contract had one for staging-image reuse; dropped in 18b.4 once dedicated images existed).

---

## Day-to-day operations

All on-laptop commands run as `ilir` with `sudo` from any directory — the compose invocation needs absolute paths to the file and env. Convenience alias for shell sessions:

```bash
alias kc='sudo -u klinika docker compose \
  -f /srv/sites/klinika-health/repo/infra/compose/docker-compose.donetamed.yml \
  --env-file /srv/sites/klinika-health/.env'
```

Then `kc ps`, `kc logs -f api`, `kc restart`, etc.

### Trigger a deploy

Deploys are gated on CI passing. Pushing to `donetamed` triggers the
`CI` workflow first; only when CI completes green does
`deploy-donetamed.yml` fire. If you push with red CI, the laptop
stays on its previous image — no auto-deploy.

To deploy anyway (hot-fix, CI infrastructure issue, or any case
where you've confirmed the red CI is unrelated to the deploy
artifact):

```bash
gh workflow run deploy-donetamed.yml --ref donetamed
```

Manual triggers bypass the CI gate entirely. Use sparingly.

The workflow builds the api + web images on a GitHub-hosted runner, pushes them to GHCR as `:donetamed` and `:donetamed-<sha>`, then hands off to the self-hosted runner on the laptop which pulls, migrates, rolls, and smoke-tests. Total ~5 min wall-clock (first build is closer to 5–8 min cold; subsequent builds ~3–4 min with cache hits).

### Image rollback by SHA tag

Every deploy pushes a `:donetamed-<sha>` immutable tag alongside the mutable `:donetamed`. To pin the laptop to an earlier build:

1. Find the SHA in the GHCR registry or by `git log --oneline donetamed`.
2. Edit `infra/compose/docker-compose.donetamed.yml` to:
   ```yaml
   api:
     image: ghcr.io/ihox/klinika-api:donetamed-<old-sha>
   web:
     image: ghcr.io/ihox/klinika-web:donetamed-<old-sha>
   ```
3. Commit on `donetamed` and push. The deploy workflow will roll the laptop back to those exact images (no rebuild — the tags already exist in GHCR).
4. Once you've fixed forward, swap the lines back to `:donetamed` (mutable) and push again.

Alternative emergency rollback if the deploy workflow itself is broken: SSH into the laptop and edit `/opt/actions-runner/_work/.../docker-compose.donetamed.yml`, then `kc up -d` manually. But you should normally fix forward.

### Manual one-off compose (no CI)

If you need to act on the stack outside of the auto-deploy (e.g. local debugging), the `kc` alias on the laptop runs compose as the `klinika` user using the in-repo file at `/srv/sites/klinika-health/repo/`:

```bash
kc pull
kc up -d
```

This is *separate from* the auto-deploy's workspace at `/opt/actions-runner/_work/...`. Both reach the same containers because compose's project name (`klinika-donetamed`) is in the YAML.

### Update the laptop's repo clone

The clone is only used for the compose file + the seed bind-mount; the api + web run from GHCR images. Still worth keeping in sync:

```bash
sudo -u klinika HOME=/var/lib/klinika bash <<'EOF'
cd /srv/sites/klinika-health/repo
git fetch
git checkout donetamed
git pull --ff-only
EOF
```

### View logs

```bash
kc logs -f --tail=200
# or, single service
kc logs -f api
```

### Service status

```bash
kc ps
```

### Take the stack offline

```bash
kc down
```

Bind-mounted data (`postgres_data/`, `storage/`) survives `down`. Bringing it back up with `kc up -d` resumes from the same state.

### Reset the laptop to empty

Destructive — only use if you're sure. Two paths depending on what you need:

- **Full reset with re-seed + migration prep** — the operator script `/home/ilir/Desktop/clean.sh`. Wipes Klinika + Orthanc data dirs, applies Prisma migrations + sidecar SQL (so `platform_admin_role` exists for the migration tool), re-seeds the four-user fixture, and verifies the empty state. See [Migration tooling (Access → Postgres)](#migration-tooling-access--postgres) for the canonical content.
- **Minimal wipe** — just clear data, no re-seed:
  ```bash
  kc down
  sudo rm -rf /srv/sites/klinika-health/postgres_data
  sudo rm -rf /srv/sites/klinika-health/storage
  sudo install -d -o 70    -g 70    -m 700 /srv/sites/klinika-health/postgres_data
  sudo install -d -o 10001 -g 10001 -m 755 /srv/sites/klinika-health/storage
  # Then re-run the bring-up sequence (migrate + sidecar SQL + seed + up).
  # uids: 70 is postgres in postgres:16-alpine; 10001 is the api image's
  # non-root user. The directory itself is recreated rather than wiped
  # with `rm -rf <dir>/*` so partial wipes (busy file handles, hidden
  # entries) can't silently leave data behind.
  ```

### One-off psql

The postgres container has no host-port mapping — use `docker exec`:

```bash
sudo -u klinika docker exec -it klinika-donetamed-postgres \
  psql -U klinika klinika
```

---

## Backup procedure

Two tracks running on different cadences:

### Track A — daily, automatic, small data (the script)

Canonical copy in repo: [`infra/templates/backup.sh.example`](templates/backup.sh.example). Deployed copy on the laptop at `/srv/sites/klinika-health/backup.sh.example` (mode `0644 root:root`, **not executable** until the operator activates it).

What it captures (each daily archive typically <200 MB):
1. **Klinika Postgres dump** — `pg_dump -U klinika -d klinika` from inside `klinika-donetamed-postgres`
2. **Orthanc Postgres dump** — `pg_dump -U orthanc -d orthanc` from inside `klinika-donetamed-orthanc-postgres` (DICOM metadata index — study/series/instance tags, NOT the DICOM bytes themselves)
3. **Klinika `/storage` tarball** — clinic logos + doctor signatures from `/srv/sites/klinika-health/storage/`
4. **`.env` + `docker-compose.donetamed.yml`** — disaster-recovery config (the archive's `.env` is chmod 0600 because it holds POSTGRES_PASSWORD / AUTH_SECRET / ORTHANC_POSTGRES_PASSWORD)

Activate:

```bash
sudo cp /srv/sites/klinika-health/backup.sh.example \
        /srv/sites/klinika-health/backup.sh
sudo chmod +x /srv/sites/klinika-health/backup.sh
sudo /srv/sites/klinika-health/backup.sh    # manual run
```

Schedule nightly at 02:30 via root cron:

```cron
30 2 * * *  /srv/sites/klinika-health/backup.sh >> /var/log/klinika-backup.log 2>&1
```

Retention: last 14 days locally. Off-site (Backblaze B2 via restic) is intentionally not in v1 — that lands in a later slice once credentials are provisioned.

### Track B — manual, weekly-ish, large data (DICOM payload)

⚠️ **The script DELIBERATELY does NOT back up `/srv/sites/klinika-health/orthanc/storage/`.** At clinic scale that directory grows ~150 GB/year. Including it in the daily archive would balloon each run to multi-GB and 14 days × multi-GB local retention is impractical.

Operator backs it up out-of-band, on a slower schedule (weekly-ish), to external storage (USB drive or NAS):

```bash
# Example: rsync to a mounted USB drive
sudo rsync -a --delete \
  /srv/sites/klinika-health/orthanc/storage/ \
  /mnt/backup-usb/donetamed-orthanc-storage/
```

The Orthanc Postgres dump from Track A is the metadata needed to reattach DICOM files after restore. On restore: copy the storage directory back, restore the Postgres dump, then start Orthanc — it rescans the storage dir at boot and reconciles against the index.

### What this strategy is NOT covering

- **Off-site automated backups** — both tracks land on local disk only. Backblaze B2 via restic is planned in a later slice once credentials are provisioned.
- **Bare-metal disaster recovery of the laptop itself** — Ubuntu install, hardening (UFW, fail2ban, etc.), Docker setup, cloudflared, GitHub runner. Those need re-running on a fresh laptop from the [Initial setup](#initial-setup-one-time-per-fresh-laptop) procedures in this doc.
- **Continuous WAL streaming** — both Postgres instances use `pg_dump` (point-in-time = backup time). For sub-day RPO we'd add streaming WAL archive; not planned for v1.

### Restore procedures (cheat-sheet)

```bash
# 1. Restore Klinika app DB from a backup archive:
gunzip -c $BACKUP/klinika.sql.gz 2>/dev/null || cat $BACKUP/klinika.sql | \
  docker exec -i klinika-donetamed-postgres psql -U klinika -d klinika

# 2. Restore Orthanc metadata DB:
cat $BACKUP/orthanc.sql | \
  docker exec -i klinika-donetamed-orthanc-postgres psql -U orthanc -d orthanc

# 3. Restore Klinika /storage tarball:
sudo tar xzf $BACKUP/storage.tar.gz -C /srv/sites/klinika-health
sudo chown -R 10001:10001 /srv/sites/klinika-health/storage

# 4. Restore Orthanc DICOM bytes from external drive:
sudo rsync -a /mnt/backup-usb/donetamed-orthanc-storage/ \
  /srv/sites/klinika-health/orthanc/storage/
sudo chown -R 999:999 /srv/sites/klinika-health/orthanc/storage

# 5. Bring the stack back up:
sudo -u github-runner docker compose \
  -f /srv/sites/klinika-health/repo/infra/compose/docker-compose.donetamed.yml \
  --env-file /srv/sites/klinika-health/.env \
  up -d
```

---

## Migration tooling (Access → Postgres)

Cutover-day procedure for importing the clinic's existing `PEDIATRIA.accdb` into Klinika's Postgres. Same scripts double as the pre-cutover rehearsal: `clean.sh` → `migrate.sh` → verify → `clean.sh` to leave the laptop empty.

### What's in git, what's not

- **In git, committed:** [`infra/docker/Dockerfile.migration`](docker/Dockerfile.migration) — packages [`tools/migrate/`](../tools/migrate/) (Python 3.12 + `mdbtools`) into a Linux image. ENTRYPOINT is `python /app/migrate.py`; a bundled `config.docker.yaml` defers every variable to env vars (`DATABASE_URL`, `ACCDB_PATH`, `CLINIC_SUBDOMAIN`, `MIGRATION_USER_EMAIL`).
- **NOT in git, operator-local:** `/home/ilir/Desktop/PEDIATRIA.accdb`, `/home/ilir/Desktop/clean.sh`, `/home/ilir/Desktop/migrate.sh`. Paths and laptop-specific. Canonical script content is in this section so anyone can recreate them on a fresh laptop.

### Build the migration image

```bash
cd /srv/sites/klinika-health/repo
sudo -u klinika docker build \
  -f infra/docker/Dockerfile.migration \
  -t klinika-migration:donetamed \
  .
```

Verify the image runs and prints help:

```bash
sudo -u klinika docker run --rm klinika-migration:donetamed --help
```

### Place the source `.accdb`

The file is sensitive (PHI) and large. SCP it to the operator's Desktop:

```bash
# from the dev machine
scp ~/Desktop/PEDIATRIA.accdb donetamed-klinika:/home/ilir/Desktop/PEDIATRIA.accdb

# on the laptop, confirm
ls -la /home/ilir/Desktop/PEDIATRIA.accdb
file /home/ilir/Desktop/PEDIATRIA.accdb   # → Microsoft Access Database
```

The migration image bind-mounts this path read-only at `/data/PEDIATRIA.accdb` at run time — the .accdb never enters the image and stays gitignored.

### `clean.sh` — full reset + re-seed (canonical content)

Place at `/home/ilir/Desktop/clean.sh`, `chmod 0755`. Runs `compose down`, wipes Klinika + Orthanc data dirs, applies Prisma migrations and the sidecar SQL files in [`apps/api/prisma/sql/`](../apps/api/prisma/sql/) (this is what installs `platform_admin_role` + RLS policies — the deploy workflow only runs `prisma migrate deploy` and would skip them otherwise), re-seeds the four-user fixture, brings the full stack up, runs `/health/ready`, and prints row counts so a partial wipe surfaces immediately.

```bash
#!/bin/bash
# Full reset of DonetaMED Klinika state on this laptop.
# WIPES: Klinika postgres, Orthanc postgres, /storage/, /orthanc/storage/.
# RE-SEEDS: admin, doctor (taulant@klinika.health), receptionist (albina@klinika.health),
#           clinic admin (donetamed-admin@klinika.health) via prisma/seed-donetamed.ts.
set -euo pipefail
if [[ "${1:-}" != "--confirm" ]]; then
  echo "WARNING: This will WIPE ALL patient data, Klinika storage, and DICOM files."
  read -r -p "Type 'yes-delete-everything' to proceed: " confirm
  [[ "$confirm" == "yes-delete-everything" ]] || { echo "Aborted."; exit 1; }
fi
REPO=/srv/sites/klinika-health/repo
COMPOSE_FILE=$REPO/infra/compose/docker-compose.donetamed.yml
ENV_FILE=/srv/sites/klinika-health/.env
DC="sudo -u klinika docker compose -f $COMPOSE_FILE --env-file $ENV_FILE"
cd "$REPO"
$DC down --remove-orphans
for _ in $(seq 1 30); do
  remaining=$(sudo -u klinika docker ps -a --filter "label=com.docker.compose.project=klinika-donetamed" --format '{{.ID}}' | wc -l)
  [[ "$remaining" -eq 0 ]] && break
  sleep 1
done
wipe_dir() {
  local dir=$1 uid=$2 gid=$3 mode=$4
  sudo rm -rf "$dir"
  sudo install -d -o "$uid" -g "$gid" -m "$mode" "$dir"
  local left
  left=$(sudo find "$dir" -mindepth 1 -maxdepth 1 | wc -l)
  [[ "$left" -eq 0 ]] || { echo "ERROR: $dir still has $left entries — aborting." >&2; exit 1; }
}
wipe_dir /srv/sites/klinika-health/postgres_data         70    70    700
wipe_dir /srv/sites/klinika-health/orthanc/postgres_data 70    70    700
wipe_dir /srv/sites/klinika-health/storage               10001 10001 755
wipe_dir /srv/sites/klinika-health/orthanc/storage       999   999   755
$DC up -d postgres
until sudo -u klinika docker inspect --format '{{.State.Health.Status}}' klinika-donetamed-postgres 2>/dev/null | grep -q healthy; do sleep 2; done
$DC run --rm api node node_modules/prisma/build/index.js migrate deploy
for f in "$REPO"/apps/api/prisma/sql/*.sql; do
  sudo cat "$f" | sudo -u klinika docker exec -i klinika-donetamed-postgres \
    psql -U klinika -d klinika -v ON_ERROR_STOP=1 > /dev/null
done
$DC run --rm api ./node_modules/.bin/ts-node --transpile-only prisma/seed-donetamed.ts
$DC up -d
sleep 10
curl -fsS http://localhost:8003/health/ready
sudo -u klinika docker exec klinika-donetamed-postgres \
  psql -U klinika -d klinika \
  -c "SELECT count(*) AS patients FROM patients;" \
  -c "SELECT count(*) AS visits FROM visits;" \
  -c "SELECT count(*) AS clinics FROM clinics WHERE deleted_at IS NULL;" \
  -c "SELECT count(*) AS users FROM users WHERE deleted_at IS NULL;"
```

Expected verify output: `patients=0, visits=0, clinics=1, users=3`.

### `migrate.sh` — run the import (canonical content)

Place at `/home/ilir/Desktop/migrate.sh`, `chmod 0755`. Joins the `klinika-donetamed-internal` Docker network, runs the four migration phases in the order matching the local rehearsal on 2026-05-17 (`check → patients → visits → apply-sex-inference → report`), and writes per-run logs to `/home/ilir/migration-logs/<UTC-timestamp>/`.

```bash
#!/bin/bash
set -euo pipefail
ACCDB=/home/ilir/Desktop/PEDIATRIA.accdb
ENV_FILE=/srv/sites/klinika-health/.env
NETWORK=klinika-donetamed-internal
IMAGE=klinika-migration:donetamed
LOG_BASE=/home/ilir/migration-logs
RUN_TS=$(date -u +%Y%m%dT%H%M%SZ)
LOG_DIR=$LOG_BASE/$RUN_TS
[[ -f "$ACCDB" ]] || { echo "ERROR: $ACCDB not found."; exit 1; }
sudo -u klinika docker image inspect "$IMAGE" >/dev/null 2>&1 || { echo "ERROR: build $IMAGE first."; exit 1; }
if [[ "${1:-}" != "--confirm" ]]; then
  read -r -p "Type 'yes-migrate' to proceed: " confirm
  [[ "$confirm" == "yes-migrate" ]] || { echo "Aborted."; exit 1; }
fi
mkdir -p "$LOG_DIR"
PG_USER=$(sudo grep -E '^POSTGRES_USER=' "$ENV_FILE" | cut -d= -f2-); : "${PG_USER:=klinika}"
PG_DB=$(sudo grep -E '^POSTGRES_DB=' "$ENV_FILE" | cut -d= -f2-); : "${PG_DB:=klinika}"
PG_PASS=$(sudo grep -E '^POSTGRES_PASSWORD=' "$ENV_FILE" | cut -d= -f2-)
DATABASE_URL="postgresql://${PG_USER}:${PG_PASS}@klinika-donetamed-postgres:5432/${PG_DB}"
RUN="sudo -u klinika docker run --rm
  --network ${NETWORK}
  -v ${ACCDB}:/data/PEDIATRIA.accdb:ro
  -v ${LOG_DIR}:/app/migration-logs
  -e DATABASE_URL=${DATABASE_URL}
  -e ACCDB_PATH=/data/PEDIATRIA.accdb
  -e CLINIC_SUBDOMAIN=donetamed
  -e MIGRATION_USER_EMAIL=taulant@klinika.health
  ${IMAGE}"
$RUN check               --config /app/config.docker.yaml
$RUN patients            --config /app/config.docker.yaml --commit
$RUN visits              --config /app/config.docker.yaml --commit
$RUN apply-sex-inference --config /app/config.docker.yaml --commit
set +e; $RUN report      --config /app/config.docker.yaml; REPORT_EXIT=$?; set -e
echo "report exit=$REPORT_EXIT (0=PASS)"
sudo -u klinika docker exec klinika-donetamed-postgres \
  psql -U klinika -d klinika \
  -c "SELECT count(*) AS patients FROM patients WHERE legacy_id IS NOT NULL;" \
  -c "SELECT count(*) AS visits FROM visits WHERE legacy_id IS NOT NULL;"
```

Expected counts after a successful run against the 2026-05-10 `.accdb`: `patients=11163, visits=63405`, sex inference `5919 male + 5244 female`, verdict `PASS`. Matches the local 2026-05-17 rehearsal under [`tools/migrate/migration-logs/migration-report.json`](../tools/migrate/migration-logs/migration-report.json) byte-for-byte (same source file sha256).

### Cutover-day sequence

The same scripts that run the rehearsal cycle run the real cutover. On the day:

1. **Take a backup** of the running state (run `backup.sh` if it's been activated, or `pg_dump` manually) before the wipe.
2. **Place the fresh `.accdb`** on `/home/ilir/Desktop/PEDIATRIA.accdb` (the SCP-from-dev path above, or directly from the clinic's existing system on a USB stick).
3. **Reset to empty** — `bash /home/ilir/Desktop/clean.sh` (interactive confirmation). Confirms `0 patients, 0 visits, 1 clinic, 3 users`.
4. **Run the import** — `bash /home/ilir/Desktop/migrate.sh` (interactive confirmation). Verdict must be `PASS` before continuing.
5. **Smoke-check the UI** — log in as Dr. Taulant at `https://donetamed.klinika.health`, search a known patient name from the clinic's existing records, open one chart, print a vërtetim. Confirm the blank-stamp area is in the right place (CLAUDE.md §1.1).
6. If anything is wrong, `clean.sh` again gets you back to a known empty state.

---

## Troubleshooting

### `/health/ready` 5xxs

- API logs first: `kc logs api --tail 200`. Look for "DB readiness probe failed" or "Schema drift detected."
- Run the schema probe directly on the laptop: `curl http://localhost:8003/health/schema`
- Most often `prisma migrate deploy` succeeded but the api container was still warming up. Wait 10 seconds and re-check.

### `Cannot find matching keyid` from corepack inside the api container

The Node 20.18.x base image ships with corepack signing keys that don't match the npm registry's current keys, so the first invocation of `pnpm` by the non-root `klinika` user inside the container fails. **Always call the prisma / ts-node binaries directly**:

```bash
# Migrations
kc run --rm api node node_modules/prisma/build/index.js migrate deploy

# Seed (post-18b.4: seed-donetamed.ts is baked into the :donetamed image)
kc run --rm api ./node_modules/.bin/ts-node --transpile-only prisma/seed-donetamed.ts
```

### Port 8003 already in use

```bash
sudo ss -tlnp | grep ':8003'
```

If something else grabbed the port, change the `127.0.0.1:8003:3000` mapping in `infra/compose/docker-compose.donetamed.yml` (and re-pull / re-up). Cloudflare Tunnel in 18b.3 expects 8003 — keep it stable if possible.

### `clinic_not_found` on the tenant subdomain

The seed didn't run, or the subdomain doesn't match. Re-run the donetamed seed (it's idempotent).

### Git pull says "Permission denied (publickey)"

The deploy key was rotated on GitHub but the on-laptop private key wasn't. Regenerate per "Deploy key for git clone" above and update GitHub Deploy Keys.

### Storage permission denied in api logs

The api container runs as uid 10001 but the bind-mounted directory is owned by something else. Fix:

```bash
kc down api
sudo chown -R 10001:10001 /srv/sites/klinika-health/storage
kc up -d api
```

---

## Security notes

- **No disk encryption (accepted risk).** The laptop ships with no LUKS / no full-disk encryption. Physical security responsibility sits at the clinic — locked office during off-hours, the laptop never leaves the premises. Patient data on disk is therefore protected only by Linux permissions; an attacker with physical boot access can read everything. Reconsider once we can dedicate a maintenance window for the LUKS conversion.
- **SSH** — key-only auth, no root login, fail2ban watching the sshd journal. UFW limits port 22 to RFC1918 (10/8, 172.16/12, 192.168/16). Once 18b.6 happens, the clinic LAN's WAN-side will not reach port 22 anyway; **Cloudflare Access for SSH** (planned in 18b.6) is the off-LAN management path.
- **Docker** — UFW does NOT see Docker's iptables rules by default. The compose file binds the web port to **127.0.0.1 only**; api + postgres have no host port mapping at all. Cloudflare Tunnel is the only external ingress. For the one port that IS published on `0.0.0.0` (Orthanc DICOM 4242), real LAN-only enforcement lives in the `DOCKER-USER` iptables chain — see [DOCKER-USER iptables enforcement](#docker-user-iptables-enforcement-lan-only-published-ports) below.
- **Cloudflare Tunnel** — outbound-only QUIC, no inbound rule needed. The tunnel token lives in `/etc/cloudflared/cloudflared.env` mode `0600 root:root`; the systemd unit reads it via `EnvironmentFile`, NOT as a `--token` CLI flag, so the token is **absent from `ps -ef`** and `/proc/<pid>/cmdline`. See [18b.3 — Cloudflare Tunnel](#18b3--cloudflare-tunnel-for-external-https) for the hardening detail.
- **Secrets at rest** — `.env` is `0640 root:klinika`, GHCR config is `0600`, deploy key is `0600 klinika:klinika`, tunnel env file is `0600 root:root`, runner credentials are inside `0750 github-runner:github-runner` dir.
- **GitHub Actions runner** — runs as `github-runner` (uid 995) with `docker` + `klinika` group membership and **no sudo**. The runner has docker-sock access, which is root-equivalent on this host. Treat any compromise of the GitHub repo or the runner credentials as a host-level breach. Runner credentials at `/opt/actions-runner/.credentials*` are scoped behind the `0750` parent dir.
- **Auto-updates** — `unattended-upgrades` installs Ubuntu security + ESM updates automatically. `Automatic-Reboot=false` so an unexpected reboot can't take the clinic off-line mid-day; the admin reboots manually outside 10:00–18:00.

### DOCKER-USER iptables enforcement (LAN-only published ports)

UFW operates on the `INPUT` chain; Docker manipulates `FORWARD`. Traffic that arrives on the host's external interface destined for a Docker-published port goes through `PREROUTING → FORWARD → DOCKER-USER → DOCKER → container` — **never `INPUT`** — so UFW rules for those ports are advisory only. The `DOCKER-USER` chain runs BEFORE Docker's own `DOCKER` chain and is the supported hook for restricting traffic to published ports.

Rules currently installed (`sudo iptables -L DOCKER-USER -n -v`):

```
1  RETURN  docker0 *  0.0.0.0/0  0.0.0.0/0                                  /* docker0 bridge */
2  RETURN  *       *  192.168.0.0/16  0.0.0.0/0                             /* RFC1918 192.168/16 */
3  RETURN  *       *  172.16.0.0/12   0.0.0.0/0                             /* RFC1918 172.16/12 */
4  RETURN  *       *  10.0.0.0/8      0.0.0.0/0                             /* RFC1918 10/8 (clinic LAN) */
5  RETURN  lo      *  0.0.0.0/0       0.0.0.0/0                             /* loopback */
6  RETURN  *       *  0.0.0.0/0       0.0.0.0/0    state RELATED,ESTABLISHED /* established/related */
7  DROP    *       *  0.0.0.0/0       0.0.0.0/0                             /* drop non-RFC1918 to docker-published ports */
```

Semantics: any RETURN drops out of `DOCKER-USER` and the packet proceeds to the regular `DOCKER` filter chain (which accepts traffic to published ports). Rule 7 catches anything that didn't match a RETURN — public-internet sources hitting any Docker-published port will be silently dropped.

**Why this matters today:** the laptop has no public IP, so in practice nothing illegitimate reaches port 4242 anyway (the LAN router doesn't forward WAN→4242). The DOCKER-USER rules are belt-and-suspenders for the day the laptop gains a public address by accident — a misconfigured router, an unauthenticated VPN tunnel, an ISP DHCP delivering a routable IP, etc.

**Persistence:** rules are saved in `/etc/iptables/rules.v4` via `iptables-persistent` (package `iptables-persistent`, service `netfilter-persistent`, both `enabled` for boot). Survives reboot. Verified by `sudo systemctl restart netfilter-persistent` followed by `sudo iptables -L DOCKER-USER -n -v` — same rules come back.

**To add a new Docker-published port:** no DOCKER-USER change needed; the existing RFC1918-allow + default-DROP applies to every Docker port. Just publish the port in compose.

**To make an exception** (e.g. expose a specific port to a single non-RFC1918 IP), add a more specific RETURN rule BEFORE rule 7:

```bash
sudo iptables -I DOCKER-USER 1 -p tcp -s 203.0.113.42 --dport 4242 -j RETURN \
  -m comment --comment "exception: monitoring scanner"
sudo netfilter-persistent save
```

**To inspect packet hits** (audit which rules are getting matched):

```bash
sudo iptables -L DOCKER-USER -n -v --line-numbers
# pkts/bytes columns show traffic that matched each rule
```

**To recover** if a rule change breaks things and SSH is still up:

```bash
sudo iptables -F DOCKER-USER          # flush all rules in the chain
sudo netfilter-persistent save        # persist the flushed state (or leave unsaved until reboot)
```

SSH itself is not Docker-published (port 22 is host sshd), so DOCKER-USER cannot lock you out of SSH.

---

## Future phases

| Slice | Adds |
|---|---|
| ✅ 18b.3 | Cloudflare Tunnel for external HTTPS — DONE, see [18b.3 section above](#18b3--cloudflare-tunnel-for-external-https) |
| ✅ 18b.4 | Self-hosted runner + auto-deploy + dedicated `:donetamed` image tag — DONE, see [18b.4 section above](#18b4--self-hosted-runner--auto-deploy) |
| ✅ 18b.5 | Orthanc DICOM server, infra-only (no app-code changes; api's pre-existing Orthanc client wires up via `ORTHANC_URL`) — DONE, see [18b.5 section above](#18b5--orthanc-dicom-server) |
| 18b.6 | Production cutover at the clinic (see checklist below) |

### 18b.6 — Cutover checklist (planned)

The day the laptop physically moves to the clinic and starts serving real patients. Each item below should be a runnable step with no ambiguity by the time we get there.

- [ ] **Static IP on the laptop's Ethernet interface** (currently WiFi-only; clinic LAN gives DHCP today, but a static lease keeps cloudflared / fail2ban / backups consistent across reboots). Configure via `netplan`.
- [ ] **Connect ultrasound to the clinic LAN**, configure its DICOM destination on the modality. Settings to enter into the ultrasound's DICOM config page:
  - **Called AE Title (AEC)**: `DONETAMED`
  - **Host**: the laptop's static LAN IP at the clinic
  - **Port**: `4242`
  - **Transfer syntax**: any (Orthanc accepts all)
  - **Calling AE Title (AET)**: anything — Orthanc accepts any calling AET today (tighten via a `ORTHANC__DICOM_MODALITIES` allowlist after we know the modality's actual AET)
  Sanity-check from another machine on the clinic LAN with `echoscu -aet TESTSCU -aec DONETAMED <laptop-IP> 4242` before pointing the real ultrasound at it.
- [ ] **Tighten Orthanc DICOM AET allowlist** — once the ultrasound is verified pushing studies, add `ORTHANC__DICOM_ALWAYS_ALLOW_STORE=false` and an explicit modality entry under `ORTHANC__DICOM_MODALITIES` so only the registered ultrasound can C-STORE.
- [ ] **Run patient migration** with the fresh `.accdb` exported from the clinic's existing system. The on-laptop scripts handle the whole cycle:
  ```bash
  bash /home/ilir/Desktop/clean.sh    # wipe + re-seed + sidecar SQL
  bash /home/ilir/Desktop/migrate.sh  # check → patients → visits → sex inference → report
  ```
  Build the migration image first if it's not present (`docker build -f infra/docker/Dockerfile.migration -t klinika-migration:donetamed .`). Expected counts against the 2026-05-10 export: 11,163 patients + 63,405 visits (verdict `PASS`). Full procedure: [Migration tooling (Access → Postgres)](#migration-tooling-access--postgres).
- [ ] **Cloudflare Access for SSH** so the laptop can be managed from outside the clinic LAN once UFW + RFC1918 restrictions cut off off-LAN SSH. Pattern: a Cloudflare tunnel route for SSH + an Access policy gating it on the operator's Cloudflare identity.
- [ ] **Train Dr. Taulant + Albina** on the live UI. Walk through booking flow, walk-in flow, calendar, vërtetim PDF, password change. Hand over the four `SEED_*_PASSWORD` values (from a password manager, never email).
- [ ] **Operator handover** — the clinic's IT contact gets read-only SSH access via Cloudflare Access, the runbook URL, and an escalation path (Telegram / email) for incidents.
- [ ] **Set the laptop to Auto-power-on on AC restore** in BIOS so a power blip doesn't take the clinic offline waiting for someone to press the button.
- [ ] **Activate `backup.sh`** with the nightly cron at 02:30.
- [ ] **Smoke-test the full path on cutover day** with real DNS, real laptop placement, real internet at the clinic:
  - `curl https://donetamed.klinika.health/health/ready`
  - Log in as Dr. Taulant from a clinic workstation
  - Print a vërtetim, confirm the blank-stamp area is in the right place (CLAUDE.md §1.1)
  - Push an ultrasound image from the modality, confirm it appears in the chart

---

## Environment notes (current laptop)

- **Hardware** — Lenovo ThinkBook 13s G2 ITL, 16 GiB RAM, 468 GB NVMe, Ubuntu 24.04.4 LTS
- **Timezone** — `Europe/Belgrade` (Kosovo's IANA zone — `Europe/Pristina` doesn't exist in tzdata; same offset and DST rules)
- **Network** — Currently WiFi-only (`wlp0s20f3`). Ethernet at the clinic in 18b.6.
- **Kernel** — `linux-generic-hwe-24.04` rolling stack (currently 6.17). Auto-bumps with HWE point releases.

---

## What lives where

| Concern | Location |
|---|---|
| Tenancy host config | `CLINIC_HOST_SUFFIX` in `.env` (suffix mode) |
| Public hostnames | Cloudflare DNS for `klinika.health` zone (CNAME auto-managed by the tunnel) |
| TLS termination | Cloudflare edge; the laptop never sees TLS |
| Cloudflare tunnel config | Cloudflare Zero Trust dashboard (tunnel name `donetamed-laptop`); ingress rule `donetamed.klinika.health → http://localhost:8003` |
| Cloudflare tunnel token | `/etc/cloudflared/cloudflared.env` (mode 0600 root:root) |
| cloudflared systemd unit | `/etc/systemd/system/cloudflared.service` |
| Container images | `ghcr.io/ihox/klinika-{api,web}:donetamed` (mutable) + `:donetamed-<sha>` (immutable, for rollback) |
| Compose file (canonical) | [infra/compose/docker-compose.donetamed.yml](compose/docker-compose.donetamed.yml) on the `donetamed` branch |
| Auto-deploy workflow | `.github/workflows/deploy-donetamed.yml` (lives on both `main` and `donetamed`; identical content) |
| Environment + secrets | `/srv/sites/klinika-health/.env` on the laptop only — gitignored |
| Database files (Klinika app) | `/srv/sites/klinika-health/postgres_data` (uid 999) |
| Clinic logos + signatures | `/srv/sites/klinika-health/storage` (uid 10001) |
| DICOM files (Orthanc payload) | `/srv/sites/klinika-health/orthanc/storage/` (uid 999) |
| Orthanc SQL index | `/srv/sites/klinika-health/orthanc/postgres_data/` (uid 999) |
| Orthanc DICOM AET / port / hostname | AET `DONETAMED` / TCP 4242 / laptop's LAN IP. Set via `ORTHANC__DICOM_AET` / `ORTHANC__DICOM_PORT` in compose. |
| Repo clone (ops/reference) | `/srv/sites/klinika-health/repo` (donetamed branch, read-only deploy key) |
| Runner work tree | `/opt/actions-runner/_work/klinika.health/klinika.health/` (recreated per job) |
| Runner credentials | `/opt/actions-runner/.credentials*` (scoped behind 0750 parent dir) |
| GHCR pull credentials | `/root/.docker/config.json` + `/var/lib/klinika/.docker/config.json` (mode 0600) |
| Deploy key (private, for git clone) | `/var/lib/klinika/.ssh/id_github_klinika` (mode 0600 klinika:klinika) |
| Seed credentials | `SEED_*_PASSWORD` rows in `.env` on the laptop |
| Backup template (canonical) | [`infra/templates/backup.sh.example`](templates/backup.sh.example) in the repo |
| Backup template (deployed) | `/srv/sites/klinika-health/backup.sh.example` on the laptop (mode 0644 root:root, not yet activated) |
| Backup target (local) | `/var/backups/klinika-donetamed/<TIMESTAMP>/` once `backup.sh` runs |
| Orthanc DICOM payload backup | NOT in `backup.sh` — manual rsync to external storage on weekly-ish cadence (see [Backup procedure → Track B](#track-b--manual-weekly-ish-large-data-dicom-payload)) |

---

## What's NOT here yet (planned)

- **Ultrasound print-template DICOM rendering** — `print.service.ts` currently passes `ultrasoundImages: []` to the renderer, so the page-2 grid still shows SVG placeholders even though `dicom_studies` is now populated. Wiring the renderer to query `VisitDicomLink` and fetch base64 preview bytes from Orthanc is a separate dev slice (~half a day, app-code).
- **DICOM AET allowlist** — today Orthanc accepts C-STORE from any calling AET. Tighten at cutover (see [18b.6 checklist](#18b6--cutover-checklist-planned)).
- `.accdb` patient migration tooling and runbook — DONE (see [Migration tooling (Access → Postgres)](#migration-tooling-access--postgres)); cutover-day execution still owed by 18b.6
- Cloudflare Access for SSH — 18b.6 (so the laptop can be SSHed from outside the clinic LAN)
- Static IP / Ethernet on the laptop — 18b.6 (the clinic move)
- Off-site backups (Backblaze B2 via restic) — later slice once credentials are provisioned
- Per-clinic SMTP — configured via Cilësimet → Stampa once the doctor has SMTP credentials
- LUKS / full-disk encryption — accepted v1 risk, reconsider in a later maintenance window
- Production cloud (non-DonetaMED tenants) — separate environment, lands in slice 18c
