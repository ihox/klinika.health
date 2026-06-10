// data.jsx — shared sample data + icon set for the Klinika mobile prototype.
// Exported to window so every screen file can read the same fixtures.

// ── Icons ────────────────────────────────────────────────────────────────
// Minimal stroke icons matching the desktop app's 1.5–1.6 weight style.
const I = {
  search: "M7 7m-5 0a5 5 0 1 0 10 0a5 5 0 1 0 -10 0 M11 11l3 3",
  home: "M3 9.5L10 3l7 6.5 M5 8.5V16h10V8.5",
  patients: "M7 8.5a2.6 2.6 0 1 0 0-5.2 2.6 2.6 0 0 0 0 5.2 M2 16c0-2.8 2.2-4.3 5-4.3s5 1.5 5 4.3 M13 5.2a2.2 2.2 0 0 1 0 4.4 M18 16c0-2-1-3.3-3-3.9",
  report: "M4 3h9l3 3v11H4z M13 3v3h3 M7 10h6 M7 13h6 M7 7h3",
  calendar: "M3 5h14v12H3z M3 8h14 M6.5 3v3 M13.5 3v3 M7 11l1.5 1.5L11 10",
  more: "M5 10h.01 M10 10h.01 M15 10h.01",
  settings: "M10 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5 M10 2.5v2 M10 15.5v2 M4.4 4.4l1.4 1.4 M14.2 14.2l1.4 1.4 M2.5 10h2 M15.5 10h2 M4.4 15.6l1.4-1.4 M14.2 5.8l1.4-1.4",
  profile: "M10 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6 M3.5 17c0-3.4 2.9-5.2 6.5-5.2s6.5 1.8 6.5 5.2",
  logout: "M12 5V3.5a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v13a1 1 0 0 0 1 1h7a1 1 0 0 0 1-1V15 M8 10h9 M14 7l3 3-3 3",
  help: "M10 17a7 7 0 1 0 0-14 7 7 0 0 0 0 14 M8 8a2 2 0 1 1 2.6 1.9c-.6.2-.9.6-.9 1.3v.3 M10 14h.01",
  bell: "M10 3a4 4 0 0 0-4 4c0 4-1.5 5-1.5 5h11s-1.5-1-1.5-5a4 4 0 0 0-4-4 M8.5 16a1.7 1.7 0 0 0 3 0",
  chevright: "M7.5 4l5 5-5 5",
  chevleft: "M12.5 4l-5 5 5 5",
  chevdown: "M4 7l5 5 5-5",
  close: "M5 5l9 9 M14 5l-9 9",
  walkin: "M3 8a5 5 0 0 1 8.5-3.5L13 6 M13 2.5V6h-3.5",
  growth: "M3 16L8 9l3 3 5-7 M3 17h14",
  plus: "M10 4v12 M4 10h12",
  back: "M11 4l-5 6 5 6",
  filter: "M3 5h14 M5.5 10h9 M8 15h4",
  refresh: "M15.5 8a5.5 5.5 0 1 0 .3 3 M15.5 4v4h-4",
};

function Icon({ d, size = 20, sw = 1.6, fill = "none", style }) {
  const paths = (I[d] || d).split(" M").map((p, i) => (i === 0 ? p : "M" + p));
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill={fill}
         stroke="currentColor" strokeWidth={sw} strokeLinecap="round"
         strokeLinejoin="round" style={style} aria-hidden="true">
      {paths.map((p, i) => <path key={i} d={p} />)}
    </svg>
  );
}

// ── Doctor: today's appointments (agenda) ─────────────────────────────────
const DOCTOR_APPTS = [
  { time: "10:00", name: "Era Berisha", age: "4v 2m", reason: "Tonsillopharyngitis acuta", state: "done", chip: "A" },
  { time: "10:12", name: "Liam Berisha", age: "6m", reason: "ethe, përgjumje", walkin: true, state: "done", chip: "A" },
  { time: "10:30", name: "Dion Hoxha", age: "7m", reason: "Kontroll i rregullt", state: "done", chip: "B" },
  { time: "11:10", name: "Aria Kelmendi", age: "1v 3m", reason: "Kontroll i rregullt", state: "done", chip: "A" },
  { time: "11:47", name: "Ema Krasniqi", age: "2v 10m", reason: "plagë e vogël në gju", walkin: true, state: "done", chip: "A" },
  { time: "12:10", name: "Ben Krasniqi", age: "3v", reason: "Mungesë", state: "noshow", chipClass: "chip-amber", chip: "MS" },
  { time: "12:50", name: "Lena Hoti", age: "5v 8m", reason: "Bronkit akut · kontroll", state: "done", chip: "A" },
  { time: "13:55", name: "Dorian Hoxha", age: "4v 2m", reason: "kollitje, temperaturë 38.2", walkin: true, state: "arrived", chipClass: "chip-teal", chip: "Arriti" },
  { time: "14:20", name: "Era Krasniqi", age: "2v 9m", reason: "Kontroll i rregullt", state: "next", chipClass: "chip-teal", chip: "Tani" },
  { time: "14:50", name: "Mira Hoxhaj", age: "11m", reason: "Otitis media · pasvizitë", state: "", chip: "15 min" },
  { time: "15:30", name: "Endi Krasniqi", age: "3 ditë", reason: "Vizita e parë · pacient i ri", state: "", chipClass: "chip-amber", chip: "40 min" },
  { time: "16:30", name: "Lori Gashi", age: "6v 4m", reason: "Bronkit akut", state: "", chip: "15 min" },
  { time: "17:10", name: "Sara Berisha", age: "8m", reason: "Kontroll i rregullt", state: "", chip: "10 min" },
];

const DOCTOR_LOG = [
  { time: "12:50", pt: "Lena Hoti", age: "5v 8m", dx: "J20.9 Bronchitis acuta", code: "A", pay: "15 €" },
  { time: "11:10", pt: "Aria Kelmendi", age: "1v 3m", dx: "Z00.1 Kontroll i rregullt", code: "A", pay: "15 €" },
  { time: "10:30", pt: "Dion Hoxha", age: "7m", dx: "Z00.1 Kontroll rutinë", code: "B", pay: "10 €" },
  { time: "10:00", pt: "Era Berisha", age: "4v 2m", dx: "J03.9 Tonsillitis acuta", code: "A", pay: "15 €" },
  { time: "09:50", pt: "Drini Hoxha", age: "3v 1m", dx: "H66.9 Otitis media", code: "A", pay: "15 €" },
];

const NEXT_PATIENT = {
  name: "Era Krasniqi", age: "2v 9m", sex: "vajzë", visits: 5, lastSeen: "43 ditë",
  time: "14:20", inMin: 12, dur: "15 min",
  dx: "Tonsillitis acuta", dxCode: "J03.9 · 01.04.2026",
  weight: "13.6", weightSub: "P50 · ↑ 0.4 kg", height: "92", heightSub: "P50",
  hc: "48.2", hcSub: "P50",
  reason: "Kontroll i rregullt", reasonSub: "temperaturë e lehtë gjatë natës",
};

// ── Receptionist: stat cards + today agenda + walk-ins ────────────────────
const RECEPTION_STATS = {
  today: { num: 17, done: 5, scheduled: 9, walkin: 3 },
  tomorrow: { num: 12 },
};

const WALKINS = [
  { name: "Mira Krasniqi", sex: "girl", age: "4v 7m", status: "in-progress", meta: "filloi 14:12 · 23 min", pay: null },
  { name: "Aron Berisha", sex: "boy", age: "2v 3m", status: "completed", meta: "filloi 13:40 · u mbyll 13:58", code: "A", pay: "15 €" },
  { name: "Erza Hoti", sex: "girl", age: "6v 11m", status: "completed", meta: "filloi 11:20 · u mbyll 11:28", code: "B", pay: "10 €" },
];

// ── Patients (search) ─────────────────────────────────────────────────────
const PATIENTS = [
  { name: "Rita Hoxha", dob: "12.02.2024", age: "2v 3m", visits: 14, recent: "7d" },
  { name: "Era Krasniqi", dob: "03.08.2023", age: "2v 9m", visits: 6, recent: "30d" },
  { name: "Rinor Hoxha", dob: "07.11.2022", age: "3v 6m", visits: 9 },
  { name: "Leon Berisha", dob: "20.01.2025", age: "1v 4m", visits: 4 },
  { name: "Nora Gashi", dob: "11.09.2024", age: "1v 8m", visits: 2 },
  { name: "Drini Kelmendi", dob: "04.06.2023", age: "2v 11m", visits: 8 },
  { name: "Ema Hoxhaj", dob: "28.03.2024", age: "2v 2m", visits: 5 },
  { name: "Dion Hoxha", dob: "15.10.2024", age: "7m", visits: 3 },
];

// ── Compact week (tablet landscape receptionist) ──────────────────────────
// startMin/endMin measured from 10:00 (clinic day 10:00–18:00).
const WEEK_DAYS = [
  { label: "Hën 12", iso: "mon", past: true },
  { label: "Mar 13", iso: "tue", past: true },
  { label: "Mër 14", iso: "wed", today: true },
  { label: "Enj 15", iso: "thu" },
  { label: "Pre 16", iso: "fri" },
  { label: "Sht 17", iso: "sat" },
];
const WEEK_APPTS = {
  mon: [ {s:30,e:45,nm:"Era B.",st:"completed"}, {s:90,e:105,nm:"Dion H.",st:"completed"}, {s:180,e:195,nm:"Lori G.",st:"completed"}, {s:300,e:315,nm:"Sara B.",st:"noshow"} ],
  tue: [ {s:0,e:15,nm:"Aria K.",st:"completed"}, {s:60,e:80,nm:"Endi K.",st:"completed"}, {s:150,e:165,nm:"Mira H.",st:"completed"}, {s:240,e:255,nm:"Ben K.",st:"completed"} ],
  wed: [ {s:0,e:15,nm:"Era B.",st:"completed"}, {s:30,e:45,nm:"Dion H.",st:"completed"}, {s:70,e:85,nm:"Aria K.",st:"completed"}, {s:170,e:185,nm:"Lena H.",st:"completed"}, {s:260,e:275,nm:"Era K.",st:"inprog"}, {s:290,e:305,nm:"Mira H.",st:""}, {s:330,e:370,nm:"Endi K.",st:""}, {s:390,e:405,nm:"Lori G.",st:""} ],
  thu: [ {s:20,e:35,nm:"Nora G.",st:""}, {s:80,e:95,nm:"Leon B.",st:""}, {s:140,e:155,nm:"Rita H.",st:""}, {s:230,e:245,nm:"Rinor H.",st:""}, {s:310,e:325,nm:"Ema H.",st:""} ],
  fri: [ {s:40,e:55,nm:"Drini K.",st:""}, {s:120,e:135,nm:"Era K.",st:""}, {s:200,e:215,nm:"Aria K.",st:""}, {s:280,e:295,nm:"Sara B.",st:""} ],
  sat: [ {s:10,e:25,nm:"Lori G.",st:""}, {s:100,e:115,nm:"Dion H.",st:""}, {s:190,e:205,nm:"Mira H.",st:""} ],
};
const WEEK_HOURS = ["10","11","12","13","14","15","16","17"];

// Initials helper
function initials(name) {
  return name.split(" ").map(w => w[0]).slice(0, 2).join("").toUpperCase();
}

Object.assign(window, {
  Icon, initials,
  DOCTOR_APPTS, DOCTOR_LOG, NEXT_PATIENT,
  RECEPTION_STATS, WALKINS, PATIENTS,
  WEEK_DAYS, WEEK_APPTS, WEEK_HOURS,
});
