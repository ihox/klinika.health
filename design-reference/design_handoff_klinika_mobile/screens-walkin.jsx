// screens-walkin.jsx — Receptionist appointment creation.
//   mode "schedule" → pick date + Kohëzgjatja + time slot (booked appointment)
//   mode "walkin"   → immediate visit, no time (patient is here now)
// Both start with search-or-create, then land on the schedule step (the mode
// toggle there lets the receptionist switch between booking and walk-in).

// Next ~2 weeks of clinic days (base: E martë 14 maj 2026; Sunday closed).
const SCHED_DAYS = [
  { dow: "Sot", dnum: "14", endH: 18 },
  { dow: "E mër", dnum: "15", endH: 18 },
  { dow: "E enj", dnum: "16", endH: 18 },
  { dow: "E pre", dnum: "17", endH: 18 },
  { dow: "E sht", dnum: "18", endH: 14 },
  { dow: "E diel", dnum: "19", endH: 0, closed: true },
  { dow: "E hën", dnum: "20", endH: 18 },
  { dow: "E mar", dnum: "21", endH: 18 },
  { dow: "E mër", dnum: "22", endH: 18 },
];
const LENGTHS = [10, 15, 20, 40];
// Already-booked slots per day index (demo).
const TAKEN = {
  0: ["10:00", "10:30", "11:30", "14:00", "14:20", "15:30"],
  1: ["09:00", "11:00", "16:15"],
  6: ["10:00", "12:00"],
};

function genSlots(lenMin, endH) {
  const out = []; let h = 10, m = 0;
  while (h * 60 + m + lenMin <= endH * 60) {
    out.push(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
    m += lenMin; while (m >= 60) { m -= 60; h++; }
  }
  return out;
}

function initialsSafe(name) { return (name || "?").split(" ").map(w => w[0]).slice(0, 2).join("").toUpperCase(); }

function ScheduleStep({ device, patient, startMode, onBack, onChangePatient, onConfirm }) {
  const [mode, setMode] = React.useState(startMode || "schedule");
  const [dayIdx, setDayIdx] = React.useState(0);
  const [len, setLen] = React.useState(15);
  const [slot, setSlot] = React.useState(null);

  const day = SCHED_DAYS[dayIdx];
  const slots = day && !day.closed ? genSlots(len, day.endH) : [];
  const taken = TAKEN[dayIdx] || [];
  const canConfirm = mode === "walkin" || (day && !day.closed && slot);
  const sex = patient.sex || "f";

  return (
    <div className="m-app" style={{ flex: 1 }}>
      <div className="ms-subbar">
        <button className="back" onClick={onBack}><Icon d="chevleft" size={18} />Kthehu</button>
        <div className="sb-spacer" />
        <span className="sb-title">{mode === "walkin" ? "Vizitë pa termin" : "Cakto termin"}</span>
      </div>

      <div className="m-scroll">
        {/* Patient header */}
        <div className="ms-sched-patient">
          <span className={"av " + sex}>{initialsSafe(patient.name)}</span>
          <span className="si">
            <span className="nm">{patient.name}</span>
            <span className="dob">DL {patient.dob || "—"}{patient.age ? " · " + patient.age : ""}</span>
          </span>
          {onChangePatient && <button className="change" onClick={onChangePatient}>Ndrysho</button>}
        </div>

        {/* Mode toggle */}
        <div className="ms-mode-seg">
          <button className={"ms-mode-opt" + (mode === "schedule" ? " sel" : "")} onClick={() => setMode("schedule")}>
            <span className="l">Cakto termin</span><span className="s">datë & orë</span>
          </button>
          <button className={"ms-mode-opt" + (mode === "walkin" ? " sel" : "")} onClick={() => setMode("walkin")}>
            <span className="l">Tani · pa termin</span><span className="s">pacienti është këtu</span>
          </button>
        </div>

        {mode === "schedule" ? (
          <>
            <div className="ms-sched-section">Data</div>
            <div className="ms-day-strip">
              {SCHED_DAYS.map((d, i) => (
                <button key={i} className={"ms-day-chip" + (i === dayIdx ? " sel" : "") + (d.closed ? " closed" : "")}
                        disabled={d.closed} onClick={() => { setDayIdx(i); setSlot(null); }}>
                  <span className="dow">{d.dow}</span>
                  <span className="dnum">{d.dnum}</span>
                </button>
              ))}
            </div>

            <div className="ms-sched-section">Kohëzgjatja</div>
            <div className="ms-len-seg">
              {LENGTHS.map(l => (
                <button key={l} className={"ms-len-opt" + (l === len ? " sel" : "")} onClick={() => { setLen(l); setSlot(null); }}>{l} min</button>
              ))}
            </div>

            <div className="ms-sched-section">Ora · {day.closed ? "e mbyllur" : `${slots.length} terminе të lira`}</div>
            {day.closed ? (
              <div className="ms-slot-empty">Klinika është e mbyllur këtë ditë. Zgjedh një ditë tjetër.</div>
            ) : (
              <div className="ms-slot-grid">
                {slots.map(s => {
                  const isTaken = taken.includes(s);
                  return (
                    <button key={s} className={"ms-slot" + (slot === s ? " sel" : "") + (isTaken ? " taken" : "")}
                            disabled={isTaken} onClick={() => setSlot(s)}>{s}</button>
                  );
                })}
              </div>
            )}
          </>
        ) : (
          <div className="ms-locked" style={{ marginTop: 16 }}>
            <span className="ic"><Icon d="walkin" size={18} /></span>
            <span>Vizita krijohet <strong>tani</strong>, pa orë në kalendar, dhe i shtohet menjëherë listës së mjekut.</span>
          </div>
        )}
        <div style={{ height: 12 }} />
      </div>

      <div className="ms-savebar">
        <span style={{ flex: 1, fontSize: 12.5, color: "var(--text-muted)" }}>
          {mode === "walkin" ? "Vizitë e menjëhershme" : (slot ? `${day.dow} ${day.dnum} maj · ${slot} · ${len} min` : "Zgjedh orën")}
        </span>
        <button className="btn btn-primary" disabled={!canConfirm} style={{ opacity: canConfirm ? 1 : 0.5 }}
                onClick={() => canConfirm && onConfirm({ mode, day, slot, len, patient })}>
          {mode === "walkin" ? "Krijo vizitën" : "Cakto terminin"}
        </button>
      </div>
    </div>
  );
}

function WalkinFlow({ device, mode, initialPatient, onBack, onDone }) {
  const [step, setStep] = React.useState(initialPatient ? "schedule" : "search");
  const [patient, setPatient] = React.useState(initialPatient || null);
  const [q, setQ] = React.useState("");
  const inputRef = React.useRef(null);
  React.useEffect(() => { if (step === "search") setTimeout(() => inputRef.current && inputRef.current.focus(), 350); }, [step]);

  const term = q.trim().toLowerCase();
  const matches = term ? PATIENTS_FULL.filter(p => p.name.toLowerCase().includes(term)).slice(0, 5) : [];

  if (step === "schedule" && patient) {
    return <ScheduleStep device={device} patient={patient} startMode={mode}
                         onBack={initialPatient ? onBack : () => setStep("search")}
                         onChangePatient={initialPatient ? null : () => { setStep("search"); setPatient(null); }}
                         onConfirm={onDone} />;
  }

  if (step === "create") {
    return <NewPatientMinimal device={device} prefill={q}
                              onBack={() => setStep("search")}
                              onCreated={(p) => { setPatient(p); setStep("schedule"); }} />;
  }

  return (
    <div className="m-app" style={{ flex: 1 }}>
      <div className="ms-subbar">
        <button className="back" onClick={onBack}><Icon d="chevleft" size={18} />Anulo</button>
        <div className="sb-spacer" />
        <span className="sb-title">{mode === "walkin" ? "Vizitë pa termin" : "Cakto termin"}</span>
      </div>

      <div className="m-scroll">
        <div style={{ padding: "16px 16px 4px" }}>
          <div style={{ fontFamily: "var(--font-display)", fontSize: 18, fontWeight: 600, letterSpacing: "-0.015em" }}>Për kë është termini?</div>
          <div style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 4 }}>Kërko pacientin ekzistues ose krijo një të ri, pastaj cakto datën dhe orën.</div>
        </div>

        <div className="ms-walkin-search">
          <span className="icon"><Icon d="search" size={18} /></span>
          <input ref={inputRef} value={q} onChange={e => setQ(e.target.value)} placeholder="Emri i pacientit" autoComplete="off" />
        </div>

        {term && (
          <button className="ms-create-banner" onClick={() => setStep("create")} style={{ width: "calc(100% - 2*var(--m-gutter))" }}>
            <span className="plus"><Icon d="plus" size={18} sw={2} /></span>
            <span className="ct">
              <span className="l">Krijo pacient të ri</span>
              <span className="s">"{q}" — emër + datëlindje</span>
            </span>
          </button>
        )}

        {matches.length > 0 && <div className="ms-search-recent" style={{ marginTop: 12 }}>Pacientë ekzistues</div>}
        {matches.map(p => (
          <button key={p.id} className="ms-result" onClick={() => { setPatient(p); setStep("schedule"); }} style={{ width: "100%", textAlign: "left" }}>
            <span className="avatar">{initials(p.name)}</span>
            <span className="info"><span className="nm">{p.name}</span><span className="dob">DL {p.dob} · {p.age}</span></span>
            <span className="chip chip-teal">Zgjedh</span>
          </button>
        ))}

        {!term && (
          <div className="ms-empty" style={{ paddingTop: 36 }}>
            <span className="ico"><Icon d="walkin" size={24} /></span>
            <span className="t">Fillo të shkruash</span>
            <span className="d">Shkruaj emrin për të gjetur pacientin ose për të krijuar një të ri.</span>
          </div>
        )}
      </div>
    </div>
  );
}

// Minimal new patient — required: firstName, lastName, DOB, sex.
function NewPatientMinimal({ device, prefill, onBack, onCreated }) {
  const [sex, setSex] = React.useState("");
  const parts = (prefill || "").trim().split(" ");
  const [first, setFirst] = React.useState(parts[0] || "");
  const [last, setLast] = React.useState(parts.slice(1).join(" ") || "");
  const [dob, setDob] = React.useState("");

  return (
    <div className="m-app" style={{ flex: 1 }}>
      <div className="ms-subbar">
        <button className="back" onClick={onBack}><Icon d="chevleft" size={18} />Kthehu</button>
        <div className="sb-spacer" />
        <span className="sb-title">Pacient i ri</span>
      </div>

      <div className="m-scroll">
        <div className="ms-locked" style={{ marginTop: 14, background: "var(--primary-tint)", borderColor: "var(--teal-200)", color: "var(--teal-900)" }}>
          <span className="ic" style={{ color: "var(--primary)" }}><Icon d="M10 17a7 7 0 1 0 0-14 7 7 0 0 0 0 14 M10 9v4 M10 6.5h.01" size={18} /></span>
          <span>Vetëm të dhënat bazë. Mjeku plotëson alergjitë, shënimet dhe historinë më vonë në kompjuter.</span>
        </div>

        <div className="ms-userform-field" style={{ borderTop: "1px solid var(--border-soft)", marginTop: 12 }}><label>Emri *</label><input value={first} onChange={e => setFirst(e.target.value)} placeholder="Emri" /></div>
        <div className="ms-userform-field"><label>Mbiemri *</label><input value={last} onChange={e => setLast(e.target.value)} placeholder="Mbiemri" /></div>
        <div className="ms-userform-field"><label>Datëlindja *</label><input value={dob} onChange={e => setDob(e.target.value)} placeholder="dd.mm.vvvv" inputMode="numeric" /></div>
        <div className="ms-userform-field">
          <label>Gjinia *</label>
          <div className="ms-sex-seg">
            <button type="button" className={"ms-sex-opt f" + (sex === "f" ? " checked" : "")} onClick={() => setSex("f")}>Vajzë</button>
            <button type="button" className={"ms-sex-opt m" + (sex === "m" ? " checked" : "")} onClick={() => setSex("m")}>Djalë</button>
          </div>
        </div>
        <div className="ms-user-group-label">Opsionale</div>
        <div className="ms-userform-field"><label>Telefoni i kujdestarit</label><input placeholder="+383 ..." inputMode="tel" /></div>
        <div className="ms-userform-field" style={{ borderBottom: "none" }}><label>Adresa</label><input placeholder="Qyteti / rruga" /></div>
        <div style={{ height: 12 }} />
      </div>

      <div className="ms-savebar">
        <span style={{ flex: 1, fontSize: 12.5, color: "var(--text-muted)" }}>Pastaj zgjedh datën & orën</span>
        <button className="btn btn-ghost" onClick={onBack} style={{ flex: "0 0 auto" }}>Anulo</button>
        <button className="btn btn-primary" onClick={() => onCreated({ name: `${first} ${last}`.trim() || "Pacient i ri", dob: dob || "—", sex: sex || "f", age: "i ri" })}>Vazhdo</button>
      </div>
    </div>
  );
}

Object.assign(window, { WalkinFlow, NewPatientMinimal, ScheduleStep });
