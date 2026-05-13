-- CreateEnum
CREATE TYPE "clinic_status" AS ENUM ('active', 'suspended');

-- CreateEnum
CREATE TYPE "user_role" AS ENUM ('doctor', 'receptionist', 'clinic_admin');

-- CreateEnum
CREATE TYPE "appointment_status" AS ENUM ('scheduled', 'completed', 'no_show', 'cancelled');

-- CreateTable
CREATE TABLE "clinics" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "subdomain" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "short_name" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "phones" TEXT[],
    "email" TEXT NOT NULL,
    "hours_config" JSONB NOT NULL,
    "payment_codes" JSONB NOT NULL,
    "logo_url" TEXT NOT NULL,
    "signature_url" TEXT NOT NULL,
    "smtp_config" JSONB,
    "status" "clinic_status" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "clinics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "clinic_id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "role" "user_role" NOT NULL,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "title" TEXT,
    "credential" TEXT,
    "signature_url" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_login_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_admins" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_login_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_admins_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "patients" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "clinic_id" UUID NOT NULL,
    "legacy_id" INTEGER,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "date_of_birth" DATE NOT NULL,
    "place_of_birth" TEXT,
    "birth_weight_g" INTEGER,
    "birth_head_circumference_cm" DECIMAL(5,2),
    "birth_length_cm" DECIMAL(5,2),
    "alergji_tjera" TEXT,
    "phone" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "patients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "visits" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "clinic_id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "legacy_id" INTEGER,
    "visit_date" DATE NOT NULL,
    "complaint" TEXT,
    "feeding_notes" TEXT,
    "feeding_breast" BOOLEAN NOT NULL DEFAULT false,
    "feeding_formula" BOOLEAN NOT NULL DEFAULT false,
    "feeding_solid" BOOLEAN NOT NULL DEFAULT false,
    "weight_g" INTEGER,
    "height_cm" DECIMAL(5,2),
    "head_circumference_cm" DECIMAL(5,2),
    "temperature_c" DECIMAL(4,2),
    "payment_code" CHAR(1),
    "examinations" TEXT,
    "ultrasound_notes" TEXT,
    "legacy_diagnosis" TEXT,
    "prescription" TEXT,
    "lab_results" TEXT,
    "followup_notes" TEXT,
    "other_notes" TEXT,
    "created_by" UUID NOT NULL,
    "updated_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "visits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "visit_diagnoses" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "visit_id" UUID NOT NULL,
    "icd10_code" TEXT NOT NULL,
    "order_index" INTEGER NOT NULL,

    CONSTRAINT "visit_diagnoses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "icd10_codes" (
    "code" TEXT NOT NULL,
    "latin_description" TEXT NOT NULL,
    "chapter" TEXT NOT NULL,
    "common" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "icd10_codes_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "prescription_lines" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "clinic_id" UUID NOT NULL,
    "line_text" TEXT NOT NULL,
    "use_count" INTEGER NOT NULL DEFAULT 1,
    "last_used_at" TIMESTAMPTZ(6) NOT NULL,
    "first_used_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "prescription_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "appointments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "clinic_id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "scheduled_for" TIMESTAMPTZ(6) NOT NULL,
    "duration_minutes" INTEGER NOT NULL,
    "status" "appointment_status" NOT NULL DEFAULT 'scheduled',
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "appointments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vertetime" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "clinic_id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "visit_id" UUID NOT NULL,
    "issued_by" UUID NOT NULL,
    "issued_at" TIMESTAMPTZ(6) NOT NULL,
    "absence_from" DATE NOT NULL,
    "absence_to" DATE NOT NULL,
    "diagnosis_snapshot" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vertetime_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dicom_studies" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "clinic_id" UUID NOT NULL,
    "orthanc_study_id" TEXT NOT NULL,
    "received_at" TIMESTAMPTZ(6) NOT NULL,
    "image_count" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dicom_studies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "visit_dicom_links" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "visit_id" UUID NOT NULL,
    "dicom_study_id" UUID NOT NULL,
    "linked_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "linked_by" UUID NOT NULL,

    CONSTRAINT "visit_dicom_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "clinic_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "action" TEXT NOT NULL,
    "resource_type" TEXT NOT NULL,
    "resource_id" UUID NOT NULL,
    "changes" JSONB,
    "ip_address" INET NOT NULL,
    "user_agent" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "timestamp" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "clinics_subdomain_key" ON "clinics"("subdomain");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_clinic_id_idx" ON "users"("clinic_id");

-- CreateIndex
CREATE UNIQUE INDEX "platform_admins_email_key" ON "platform_admins"("email");

-- CreateIndex
CREATE INDEX "patients_clinic_id_idx" ON "patients"("clinic_id");

-- CreateIndex
CREATE UNIQUE INDEX "patients_clinic_id_legacy_id_key" ON "patients"("clinic_id", "legacy_id");

-- CreateIndex
CREATE INDEX "visits_clinic_id_idx" ON "visits"("clinic_id");

-- CreateIndex
CREATE INDEX "visits_patient_id_idx" ON "visits"("patient_id");

-- CreateIndex
CREATE UNIQUE INDEX "visits_clinic_id_legacy_id_key" ON "visits"("clinic_id", "legacy_id");

-- CreateIndex
CREATE INDEX "visit_diagnoses_visit_id_idx" ON "visit_diagnoses"("visit_id");

-- CreateIndex
CREATE INDEX "visit_diagnoses_icd10_code_idx" ON "visit_diagnoses"("icd10_code");

-- CreateIndex
CREATE INDEX "icd10_codes_common_idx" ON "icd10_codes"("common");

-- CreateIndex
CREATE INDEX "prescription_lines_user_id_idx" ON "prescription_lines"("user_id");

-- CreateIndex
CREATE INDEX "prescription_lines_clinic_id_idx" ON "prescription_lines"("clinic_id");

-- CreateIndex
CREATE INDEX "appointments_clinic_id_idx" ON "appointments"("clinic_id");

-- CreateIndex
CREATE INDEX "appointments_patient_id_idx" ON "appointments"("patient_id");

-- CreateIndex
CREATE INDEX "appointments_scheduled_for_idx" ON "appointments"("scheduled_for");

-- CreateIndex
CREATE INDEX "vertetime_clinic_id_idx" ON "vertetime"("clinic_id");

-- CreateIndex
CREATE INDEX "vertetime_patient_id_idx" ON "vertetime"("patient_id");

-- CreateIndex
CREATE INDEX "vertetime_visit_id_idx" ON "vertetime"("visit_id");

-- CreateIndex
CREATE INDEX "dicom_studies_clinic_id_idx" ON "dicom_studies"("clinic_id");

-- CreateIndex
CREATE UNIQUE INDEX "dicom_studies_clinic_id_orthanc_study_id_key" ON "dicom_studies"("clinic_id", "orthanc_study_id");

-- CreateIndex
CREATE INDEX "visit_dicom_links_visit_id_idx" ON "visit_dicom_links"("visit_id");

-- CreateIndex
CREATE INDEX "visit_dicom_links_dicom_study_id_idx" ON "visit_dicom_links"("dicom_study_id");

-- CreateIndex
CREATE UNIQUE INDEX "visit_dicom_links_visit_id_dicom_study_id_key" ON "visit_dicom_links"("visit_id", "dicom_study_id");

-- CreateIndex
CREATE INDEX "audit_log_clinic_id_timestamp_idx" ON "audit_log"("clinic_id", "timestamp");

-- CreateIndex
CREATE INDEX "audit_log_resource_type_resource_id_idx" ON "audit_log"("resource_type", "resource_id");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_clinic_id_fkey" FOREIGN KEY ("clinic_id") REFERENCES "clinics"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "patients" ADD CONSTRAINT "patients_clinic_id_fkey" FOREIGN KEY ("clinic_id") REFERENCES "clinics"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "visits" ADD CONSTRAINT "visits_clinic_id_fkey" FOREIGN KEY ("clinic_id") REFERENCES "clinics"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "visits" ADD CONSTRAINT "visits_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "visits" ADD CONSTRAINT "visits_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "visits" ADD CONSTRAINT "visits_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "visit_diagnoses" ADD CONSTRAINT "visit_diagnoses_visit_id_fkey" FOREIGN KEY ("visit_id") REFERENCES "visits"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "visit_diagnoses" ADD CONSTRAINT "visit_diagnoses_icd10_code_fkey" FOREIGN KEY ("icd10_code") REFERENCES "icd10_codes"("code") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "prescription_lines" ADD CONSTRAINT "prescription_lines_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "prescription_lines" ADD CONSTRAINT "prescription_lines_clinic_id_fkey" FOREIGN KEY ("clinic_id") REFERENCES "clinics"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_clinic_id_fkey" FOREIGN KEY ("clinic_id") REFERENCES "clinics"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "vertetime" ADD CONSTRAINT "vertetime_clinic_id_fkey" FOREIGN KEY ("clinic_id") REFERENCES "clinics"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "vertetime" ADD CONSTRAINT "vertetime_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "vertetime" ADD CONSTRAINT "vertetime_visit_id_fkey" FOREIGN KEY ("visit_id") REFERENCES "visits"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "vertetime" ADD CONSTRAINT "vertetime_issued_by_fkey" FOREIGN KEY ("issued_by") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "dicom_studies" ADD CONSTRAINT "dicom_studies_clinic_id_fkey" FOREIGN KEY ("clinic_id") REFERENCES "clinics"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "visit_dicom_links" ADD CONSTRAINT "visit_dicom_links_visit_id_fkey" FOREIGN KEY ("visit_id") REFERENCES "visits"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "visit_dicom_links" ADD CONSTRAINT "visit_dicom_links_dicom_study_id_fkey" FOREIGN KEY ("dicom_study_id") REFERENCES "dicom_studies"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "visit_dicom_links" ADD CONSTRAINT "visit_dicom_links_linked_by_fkey" FOREIGN KEY ("linked_by") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

