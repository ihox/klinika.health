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
  formalName: 'Ordinanca Specialistike Pediatrike',
  shortName: 'DONETA-MED',
  address: 'Rr. Adem Jashari',
  city: 'Prizren',
  phones: ['045 83 00 83', '043 543 123'],
  hoursLine: '10:00 – 18:00',
  licenseNumber: 'Lic. MSH-Nr. 1487-AM/24',
};

const PATIENT = {
  fullName: 'Era Krasniqi',
  ageLine: 'vajzë · 2 vjeç 9 muaj',
  dateOfBirth: '2023-08-03',
  placeOfBirth: 'Prizren',
  paymentCode: 'A',
  legacyId: 15626,
  patientIdShort: '15626',
  birthWeightG: 3280,
  birthLengthCm: 51,
  birthHeadCircumferenceCm: 34,
};

const SIGNATURE = {
  fullName: 'Dr. Taulant Shala',
  credential: 'pediatër · DONETA-MED',
  signatureDataUri: null,
  issuedAtDateTime: '14.05.2026 · 14:32',
  issuedPlace: 'Prizren',
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
  analyses: null,
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
    expect(html).toContain('DONETA-MED');
    expect(html).toContain('Ordinanca Specialistike Pediatrike');
    expect(html).toContain('Lic. MSH-Nr. 1487-AM/24');
    expect(html).toContain('03.08.2023');
  });

  it('pt-id row shows "paymentCode · patientId" with plain mono styling (no sigil)', () => {
    const html = renderVisitReport(VISIT_BASE);
    // "A · 15626" — dot separator, no teal sigil wrapper, both
    // elements share the same muted-mono styling on .pt-id.
    expect(html).toMatch(/<div class="pt-id">A · 15626<\/div>/);
    expect(html).not.toMatch(/<span class="id-sigil">A<\/span>/);
  });

  it('pt-id falls back to a UUID slug when legacyId is null', () => {
    const newPatient = renderVisitReport({
      ...VISIT_BASE,
      patient: {
        ...VISIT_BASE.patient,
        legacyId: null,
        patientIdShort: 'A1B2C3D4',
      },
    });
    expect(newPatient).toMatch(/<div class="pt-id">A · A1B2C3D4<\/div>/);
  });

  it('renders today + birth measurements in the right header', () => {
    const html = renderVisitReport(VISIT_BASE);
    // Birth row — PL/GjL/PKL labels carry the values with the units
    // emitted as adjacent spans (so a contiguous "3.280kg" string
    // doesn't necessarily appear). Assert label + value separately.
    expect(html).toContain('PL');
    expect(html).toContain('3.280');
    expect(html).toContain('GjL');
    expect(html).toContain('51');
    expect(html).toContain('PKL');
    expect(html).toContain('34');
    // Today row — Pt/GjT/PKT from visit.vitals
    expect(html).toContain('Pt');
    expect(html).toContain('13.6');
    expect(html).toContain('GjT');
    expect(html).toContain('92');
    expect(html).toContain('PKT');
    expect(html).toContain('48.2');
  });

  it('renders structured Dg + free-text Th', () => {
    const html = renderVisitReport(VISIT_BASE);
    expect(html).toContain('J03.9');
    expect(html).toContain('Tonsillitis acuta');
    expect(html).toContain('Spray.Axxa');
  });

  it('renders only Dg + Th labels (NO "· Diagnoza" / "· Terapia" suffixes)', () => {
    const html = renderVisitReport(VISIT_BASE);
    expect(html).toContain('>Dg<');
    expect(html).toContain('>Th<');
    expect(html).not.toContain('· Diagnoza');
    expect(html).not.toContain('· Terapia');
    expect(html).not.toContain('· DIAGNOZA');
    expect(html).not.toContain('· TERAPIA');
  });

  it('renders the An (analyses) box below Th when analyses content exists', () => {
    const html = renderVisitReport({
      ...VISIT_BASE,
      analyses: 'Hb 12.4 g/dl · CRP <5 mg/L',
    });
    expect(html).toContain('>An<');
    expect(html).toContain('Hb 12.4 g/dl');
    // An sits below Th in the body order.
    const thAt = html.indexOf('>Th<');
    const anAt = html.indexOf('>An<');
    expect(thAt).toBeGreaterThan(0);
    expect(anAt).toBeGreaterThan(thAt);
    // No "· ANALIZAT" suffix — label minimalism.
    expect(html).not.toContain('· ANALIZAT');
    expect(html).not.toContain('· Analizat');
  });

  it('omits the An box entirely when analyses is null or blank', () => {
    expect(renderVisitReport(VISIT_BASE)).not.toContain('>An<');
    expect(
      renderVisitReport({ ...VISIT_BASE, analyses: '   ' }),
    ).not.toContain('>An<');
  });

  it('renders the issue block (date+time, place) on the footer left', () => {
    const html = renderVisitReport(VISIT_BASE);
    expect(html).toContain('14.05.2026');
    expect(html).toContain('14:32');
    expect(html).toContain('Prizren');
    expect(html).toMatch(/class="issue-block"/);
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
    // Compact letterhead + UL section appear on page 2.
    expect(withUs).toMatch(/class="lh compact"/);
    expect(withUs).toContain('>UL<');
    expect(withUs).toContain('Abdomen pa peshtjellim');
    // Two <article class="paper"> blocks = two pages.
    const articles = withUs.match(/<article class="paper">/g);
    expect(articles?.length ?? 0).toBe(2);
  });

  it('omits page 2 when no ultrasound data', () => {
    const html = renderVisitReport(VISIT_BASE);
    expect(html).not.toMatch(/class="lh compact"/);
    const articles = html.match(/<article class="paper">/g);
    expect(articles?.length ?? 0).toBe(1);
  });

  it('does NOT render a digital stamp slot anywhere', () => {
    const html = renderVisitReport({
      ...VISIT_BASE,
      ultrasoundNotes: 'Some notes',
    });
    // The Kosovo physical ink stamp is placed by hand; the template
    // reserves no placeholder rectangle and emits no "Vendi i vulës"
    // label. Cf. CLAUDE.md §1.1 (no digital stamps).
    expect(html).not.toContain('Vendi i vulës');
    expect(html).not.toMatch(/class="stamp-area"/);
  });
});

const VERTETIM_BASE: VertetimTemplateData = {
  clinic: CLINIC,
  patient: PATIENT,
  patientSex: 'f',
  patientIdLabel: 'PT-15626',
  diagnosis: {
    code: 'J03.9',
    latinDescription: 'Tonsillitis acuta',
    isPrimary: true,
  },
  diagnosisSnapshot: 'J03.9 — Tonsillitis acuta',
  certificateNumber: 'VM-2026-0142',
  issuedAtIso: '2026-05-14T10:30:00.000Z',
  absenceFrom: '2026-05-14',
  absenceTo: '2026-05-18',
  durationDays: 5,
  signature: SIGNATURE,
};

describe('vërtetim template', () => {
  it('renders letterhead with VM- serial tag in the top-right', () => {
    const html = renderVertetim(VERTETIM_BASE);
    expect(html).toContain('DONETA-MED');
    expect(html).toContain('Ordinanca Specialistike Pediatrike');
    expect(html).toContain('Lic. MSH-Nr. 1487-AM/24');
    // Serial tag — kicker label + VM-YYYY-NNNN number
    expect(html).toContain('Nr. vërtetimi');
    expect(html).toContain('VM-2026-0142');
    expect(html).toMatch(/class="cert-serial-tag"/);
  });

  it('places the VËRTETIM hero title near the top (after letterhead)', () => {
    const html = renderVertetim(VERTETIM_BASE);
    expect(html).toContain('VËRTETIM');
    const lhEnd = html.indexOf('</header>');
    const titleAt = html.indexOf('VËRTETIM</h1>');
    const footerAt = html.indexOf('<footer');
    expect(lhEnd).toBeGreaterThan(0);
    expect(titleAt).toBeGreaterThan(lhEnd);
    expect(titleAt).toBeLessThan(footerAt);
  });

  it('renders the subject identification block (name, DOB·place, sex·age, ID)', () => {
    const html = renderVertetim(VERTETIM_BASE);
    expect(html).toMatch(/class="subject-block"/);
    expect(html).toContain('Era Krasniqi');
    expect(html).toContain('Datëlindja · Vendi');
    expect(html).toContain('03.08.2023');
    expect(html).toContain('Prizren');
    expect(html).toContain('Gjinia · Mosha');
    expect(html).toContain('Vajzë');
    expect(html).toContain('ID në klinikë');
    expect(html).toContain('PT-15626');
  });

  it('attestation prose uses "në shkollë" only (NOT "kopsht")', () => {
    const html = renderVertetim(VERTETIM_BASE);
    expect(html).toContain('ka munguar në shkollë');
    expect(html).not.toMatch(/kopsht/i);
    expect(html).not.toContain('shkollë / kopsht');
  });

  it('diagnosis card shows latinized name only — NO ICD code, NO "· ICD-10"', () => {
    const html = renderVertetim(VERTETIM_BASE);
    expect(html).toMatch(/class="cert-dx-card"/);
    expect(html).toContain('Tonsillitis acuta');
    // ICD code is intentionally omitted from the printed cert.
    expect(html).not.toMatch(/<span class="code">J03\.9<\/span>/);
    expect(html).not.toContain('· ICD-10');
  });

  it('falls back to the snapshot (with ICD stripped) when no structured diagnosis', () => {
    const html = renderVertetim({
      ...VERTETIM_BASE,
      diagnosis: null,
      diagnosisSnapshot: 'J03.9 — Tonsillopharyngitis acuta',
    });
    expect(html).toContain('Tonsillopharyngitis acuta');
    expect(html).not.toContain('J03.9 — Tonsillopharyngitis acuta');
  });

  it('renders the period card with date range + big day count + policy note', () => {
    const html = renderVertetim(VERTETIM_BASE);
    expect(html).toMatch(/class="cert-period-card"/);
    expect(html).toContain('Periudha e arsyetuar');
    expect(html).toContain('14.05.2026 – 18.05.2026');
    // Day count rendered large in the right column + "ditë" unit.
    expect(html).toMatch(/<div class="period-days">5<\/div>/);
    expect(html).toMatch(/<div class="period-unit">ditë<\/div>/);
    expect(html).toContain('Kthim në aktivitete normale');
  });

  it('NEVER renders vitals, payment code, prescription, allergies, exams', () => {
    const html = renderVertetim(VERTETIM_BASE);
    // Vitals omitted by template
    expect(html).not.toContain('13.6 kg');
    expect(html).not.toContain('Kod · ID');
    // Therapy and prescription content never appear on a vërtetim.
    expect(html).not.toContain('Spray.Axxa');
    // Patient header has DOB + place + sex + age + ID only, NO birth
    // weight column.
    expect(html).not.toContain('Pesha lindjes');
  });

  it('does NOT render a digital stamp slot', () => {
    const html = renderVertetim(VERTETIM_BASE);
    // No placeholder rectangle, no "Vendi i vulës" label — Kosovo ink
    // stamp is placed by hand. CLAUDE.md §1.1.
    expect(html).not.toContain('Vendi i vulës');
    expect(html).not.toMatch(/class="stamp-area"/);
  });
});

const HISTORY_BASE: HistoryTemplateData = {
  clinic: CLINIC,
  patient: PATIENT,
  patientSex: 'f',
  patientIdLabel: 'PT-04829',
  visits: [
    {
      visitDate: '2026-05-14',
      visitTime: '14:20',
      weightKg: 13.6,
      heightCm: 92,
      headCircumferenceCm: 48.2,
      temperatureC: 37.2,
      diagnoses: [
        { code: 'J03.9', latinDescription: 'Tonsillitis acuta', isPrimary: true },
      ],
      legacyDiagnosis: null,
      prescription: 'Spray.Axxa 2× në ditë, 5 ditë',
    },
    {
      visitDate: '2026-04-01',
      visitTime: '11:05',
      weightKg: 13.2,
      heightCm: 91,
      headCircumferenceCm: 48.0,
      temperatureC: 38.1,
      diagnoses: [],
      legacyDiagnosis: 'Tonsillitis acuta (legjend)',
      prescription: 'Amoksicilinë',
    },
  ],
  visitCount: 2,
  visitDateRange: { from: '2026-04-01', to: '2026-05-14' },
  todaySummary: { weightKg: 13.6, heightCm: 92, headCircumferenceCm: 48.2 },
  growthSeries: {
    weight: [
      { visitDate: '2026-04-01', value: 13.2 },
      { visitDate: '2026-05-14', value: 13.6 },
    ],
    height: [
      { visitDate: '2026-04-01', value: 91 },
      { visitDate: '2026-05-14', value: 92 },
    ],
    headCircumference: [
      { visitDate: '2026-04-01', value: 48.0 },
      { visitDate: '2026-05-14', value: 48.2 },
    ],
  },
  signature: SIGNATURE,
  includeUltrasound: false,
  ultrasoundAppendix: [],
};

describe('history template', () => {
  it('renders the unified letterhead + context strip + table columns', () => {
    const html = renderHistory(HISTORY_BASE);
    // Context strip uses lowercase "Historia e pacientit", NOT the
    // old all-caps "HISTORIA E PACIENTIT" hero title.
    expect(html).toContain('Historia e pacientit');
    expect(html).not.toContain('HISTORIA E PACIENTIT');
    expect(html).toContain('Era Krasniqi');
    expect(html).toContain('DONETA-MED');
    // Table headers
    expect(html).toContain('Data / matjet');
    expect(html).toContain('Diagnoza');
    expect(html).toContain('Terapia / Analizat');
  });

  it('renders date + time + vitals (P/GJ/PK/T) for each visit', () => {
    const html = renderHistory(HISTORY_BASE);
    expect(html).toContain('14.05.2026');
    expect(html).toContain('14:20');
    // Vitals tokens emit as separate spans (.lbl + .num + .u) so a
    // continguous "13.6 kg" doesn't appear — assert pieces.
    expect(html).toContain('>P<');
    expect(html).toContain('13.6');
    expect(html).toContain('>GJ<');
    expect(html).toContain('92');
    expect(html).toContain('>PK<');
    expect(html).toContain('48.2');
    expect(html).toContain('>T<');
    expect(html).toContain('37.2');
  });

  it('renders three growth chart cards on the chart page', () => {
    const html = renderHistory(HISTORY_BASE);
    expect(html).toContain('Pesha · P50');
    expect(html).toContain('Gjatësia · P50');
    expect(html).toContain('Perimetri kraniometrik · P50');
    expect(html).toContain('Diagrami i rritjes · WHO');
  });

  it('tints the clinical line per patient sex (female = E8728E)', () => {
    const html = renderHistory(HISTORY_BASE);
    // Sex is "f" in the fixture, so the line / dots use the female
    // canonical chart token.
    expect(html).toContain('#E8728E');
    expect(html).not.toContain('#4A90D9');
  });

  it('tints male as #4A90D9 and unknown sex as teal #0F766E', () => {
    const male = renderHistory({ ...HISTORY_BASE, patientSex: 'm' });
    expect(male).toContain('#4A90D9');
    const unknown = renderHistory({ ...HISTORY_BASE, patientSex: null });
    expect(unknown).toContain('#0F766E');
  });

  it('sorts visits newest-first within the table body', () => {
    const html = renderHistory(HISTORY_BASE);
    // The context strip carries the chronological range string
    // ("01.04.2026 – 14.05.2026"), so the order check must scope to
    // the table body — that's where the newest-first invariant lives.
    const tableStart = html.indexOf('<tbody>');
    expect(tableStart).toBeGreaterThan(0);
    const body = html.slice(tableStart);
    const newer = body.indexOf('14.05.2026');
    const older = body.indexOf('01.04.2026');
    expect(newer).toBeGreaterThan(0);
    expect(older).toBeGreaterThan(newer);
  });

  it('shows page numbering (visits + always-present chart page)', () => {
    const html = renderHistory(HISTORY_BASE);
    // 2 fixture visits ≤ ROWS_PER_PAGE → 1 visit-table page + 1 chart
    // page = 2 pages total. Both kickers appear.
    expect(html).toMatch(/Faqe 1 \/ 2/);
    expect(html).toMatch(/Faqe 2 \/ 2/);
  });

  it('NEVER renders Alergji / Ankesa / Ushqimi / Ekzaminime / Tjera', () => {
    const html = renderHistory(HISTORY_BASE);
    expect(html).not.toContain(ALG_SENTINEL);
    expect(html).not.toMatch(/Alergji/);
    expect(html).not.toMatch(/Ankesa/);
    expect(html).not.toMatch(/Ekzaminim/);
  });

  it('does NOT render a digital stamp slot', () => {
    const html = renderHistory(HISTORY_BASE);
    expect(html).not.toContain('Vendi i vulës');
    expect(html).not.toMatch(/class="stamp-area"/);
  });

  it('paginates the visits table + appends one chart page at the end', () => {
    const longList: HistoryTemplateData = {
      ...HISTORY_BASE,
      visits: Array.from({ length: 20 }, (_, i) => ({
        visitDate: `2026-${String((i % 12) + 1).padStart(2, '0')}-01`,
        visitTime: '10:00',
        weightKg: 13.6,
        heightCm: 92,
        headCircumferenceCm: 48.2,
        temperatureC: 37.0,
        diagnoses: [],
        legacyDiagnosis: 'Kontroll i rregullt',
        prescription: 'Pa terapi',
      })),
      visitCount: 20,
    };
    const html = renderHistory(longList);
    // 20 visits / 8 per page = 3 visit-table pages + 1 chart page.
    expect(html).toMatch(/Faqe 1 \/ 4/);
    expect(html).toMatch(/Faqe 2 \/ 4/);
    expect(html).toMatch(/Faqe 3 \/ 4/);
    expect(html).toMatch(/Faqe 4 \/ 4/);
  });
});
