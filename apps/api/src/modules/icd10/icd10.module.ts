import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { Icd10Controller } from './icd10.controller';
import { Icd10Service } from './icd10.service';

/**
 * ICD-10 search surface. Read-only — usage counts are written by
 * {@link VisitsService} at visit-save time, so this module does not
 * touch `doctor_diagnosis_usage` directly.
 */
@Module({
  imports: [AuthModule],
  controllers: [Icd10Controller],
  providers: [Icd10Service],
  exports: [Icd10Service],
})
export class Icd10Module {}
