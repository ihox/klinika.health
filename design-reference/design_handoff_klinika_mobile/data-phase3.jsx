// data-phase3.jsx — Phase 3 fixtures: Raporti visits, clinic users, settings,
// working hours, payment codes, error copy.

// ── Raporti — today's visits (mirror of desktop raporti-app.jsx totals) ───
// 18 completed + 3 no_show + 2 scheduled = 23 visits → 235 € revenue.
const REPORT_VISITS = [
  { t: "08:30", name: "Era Krasniqi", age: "8v", status: "completed", code: "A", price: 15 },
  { t: "09:00", name: "Jon Tamniku", age: "10v", status: "completed", code: "B", price: 10 },
  { t: "09:20", name: "Dion Hoxha", age: "1v 7m", status: "completed", code: "A", price: 15 },
  { t: "09:45", name: "Aria Kelmendi", age: "3v 4m", status: "completed", code: "B", price: 10 },
  { t: "10:00", name: "Liam Berisha", age: "7m", status: "completed", code: "A", price: 15 },
  { t: "10:20", name: "Ema Krasniqi", age: "4v 3m", status: "completed", code: "A", price: 15 },
  { t: "10:40", name: "Lena Hoti", age: "6v 11m", status: "completed", code: "A", price: 15 },
  { t: "11:00", name: "Drini Hoxha", age: "4v 1m", status: "completed", code: "A", price: 15 },
  { t: "11:20", name: "Ben Krasniqi", age: "3v 6m", status: "no_show", code: null, price: null },
  { t: "11:40", name: "Mira Hoxhaj", age: "2v", status: "completed", code: "A", price: 15 },
  { t: "12:00", name: "Endi Krasniqi", age: "12 ditë", status: "completed", code: "D", price: 20, note: "Vizita e parë" },
  { t: "12:30", name: "Dorian Hoxha", age: "5v 1m", status: "completed", code: "A", price: 15 },
  { t: "13:00", name: "Lori Gashi", age: "6v 6m", status: "completed", code: "B", price: 10 },
  { t: "13:30", name: "Sara Berisha", age: "2v", status: "completed", code: "A", price: 15 },
  { t: "13:50", name: "Era Berisha", age: "5v 3m", status: "completed", code: "A", price: 15 },
  { t: "14:10", name: "Ron Krasniqi", age: "2v 10m", status: "no_show", code: null, price: null },
  { t: "14:30", name: "Diana Hoti", age: "2v 2m", status: "completed", code: "E", price: 0, note: "Pasvizitë · Falas" },
  { t: "14:55", name: "Klea Hoxha", age: "7v 8m", status: "completed", code: "A", price: 15 },
  { t: "15:20", name: "Nora Berisha", age: "3v 9m", status: "completed", code: "B", price: 10 },
  { t: "15:45", name: "Andi Hoxha", age: "6v 1m", status: "completed", code: "B", price: 10 },
  { t: "16:15", name: "Ardita Gashi", age: "11m", status: "no_show", code: null, price: null },
  { t: "16:45", name: "Genti Kelmendi", age: "2v 9m", status: "scheduled", code: null, price: null },
  { t: "17:30", name: "Vesa Krasniqi", age: "1v 4m", status: "scheduled", code: null, price: null },
];

const RP_STATUS = {
  completed: { label: "Të përfunduara", singular: "Përfunduar", cls: "chip-green", solid: "var(--status-completed-solid)" },
  no_show:   { label: "Mungesa", singular: "Mungesë", cls: "chip-amber", solid: "var(--status-no-show-solid)" },
  scheduled: { label: "Të planifikuara", singular: "I planifikuar", cls: "chip-indigo", solid: "var(--status-scheduled-solid)" },
};

function computeReport(visits) {
  const byStatus = {}; let revenue = 0; const codeMap = {};
  for (const v of visits) {
    byStatus[v.status] = (byStatus[v.status] || 0) + 1;
    if (v.price) revenue += v.price;
    if (v.code) codeMap[v.code] = (codeMap[v.code] || 0) + 1;
  }
  const PRICE = { A: 15, B: 10, C: 20, D: 20, E: 0 };
  const codeBreakdown = Object.keys(codeMap).sort().map(code => ({ code, n: codeMap[code], price: PRICE[code] }));
  return { count: visits.length, revenue, byStatus, codeBreakdown };
}

// ── Clinic users ──────────────────────────────────────────────────────────
const USERS = [
  { name: "Dr. Taulant Shala", email: "taulant@donetamed.com", initials: "TS", roles: ["doctor", "admin"], active: true, last: "Tani", you: true },
  { name: "Liridona Berisha", email: "liridona@donetamed.com", initials: "LB", roles: ["reception"], active: true, last: "30 min më parë" },
  { name: "Arben Krasniqi", email: "arben@donetamed.com", initials: "AK", roles: ["admin"], active: true, last: "2 orë më parë" },
  { name: "Dr. Vesa Hoxha", email: "vesa@donetamed.com", initials: "VH", roles: ["doctor"], active: true, last: "1 ditë më parë" },
  { name: "Albulena Gashi", email: "albulena@donetamed.com", initials: "AG", roles: ["reception"], active: false, last: "3 javë më parë" },
];

const ROLE_META = {
  doctor:    { label: "Mjeku", cls: "doctor" },
  reception: { label: "Recepsioniste", cls: "reception" },
  admin:     { label: "Administrator", cls: "admin" },
};

// ── Working hours ───────────────────────────────────────────────────────
const HOURS = [
  { day: "E hënë", iso: "mon", open: true, from: "10:00", to: "18:00" },
  { day: "E martë", iso: "tue", open: true, from: "10:00", to: "18:00" },
  { day: "E mërkurë", iso: "wed", open: true, from: "10:00", to: "18:00" },
  { day: "E enjte", iso: "thu", open: true, from: "10:00", to: "18:00" },
  { day: "E premte", iso: "fri", open: true, from: "10:00", to: "18:00" },
  { day: "E shtunë", iso: "sat", open: true, from: "10:00", to: "14:00" },
  { day: "E diel", iso: "sun", open: false, from: "—", to: "—" },
];

const PAY_CODES_FULL = [
  { code: "A", label: "Vizitë standarde", price: 15, color: "var(--teal-700)" },
  { code: "B", label: "Kontroll / pasvizitë", price: 10, color: "var(--teal-600)" },
  { code: "C", label: "Recetë / vizitë e shkurtër", price: 5, color: "var(--teal-500)" },
  { code: "D", label: "Vizitë me ultrazë", price: 20, color: "var(--accent-500)" },
  { code: "E", label: "Pa pagesë / familjar", price: 0, color: "var(--text-muted)" },
];

// Settings tabs (clinic admin). Përdoruesit handled as its own sub-view.
const SETTINGS_TABS = [
  { id: "general", label: "Përgjithshme" },
  { id: "hours", label: "Orari dhe terminet" },
  { id: "users", label: "Përdoruesit", count: USERS.length },
  { id: "payments", label: "Pagesa" },
  { id: "email", label: "Email" },
  { id: "audit", label: "Auditimi" },
];

// ── DICOM recent visits for link sheet (last 30 days) ─────────────────────
const LINK_VISITS = [
  { id: "v5", date: "14.05.2026", time: "14:20", status: "in-progress", pay: "A", today: true },
  { id: "v4", date: "01.04.2026", time: "11:10", status: "completed", pay: "A" },
  { id: "v3", date: "22.02.2026", time: "10:30", status: "completed", pay: "B" },
];

// ── Error / edge-case copy ────────────────────────────────────────────────
const ERRORS = {
  404: { code: "404", icon: "M7 7m-5 0a5 5 0 1 0 10 0a5 5 0 1 0 -10 0 M11 11l4 4", title: "Faqja nuk u gjet", desc: "Faqja që kërkoni nuk ekziston ose është zhvendosur.", primary: "Kthehu te ballina", secondary: null },
  403: { code: "403", icon: "M5 9V6.5a3 3 0 0 1 6 0 M3.5 9h9v6.5h-9z M8 12v1.5", title: "Qasje e ndaluar", desc: "Nuk keni leje për të parë këtë faqe. Kontaktoni administratorin e klinikës nëse mendoni se është gabim.", primary: "Kthehu te ballina", secondary: null },
  500: { code: "500", icon: "M10 2l8 14H2z M10 8v4 M10 14h.01", title: "Diçka shkoi keq", desc: "Ndodhi një gabim në server. Provoni përsëri pas pak çastesh.", primary: "Provo përsëri", secondary: "Kthehu te ballina" },
  offline: { code: "", icon: "M2 5l16 14 M5.5 8.2A11 11 0 0 1 10 7c2.2 0 4.3.6 6 1.7 M3 5.5a16 16 0 0 1 3-1.8 M10 16h.01", title: "Pa lidhje interneti", desc: "Klinika ka nevojë për lidhje me internet. Kontrolloni WiFi-n e klinikës dhe provoni përsëri.", primary: "Provo përsëri", secondary: null },
};

Object.assign(window, {
  REPORT_VISITS, RP_STATUS, computeReport,
  USERS, ROLE_META, HOURS, PAY_CODES_FULL, SETTINGS_TABS,
  LINK_VISITS, ERRORS,
});
