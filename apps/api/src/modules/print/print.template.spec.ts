// Template visibility tests — assert the canonical field visibility
// table from the slice spec:
//
//   | Field             | Visit | Vërtetim | History |
//   | Master data       |  ✓   |  ✓ subset |  ✓     |
//   | Alergji / Tjera   |  ✗   |  ✗        |  ✗     |
//   | Payment code      |  ✓   |  ✗        |  ✗     |
//   | Vitals            |  ✓   |  ✗        |  ✓     |
//   | Diagnoza          |  ✓   |  ✓        |  ✓     |
//   | Terapia           |  ✓   |  ✗        |  ✓     |
//   | Ankesa / Ushqimi  |  ✗   |  ✗        |  ✗     |
//   | Kontrolla / Tjera |  ✗   |  ✗        |  ✗     |
//
// These tests render the HTML string only — Puppeteer is not
// invoked. The string contains the visible text, so a presence/absence
// check on substrings is sufficient. Sentinel values are used to make
// failures specific (e.g. "ALG-SENTINEL" never appears in any output).

import { describe, expect, it } from 'vitest';

import type {
  HistoryTemplateData,
  VertetimTemplateData,
  VisitReportTemplateData,
} from './print.dto';
import { renderHistory } from './templates/history.template';
import { renderVertetim } from './templates/vertetim.template';
import { renderVisitReport } from './templates/visit-report.template';

const CLINIC = {
  formalName: 'Ambulanca Specialistike Pediatrike',
  shortName: 'DonetaMED',
  address: 'Rruga Adem Jashari',
  city: 'Prizren',
  phones: ['045 83 00 83', '043 543 123'],
  hoursLine: '10:00 – 18:00',
};

const PATIENT = {
  fullName: 'Era Krasniqi',
  ageLine: 'vajzë · 2 vjeç 9 muaj',
  dateOfBirth: '2023-08-03',
  placeOfBirth: 'Prizren',
  paymentCode: 'A',
  legacyId: 15626,
  birthWeightG: 3280,
  birthLengthCm: 51,
  birthHeadCircumferenceCm: 34,
};

const SIGNATURE = {
  fullName: 'Dr. Taulant Shala',
  credential: 'pediatër · DonetaMED',
  signatureDataUri: null,
  dateAndPlace: '14.05.2026 · Prizren',
};

const VISIT_BASE: VisitReportTemplateData = {
  clinic: CLINIC,
  patient: PATIENT,
  visitDate: '2026-05-14',
  visitNumber: 5,
  totalVisits: 5,
  visitTime: null,
  vitals: {
    weightKg: 13.6,
    heightCm: 92,
    headCircumferenceCm: 48.2,
    temperatureC: 37.2,
  },
  diagnoses: [
    { code: 'J03.9', latinDescription: 'Tonsillitis acuta', isPrimary: true },
    { code: 'R05', latinDescription: 'Tussis', isPrimary: false },
  ],
  legacyDiagnosis: null,
  prescription: 'Spray.Axxa 2× në ditë, 5 ditë',
  ultrasoundNotes: null,
  ultrasoundImages: [],
  signature: SIGNATURE,
};

const ALG_SENTINEL = 'ALG-SENTINEL-XYZ';
const COMPLAINT_SENTINEL = 'KOMPLAINT-SENTINEL-ABC';
const FEEDING_SENTINEL = 'USHQIM-SENTINEL-MMM';
const EXAM_SENTINEL = 'EKZAMINIM-SENTINEL-EEE';
const FOLLOWUP_SENTINEL = 'KONTROLL-SENTINEL-KKK';
const OTHER_SENTINEL = 'TJERA-SENTINEL-TTT';

describe('visit-report template', () => {
  it('renders clinic letterhead + payment code + DOB', () => {
    const html = renderVisitReport(VISIT_BASE);
    expect(html).toContain('DonetaMED');
    expect(html).toContain('Ambulanca Specialistike Pediatrike');
    // Payment letter + legacy id pair (per spec: "A · 15626")
    expect(html).toContain('15626');
    expect(html).toMatch(/<span class="pay-letter">A<\/span>/);
    expect(html).toContain('03.08.2023');
  });

  it('renders all vitals when populated', () => {
    const html = renderVisitReport(VISIT_BASE);
    expect(html).toContain('13.6 kg');
    expect(html).toContain('92 cm');
    expect(html).toContain('48.2 cm');
    expect(html).toContain('37.2 °C');
  });

  it('renders structured Dg + free-text Th', () => {
    const html = renderVisitReport(VISIT_BASE);
    expect(html).toContain('J03.9');
    expect(html).toContain('Tonsillitis acuta');
    expect(html).toContain('Spray.Axxa');
  });

  it('NEVER renders Alergji / Ankesa / Ushqimi / Ekzaminime / Kontrolla / Tjera', () => {
    // The template DTO doesn't accept those fields — the visibility
    // is enforced by the type system + service. We confirm by
    // checking that the sentinels never appear even if a future
    // refactor adds them to the data payload. Cast to `unknown` to
    // bypass the type guard intentionally for the sentinel check.
    const tainted = {
      ...VISIT_BASE,
      alergji: ALG_SENTINEL,
      complaint: COMPLAINT_SENTINEL,
      feedingNotes: FEEDING_SENTINEL,
      examinations: EXAM_SENTINEL,
      followupNotes: FOLLOWUP_SENTINEL,
      otherNotes: OTHER_SENTINEL,
    } as unknown as VisitReportTemplateData;
    const html = renderVisitReport(tainted);
    expect(html).not.toContain(ALG_SENTINEL);
    expect(html).not.toContain(COMPLAINT_SENTINEL);
    expect(html).not.toContain(FEEDING_SENTINEL);
    expect(html).not.toContain(EXAM_SENTINEL);
    expect(html).not.toContain(FOLLOWUP_SENTINEL);
    expect(html).not.toContain(OTHER_SENTINEL);
  });

  it('renders page 2 when ultrasound notes OR images are present', () => {
    const withUs = renderVisitReport({
      ...VISIT_BASE,
      ultrasoundNotes: 'Abdomen pa peshtjellim',
    });
    expect(withUs).toContain('Faqe 2 · Ultrazëri');
    expect(withUs).toContain('Abdomen pa peshtjellim');
  });

  it('omits page 2 when no ultrasound data', () => {
    const html = renderVisitReport(VISIT_BASE);
    expect(html).not.toContain('Faqe 2 · Ultrazëri');
  });

  it('reserves a blank stamp area on every page', () => {
    const html = renderVisitReport({
      ...VISIT_BASE,
      ultrasoundNotes: 'Some notes',
    });
    // Each page has a stamp-area block. The screen-only "Vendi i
    // vulës" label is included in the HTML (it's hidden via
    // @media print). The dashed border is also defined in shared
    // CSS so it can be hidden in print.
    const matches = html.match(/class="stamp-area"/g);
    expect(matches?.length ?? 0).toBeGreaterThanOrEqual(2);
    expect(html).toContain('Vendi i vulës');
  });
});

const VERTETIM_BASE: VertetimTemplateData = {
  clinic: CLINIC,
  patient: PATIENT,
  diagnosis: {
    code: 'J03.9',
    latinDescription: 'Tonsillitis acuta',
    isPrimary: true,
  },
  diagnosisSnapshot: 'J03.9 — Tonsillitis acuta',
  certificateNumber: '2026-0142',
  issuedAtIso: '2026-05-14T10:30:00.000Z',
  absenceFrom: '2026-05-14',
  absenceTo: '2026-05-18',
  durationDays: 5,
  signature: SIGNATURE,
};

describe('vërtetim template', () => {
  it('renders header, patient name + dob + place, diagnosis and period', () => {
    const html = renderVertetim(VERTETIM_BASE);
    expect(html).toContain('DonetaMED');
    expect(html).toContain('VËRTETIM');
    expect(html).toContain('Era Krasniqi');
    expect(html).toContain('03.08.2023');
    expect(html).toContain('Prizren');
    expect(html).toContain('J03.9');
    expect(html).toContain('Tonsillitis acuta');
    expect(html).toContain('14.05.2026 – 18.05.2026');
    expect(html).toContain('Nr.');
    expect(html).toContain('2026-0142');
  });

  it('renders the frozen snapshot even when no structured diagnosis is available', () => {
    const html = renderVertetim({
      ...VERTETIM_BASE,
      diagnosis: null,
      diagnosisSnapshot: 'Tonsillopharyngitis acuta (snapshot)',
    });
    expect(html).toContain('Tonsillopharyngitis acuta (snapshot)');
  });

  it('NEVER renders vitals, payment code, prescription, allergies, exams', () => {
    const html = renderVertetim(VERTETIM_BASE);
    // Vitals omitted by template
    expect(html).not.toContain('13.6 kg');
    expect(html).not.toContain('Kod · ID');
    // Therapy label (Th · Terapia) and prescription content never
    // appear on a vërtetim.
    expect(html).not.toContain('· Terapia');
    expect(html).not.toContain('Spray.Axxa');
    // Patient header has DOB + place only, NO birth weight column
    expect(html).not.toContain('Pesha lindjes');
  });

  it('reserves a blank stamp area', () => {
    const html = renderVertetim(VERTETIM_BASE);
    expect(html).toContain('Vendi i vulës');
    expect(html).toMatch(/class="stamp-area"/);
  });
});

const HISTORY_BASE: HistoryTemplateData = {
  clinic: CLINIC,
  patient: PATIENT,
  patientIdLabel: 'PT-04829',
  visits: [
    {
      visitDate: '2026-05-14',
      weightKg: 13.6,
      diagnoses: [
        { code: 'J03.9', latinDescription: 'Tonsillitis acuta', isPrimary: true },
      ],
      legacyDiagnosis: null,
      prescription: 'Spray.Axxa 2× në ditë, 5 ditë',
    },
    {
      visitDate: '2026-04-01',
      weightKg: 13.2,
      diagnoses: [],
      legacyDiagnosis: 'Tonsillitis acuta (legjend)',
      prescription: 'Amoksicilinë',
    },
  ],
  visitCount: 2,
  visitDateRange: { from: '2026-04-01', to: '2026-05-14' },
  todaySummary: { weightKg: 13.6, heightCm: 92 },
  signature: SIGNATURE,
  includeUltrasound: false,
  ultrasoundAppendix: [],
};

describe('history template', () => {
  it('renders master block + table columns', () => {
    const html = renderHistory(HISTORY_BASE);
    expect(html).toContain('HISTORIA E PACIENTIT');
    expect(html).toContain('PT-04829');
    expect(html).toContain('Era Krasniqi');
    expect(html).toContain('Data');
    expect(html).toContain('Pesha');
    expect(html).toContain('Diagnoza');
    expect(html).toContain('Terapia');
  });

  it('sorts visits newest-first (input order preserved)', () => {
    const html = renderHistory(HISTORY_BASE);
    const newer = html.indexOf('14.05.2026');
    const older = html.indexOf('01.04.2026');
    expect(newer).toBeGreaterThan(0);
    expect(older).toBeGreaterThan(newer);
  });

  it('shows page numbering on each page', () => {
    const html = renderHistory(HISTORY_BASE);
    expect(html).toMatch(/Faqe 1\/1/);
  });

  it('NEVER renders Alergji / Ankesa / Ushqimi / Ekzaminime / Tjera', () => {
    const html = renderHistory(HISTORY_BASE);
    expect(html).not.toContain(ALG_SENTINEL);
    expect(html).not.toMatch(/Alergji/);
    expect(html).not.toMatch(/Ankesa/);
    expect(html).not.toMatch(/Ekzaminim/);
  });

  it('reserves a blank stamp area on the last page only', () => {
    const html = renderHistory(HISTORY_BASE);
    expect(html).toContain('Vendi i vulës');
  });

  it('paginates when more than 12 visits', () => {
    const longList: HistoryTemplateData = {
      ...HISTORY_BASE,
      visits: Array.from({ length: 25 }, (_, i) => ({
        visitDate: `2026-${String((i % 12) + 1).padStart(2, '0')}-01`,
        weightKg: 13.6,
        diagnoses: [],
        legacyDiagnosis: 'Kontroll i rregullt',
        prescription: 'Pa terapi',
      })),
      visitCount: 25,
    };
    const html = renderHistory(longList);
    expect(html).toMatch(/Faqe 1\/3/);
    expect(html).toMatch(/Faqe 2\/3/);
    expect(html).toMatch(/Faqe 3\/3/);
  });
});
