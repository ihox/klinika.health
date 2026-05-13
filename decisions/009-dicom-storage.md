# ADR 009: DICOM storage (permanent on clinic mini-PC + mandatory Backblaze backups)

Date: 2026-05-13
Status: Accepted

## Context

Klinika integrates with the doctor's GE Versana Balance ultrasound, which produces DICOM images. Requirements:
- The ultrasound speaks DICOM only on the clinic's LAN (cannot send directly to a cloud server)
- Pediatric medical imaging retention requirements are long (often 21+ years)
- The doctor needs to attach ultrasound studies to visits and view images later
- DICOM images must never leave the clinic without authentication

Storage options considered:
- **Cloud-only storage** (S3 / Backblaze B2) — requires ultrasound to push to cloud, which it can't do natively
- **Local-only on clinic mini-PC** — no redundancy, single point of failure
- **Local primary + cloud backup** — defense in depth, recoverable
- **Local primary + retention policy** (e.g. 5 years local, then auto-archive)

## Decision

**Permanent storage on the clinic's mini-PC, with mandatory encrypted offsite backups to Backblaze B2.**

Architecture:
1. Ultrasound machine pushes DICOM to **Orthanc** running on the clinic's mini-PC
2. Orthanc stores DICOM files in `/mnt/dicom-storage/` (configured `StorageDirectory`, mounted on 2TB HDD)
3. Klinika's API has a module that polls/queries Orthanc and exposes images via authenticated proxy endpoints
4. Nightly differential backups + weekly full backups encrypt and ship to Backblaze B2 via `restic`
5. Storage usage monitored daily; alerts at 80% and 95% capacity
6. RAID 1 mirror recommended at the on-premise install (additional ~€80 hardware cost)

**DICOM images never leave the clinic LAN** in their raw form. Klinika serves them via authenticated proxy endpoints that require a valid session and verify the requesting user has access to the linked visit.

**No retention policy in v1.** Images are stored forever unless explicitly deleted by a platform admin (rare, e.g. right-to-erasure requests).

## Consequences

**Pros:**
- Aligns with the ultrasound's native protocol (DICOM on LAN)
- Long retention satisfies medical record requirements
- Backblaze backups protect against hardware failure
- Costs are bounded: ~30GB/year per clinic at typical scan volume (~10 scans/day, ~15MB average)
- 2TB HDD lasts ~60 years at this rate — operational lifetime exceeds hardware lifetime
- DICOM stays on the clinic's network = strong privacy story
- Doctor's existing workflow (scan → DICOM → review) is preserved

**Cons:**
- Storage management is per-clinic (each clinic has its own DICOM volume)
- HDD failure without RAID 1 + backups = catastrophic data loss (mitigated by mandatory backups)
- Backup costs scale linearly with imaging volume (~$5-15/month per clinic at Backblaze prices)
- Restoring from Backblaze after total mini-PC failure takes hours (acceptable for non-emergency recovery)

**Accepted trade-offs:**
- We require RAID 1 hardware recommendation (+€80) but don't enforce it
- We require Backblaze backups as a hard policy (not optional)
- We accept that DICOM is locked to on-premise model (cannot serve cloud-only clinics with this feature)

## Revisit when

- Storage growth exceeds projections (e.g. clinic does 50+ scans/day)
- A clinic wants cloud-only DICOM (would require modality-side cloud-DICOM gateway, complex)
- Backblaze pricing changes significantly
- A new DICOM protocol enables direct cloud streaming (unlikely soon)

## Implementation notes

- Orthanc configured with TLS for ultrasound → Orthanc connection (modality-side TLS support is mandatory)
- Orthanc REST API behind authentication (Klinika API authenticates as Orthanc admin user with a strong credential stored in `.env`)
- Klinika exposes:
  - `GET /api/dicom/studies?limit=10` — latest studies for the manual picker
  - `GET /api/dicom/studies/:id` — study details
  - `GET /api/dicom/instances/:id/preview.png` — rendered preview image (cached)
  - `GET /api/dicom/instances/:id/full.dcm` — full DICOM file (rare, authenticated, audited)
- Audit log captures every DICOM image access by user + visit context
- Backup retention: 30 daily + 12 monthly. Quarterly restore tests as part of runbook.
- Storage monitoring:
  - 80% capacity → daily digest alert
  - 95% capacity → immediate critical alert
  - Telemetry agent reports usage hourly
