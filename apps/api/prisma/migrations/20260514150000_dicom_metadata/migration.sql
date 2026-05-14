-- Slice 16 — extend dicom_studies with descriptive metadata.
--
-- Adds two columns the bridge module fills in at ingest time:
--
--   study_description   — DICOM (0008,1030) Study Description, e.g.
--                         "Ultrasound Abdomen". Shown on the picker
--                         card subtitle so the doctor can disambiguate
--                         studies received close in time.
--   patient_name_dicom  — DICOM (0010,0010) Patient Name. Used in v2
--                         for MWL fuzzy-match suggestions; recorded
--                         now so we don't need a schema migration
--                         later. Treated as PHI for logging.
--
-- Plus a new index on (received_at) for the manual-picker query
-- (most-recent 10 across the clinic).

-- AddColumn
ALTER TABLE "dicom_studies"
  ADD COLUMN "study_description" TEXT,
  ADD COLUMN "patient_name_dicom" TEXT;

-- CreateIndex
CREATE INDEX "dicom_studies_received_at_idx" ON "dicom_studies"("received_at");
