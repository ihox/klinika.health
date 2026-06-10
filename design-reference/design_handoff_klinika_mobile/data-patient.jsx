// data-patient.jsx — Phase 2 fixtures: patient detail, visit history, the
// active visit form values, WHO growth series, and DICOM studies.

// ── Rich patient list (doctor/admin see clinical detail; reception name+DOB) ──
const PATIENTS_FULL = [
  { id: "PT-04829", name: "Era Krasniqi", sex: "f", dob: "03.08.2023", age: "2v 9m", visits: 5, lastDx: "J03.9 Tonsillitis acuta", lastSeen: "43 ditë", recent: false, today: true },
  { id: "PT-05140", name: "Rita Hoxha", sex: "f", dob: "12.02.2024", age: "2v 3m", visits: 14, lastDx: "J20.9 Bronchitis acuta", lastSeen: "7 ditë", recent: true },
  { id: "PT-04977", name: "Dion Hoxha", sex: "m", dob: "15.10.2024", age: "7m", visits: 3, lastDx: "Z00.1 Kontroll i rregullt", lastSeen: "30 ditë", recent: false },
  { id: "PT-05003", name: "Rinor Hoxha", sex: "m", dob: "07.11.2022", age: "3v 6m", visits: 9, lastDx: "H66.9 Otitis media", lastSeen: "12 ditë", recent: true },
  { id: "PT-05221", name: "Leon Berisha", sex: "m", dob: "20.01.2025", age: "1v 4m", visits: 4, lastDx: "Z00.1 Kontroll i rregullt", lastSeen: "21 ditë", recent: false },
  { id: "PT-05088", name: "Nora Gashi", sex: "f", dob: "11.09.2024", age: "1v 8m", visits: 2, lastDx: "J06.9 IRA", lastSeen: "60 ditë", recent: false },
  { id: "PT-04910", name: "Drini Kelmendi", sex: "m", dob: "04.06.2023", age: "2v 11m", visits: 8, lastDx: "L20.9 Dermatitis atopica", lastSeen: "9 ditë", recent: true },
  { id: "PT-05176", name: "Ema Hoxhaj", sex: "f", dob: "28.03.2024", age: "2v 2m", visits: 5, lastDx: "Z00.1 Kontroll i rregullt", lastSeen: "45 ditë", recent: false },
  { id: "PT-05290", name: "Endi Krasniqi", sex: "m", dob: "11.05.2026", age: "3 ditë", visits: 1, lastDx: "Vizita e parë", lastSeen: "i ri", recent: true, isNew: true },
  { id: "PT-04855", name: "Lori Gashi", sex: "f", dob: "02.01.2020", age: "6v 4m", visits: 11, lastDx: "J20.9 Bronchitis acuta", lastSeen: "3 ditë", recent: true },
];

// ── Selected patient (Era) master data ────────────────────────────────────
const PATIENT = {
  id: "PT-04829", name: "Era Krasniqi", sex: "f", sexLabel: "Femër",
  dob: "03.08.2023", age: "2v 9m", lastSeen: "43 ditë", visits: 5,
  address: "Prizren · rr. Rilindja Kombëtare", phone: "+383 44 123 456",
  birthWeight: "3 280", birthLength: "51", birthHC: "34", weightNow: "13.6",
  allergy: "Penicilinë · dhembet mjekun",
  guardian: "Vlora Krasniqi (nënë)", guardianPhone: "+383 44 123 456",
};

// ── Visit history (newest first) ──────────────────────────────────────────
const VISITS = [
  { id: "v5", date: "14.05.2026", dateShort: "14.05.26", dx: "J03.9 Tonsillitis acuta", dxShort: "Tonsillitis acuta", status: "in-progress", pay: "A", payAmt: "15 €", today: true },
  { id: "v4", date: "01.04.2026", dateShort: "01.04.26", dx: "J03.9 Tonsillitis acuta", dxShort: "Tonsillitis acuta", status: "completed", pay: "A", payAmt: "15 €" },
  { id: "v3", date: "22.02.2026", dateShort: "22.02.26", dx: "Z00.1 Kontroll i rregullt", dxShort: "Kontroll i rregullt", status: "completed", pay: "B", payAmt: "10 €", hasUS: true },
  { id: "v2", date: "17.12.2025", dateShort: "17.12.25", dx: "J20.9 Bronchitis acuta", dxShort: "Bronchitis acuta", status: "completed", pay: "A", payAmt: "15 €" },
  { id: "v1", date: "04.10.2025", dateShort: "04.10.25", dx: "Z00.1 Kontroll i rregullt", dxShort: "Kontroll i rregullt", status: "completed", pay: "B", payAmt: "10 €", hasUS: true },
];

// Active visit (v5) form values — mirrors the desktop visit form.
const VISIT_FORM = {
  ankesa: "Kollë e thatë prej 3 ditësh. Temperaturë subfebrile mbrëmjeve. Ushqim i ruajtur, gjumë i shqetësuar. Pa diarre, pa të vjella.",
  food: { gji: false, formule: true, solid: true },
  vitals: [
    { label: "Pesha", value: "13.6", unit: "kg", pct: "P50 · ↑ 0.4 nga 1 muaj", warn: false },
    { label: "Gjatësia", value: "92", unit: "cm", pct: "P50", warn: false },
    { label: "Perimetri kokës", value: "48.2", unit: "cm", pct: "P50", warn: false },
    { label: "Temperatura", value: "37.2", unit: "°C", pct: "Subfebrile", warn: true },
  ],
  ekzaminime: "Gjendje e përgjithshme e mirë, e gjallë. Tonsila mesatarisht të hipertrofuara, hiperemike. Auskultatorisht: respirim vezikular, pa rale. Cor: tone të rregullta, pa zhurmë. Abdomen palpator pa veçanti.",
  ultrazeri: "",
  dx: [{ code: "J03.9", label: "Tonsillitis acuta", primary: true }, { code: "R05", label: "Tussis" }],
  terapia: "Spray.Axxa 2× në ditë, 5 ditë\nIbuprofen susp. 100mg/5ml — 5ml × 3, p.r.n.\nPi shumë lëngje. Pushim.\n>rez. nëse vazhdon mbi 5 ditë",
  analizat: "",
  kontrolla: "Kontroll pas 7 ditësh nëse kollë vazhdon. Kërkohet rikthim me ankesa.",
  tjera: "Prindi raporton se në klasë janë 4 fëmijë me kollë. Të vërehet evolucioni.",
  payment: "A",
};

const PAYMENT_CODES = [
  { code: "A", label: "Vizitë standarde", amt: "15 €" },
  { code: "B", label: "Kontroll / pasvizitë", amt: "10 €" },
  { code: "C", label: "Vizitë e parë / e gjatë", amt: "20 €" },
  { code: "D", label: "Vetëm ultrazë", amt: "20 €" },
  { code: "E", label: "Pa pagesë / familjar", amt: "0 €" },
];

const ICD_SUGGEST = [
  { code: "J20.9", desc: "Bronchitis acuta" },
  { code: "J21.0", desc: "Bronchiolitis acuta" },
  { code: "J45.9", desc: "Asthma bronchiale" },
  { code: "J06.9", desc: "Infeksion akut i rrugëve të sipërme" },
];

// ── WHO growth reference (approx percentiles) ─────────────────────────────
const WHO_AGES = [0, 3, 6, 9, 12, 18, 24, 30, 36];
const WHO = {
  weight: {
    title: "Pesha sipas moshës", unit: "kg", yMin: 2, yMax: 19, yStep: 2,
    p3:  [2.4, 4.5, 5.7, 6.5, 7.0, 8.1, 9.0, 9.9, 10.8],
    p15: [2.8, 5.1, 6.5, 7.3, 7.9, 9.1, 10.2, 11.2, 12.3],
    p50: [3.2, 5.8, 7.3, 8.2, 8.9, 10.2, 11.5, 12.7, 13.9],
    p85: [3.7, 6.6, 8.3, 9.3, 10.1, 11.6, 13.0, 14.4, 15.8],
    p97: [4.2, 7.5, 9.3, 10.5, 11.5, 13.2, 14.8, 16.4, 18.1],
    pts: [[0,3.28],[3,5.8],[6,7.4],[12,9.6],[18,11.0],[24,12.2],[33,13.6]],
    cur: "P50",
  },
  length: {
    title: "Gjatësia sipas moshës", unit: "cm", yMin: 44, yMax: 104, yStep: 10,
    p3:  [45.6, 55.6, 61.2, 65.3, 68.9, 74.9, 80.0, 85.0, 88.4],
    p15: [47.2, 57.6, 63.3, 67.6, 71.3, 77.7, 83.0, 88.0, 91.5],
    p50: [49.1, 59.8, 65.7, 70.1, 74.0, 80.7, 86.4, 91.7, 95.1],
    p85: [51.0, 62.0, 68.1, 72.6, 76.7, 83.7, 89.8, 95.0, 98.5],
    p97: [52.7, 64.0, 70.3, 74.8, 79.2, 86.5, 92.9, 98.4, 101.8],
    pts: [[0,51],[3,61],[6,67],[12,76],[18,82],[24,88],[33,92]],
    cur: "P50",
  },
  hc: {
    title: "Perimetri kokës", unit: "cm", yMin: 31, yMax: 53, yStep: 2,
    p3:  [31.7, 38.3, 40.2, 42.5, 43.5, 45.0, 46.1, 46.9, 47.3],
    p15: [32.7, 39.3, 41.1, 43.4, 44.6, 46.1, 47.2, 48.0, 48.5],
    p50: [33.9, 40.5, 42.2, 44.5, 45.8, 47.4, 48.5, 49.3, 49.8],
    p85: [35.1, 41.7, 43.3, 45.6, 47.0, 48.6, 49.8, 50.6, 51.1],
    p97: [36.1, 42.7, 44.2, 46.5, 48.0, 49.7, 50.9, 51.7, 52.3],
    pts: [[0,34],[3,40],[6,43],[12,46],[18,47.5],[24,48],[33,48.2]],
    cur: "P50",
  },
};

// ── DICOM studies (ultrasound) ────────────────────────────────────────────
const DICOM_STUDIES = [
  { id: "s4", date: "14.05.2026", when: "Sot", label: "Ekografi abdominale", modality: "US", images: 3, linked: false, group: "today" },
  { id: "s3", date: "22.02.2026", when: "22 shkurt", label: "Ekografi abdominale", modality: "US", images: 4, linked: true, visit: "22.02.2026", group: "older" },
  { id: "s2", date: "04.10.2025", when: "4 tetor 2025", label: "Ekografi renale", modality: "US", images: 2, linked: true, visit: "04.10.2025", group: "older" },
  { id: "s1", date: "17.12.2024", when: "17 dhjetor 2024", label: "Ekografi e qafës", modality: "US", images: 2, linked: true, visit: "17.12.2024", group: "older" },
];

Object.assign(window, {
  PATIENTS_FULL, PATIENT, VISITS, VISIT_FORM, PAYMENT_CODES, ICD_SUGGEST,
  WHO_AGES, WHO, DICOM_STUDIES,
});
