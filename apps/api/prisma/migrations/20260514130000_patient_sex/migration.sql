-- Slice 7 — add the `patient_sex` enum and optional `sex` column on
-- patients. Receptionists never see this column (server-side DTO
-- filter); doctors set it manually in the patient form.

-- CreateEnum
CREATE TYPE "patient_sex" AS ENUM ('m', 'f');

-- AlterTable
ALTER TABLE "patients" ADD COLUMN "sex" "patient_sex";
