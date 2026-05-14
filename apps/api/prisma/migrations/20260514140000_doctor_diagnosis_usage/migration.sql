-- Slice 13 — per-doctor ICD-10 usage counts.
--
-- Drives the "frequently-used" boost in the diagnosis picker. One row
-- per (doctor, icd10_code); incremented at visit-save time. Per-doctor
-- (not per-clinic) so two doctors sharing a clinic keep distinct
-- pediatric sub-specialty lists.

-- CreateTable
CREATE TABLE "doctor_diagnosis_usage" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "clinic_id" UUID NOT NULL,
    "doctor_id" UUID NOT NULL,
    "icd10_code" TEXT NOT NULL,
    "use_count" INTEGER NOT NULL DEFAULT 1,
    "last_used_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "doctor_diagnosis_usage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "doctor_diagnosis_usage_doctor_id_icd10_code_key"
    ON "doctor_diagnosis_usage"("doctor_id", "icd10_code");

-- CreateIndex
CREATE INDEX "doctor_diagnosis_usage_clinic_id_idx"
    ON "doctor_diagnosis_usage"("clinic_id");

-- CreateIndex
CREATE INDEX "doctor_diagnosis_usage_doctor_id_use_count_last_used_at_idx"
    ON "doctor_diagnosis_usage"("doctor_id", "use_count" DESC, "last_used_at" DESC);

-- AddForeignKey
ALTER TABLE "doctor_diagnosis_usage" ADD CONSTRAINT "doctor_diagnosis_usage_clinic_id_fkey"
    FOREIGN KEY ("clinic_id") REFERENCES "clinics"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "doctor_diagnosis_usage" ADD CONSTRAINT "doctor_diagnosis_usage_doctor_id_fkey"
    FOREIGN KEY ("doctor_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "doctor_diagnosis_usage" ADD CONSTRAINT "doctor_diagnosis_usage_icd10_code_fkey"
    FOREIGN KEY ("icd10_code") REFERENCES "icd10_codes"("code") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- RLS — tenant isolation. Mirrors the policy on every clinic-scoped
-- table (see prisma/sql/001_rls_indexes_triggers.sql for the canonical
-- pattern).
ALTER TABLE "doctor_diagnosis_usage" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "doctor_diagnosis_usage" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "doctor_diagnosis_usage";
CREATE POLICY tenant_isolation ON "doctor_diagnosis_usage"
  USING ("clinic_id" = current_setting('app.clinic_id', true)::uuid)
  WITH CHECK ("clinic_id" = current_setting('app.clinic_id', true)::uuid);
