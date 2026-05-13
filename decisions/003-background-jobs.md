# ADR 003: Background jobs with pg-boss

Date: 2026-05-13
Status: Accepted

## Context

Klinika needs a background job system for:
- Sending emails (MFA codes, new-device alerts, system notifications)
- Generating PDFs in batches if requested
- Scheduled cleanups (sessions older than 30 days, soft-deleted records past retention)
- DICOM thumbnail generation (post-DICOM-receive hook)
- Telemetry batch uploads to platform
- Periodic backups orchestration

We need a job system that's reliable (jobs don't get lost), observable (we can see what's running), and operationally simple (no extra infrastructure to babysit).

Options considered:
- **Redis + BullMQ** — fast, mature, popular in the Node ecosystem
- **Temporal** — durable workflow engine, overkill for our scale
- **pg-boss** — Postgres-backed queue, no extra infra
- **AWS SQS / Cloudflare Queues** — cloud-native, adds external dependency
- **node-cron + custom queue table** — DIY, error-prone

## Decision

Use **pg-boss** with the existing Postgres instance. No Redis. No external job infrastructure.

pg-boss provides job queueing, scheduling, retries with backoff, archiving, and observability through standard SQL queries. It runs as part of the NestJS process — no separate worker daemons in v1.

## Consequences

**Pros:**
- Zero additional infrastructure to manage (Postgres is already there)
- Transactional safety: jobs queued in the same transaction as data writes (atomic with the trigger event)
- Backups already include the job queue state — no extra backup config
- Job queue is queryable SQL — debugging is just `SELECT * FROM pgboss.job WHERE state = 'failed'`
- Pg-boss is mature, actively maintained, used in production by many teams
- One less component to monitor and alert on

**Cons:**
- Lower throughput ceiling than Redis-backed queues (~1000 jobs/sec vs ~50000)
- Job processing competes with application queries for Postgres connections
- Long-running jobs hold transactions longer than typical app queries
- Some advanced patterns (priority queues, fair queues across clinics) require more setup

**Accepted trade-offs:**
- Throughput ceiling is ~1000x our actual needs (clinic-scale: ~100-1000 jobs/day per clinic)
- Postgres connection pressure is negligible at our scale
- We accept the simplicity for now

## Revisit when

- Total jobs/second across all clinics exceeds ~100 sustained
- Job latency p95 exceeds 5 seconds for routine jobs
- We need cross-region job processing (would require external queue)
- Postgres CPU is repeatedly bottlenecked by queue activity

If we migrate, BullMQ on Redis is the likely path — its API is similar enough that migration is mechanical.
