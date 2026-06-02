// screens-patient.jsx — patient list + adaptive patient chart.
//   Tablet landscape (ipad-l): split-pane (visit list + detail side by side).
//   Phone + tablet portrait: drilldown (chart tabs → tap visit → detail).

// ── Patient list ──────────────────────────────────────────────────────────
function PatientList({ device, role, emptyState, onOpenPatient, onNewPatient }) {
  const [q, setQ] = React.useState("");
  const isReception = role === "reception"; // name + DOB only
  const list = emptyState ? [] : PATIENTS_FULL.filter(p => !q.trim() || p.name.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <div className="m-app" style={{ flex: 1 }}>
      <div className="ms-list-search">
        <div className="field">
          <span className="icon"><Icon d="search" size={18} /></span>
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Kërko me emër ose datëlindje" autoComplete="off" />
        </div>
        <button className="sortbtn" aria-label="Rendit"><Icon d="filter" /></button>
      </div>
      <div className="m-scroll">
        {!emptyState && (
          <div className="m-section-label" style={{ marginTop: 14 }}>
            {q ? `${list.length} rezultate` : `${PATIENTS_FULL.length} pacientë · alfabetik`}
          </div>
        )}
        {list.map(p => (
          <button key={p.id} className="ms-prow-row" onClick={() => onOpenPatient(p)} style={{ width: "100%", textAlign: "left" }}>
            <span className={"avatar " + p.sex}>{initials(p.name)}</span>
            <span className="info">
              <span className="nm">{p.name}<span className={"sex " + p.sex}>{p.sex === "f" ? "F" : "M"}</span>{p.today && <span className="chip chip-teal" style={{ marginLeft: 2 }}><span className="dot" />Sot</span>}</span>
              <span className="meta">DL {p.dob} · {p.age}</span>
              {!isReception && device !== "phone" && <span className="dx">{p.lastDx}</span>}
            </span>
            <span className="tail">
              {!isReception && device !== "phone" && <span className="chip chip-neutral" style={{ fontSize: 11 }}>{p.visits} vizita</span>}
              {isReception && p.recent && <span className="chip chip-green"><span className="dot" />{p.lastSeen}</span>}
              <span className="chev"><Icon d="chevright" size={16} /></span>
            </span>
          </button>
        ))}
        {emptyState && (
          <div className="ms-empty" style={{ paddingTop: 64 }}>
            <span className="ico"><Icon d="patients" size={26} /></span>
            <span className="t">Asnjë pacient</span>
            <span className="d">Lista është bosh. Shto pacientin e parë për të filluar.</span>
          </div>
        )}
        {!emptyState && list.length === 0 && (
          <div className="ms-empty" style={{ paddingTop: 40 }}>
            <span className="ico"><Icon d="search" size={24} /></span>
            <span className="t">Asnjë rezultat</span>
            <span className="d">Asnjë pacient nuk përputhet me "{q}".</span>
          </div>
        )}
        <div className="m-tabspace" />
      </div>
      <button className="m-fab" onClick={onNewPatient} aria-label="Shto pacient"><Icon d="plus" size={24} sw={2} /></button>
    </div>
  );
}

// ── Master strip (shared by both layouts) ─────────────────────────────────
function MasterStrip({ p }) {
  return (
    <>
      <div className="ms-master">
        <div className="mm-top">
          <span className={"mm-avatar " + p.sex}>{initials(p.name)}</span>
          <div className="mm-id">
            <div className="mm-name">{p.name}<span className={"sex-pill" + (p.sex === "m" ? " m" : "")}>{p.sex === "f" ? "F" : "M"}</span>
              <span className="chip chip-green" style={{ fontSize: 11 }}><span className="dot" />{p.lastSeen}</span>
            </div>
            <div className="mm-sub"><span className="strong">{p.age}</span> · lindur {p.dob} · <span className="mm-pid">#{p.id}</span></div>
          </div>
        </div>
        <div className="mm-stats">
          <div className="mm-stat"><div className="l">Pesha sot</div><div className="v">{p.weightNow}<span className="u">kg</span></div></div>
          <div className="mm-stat"><div className="l">Pesha lindjes</div><div className="v">{p.birthWeight}<span className="u">g</span></div></div>
          <div className="mm-stat"><div className="l">Gjat. lindjes</div><div className="v">{p.birthLength}<span className="u">cm</span></div></div>
          <div className="mm-stat"><div className="l">Vizita</div><div className="v">{p.visits}</div></div>
        </div>
      </div>
      {p.allergy && (
        <div className="ms-allergy">
          <span className="ic">!</span><span className="lab">Alergji / Tjera</span><span className="val">{p.allergy}</span>
        </div>
      )}
    </>
  );
}

// ── Visit list (reused in split-pane left + drilldown Vizitat tab) ─────────
function VisitList({ selectedId, onSelect, compact }) {
  return (
    <div>
      {VISITS.map(v => (
        <button key={v.id} className={"ms-visit" + (selectedId === v.id ? " is-selected" : "")} onClick={() => onSelect(v)} style={{ width: "100%", textAlign: "left" }}>
          <span>
            <span className="v-date">{v.date}{v.today && " · sot"}</span>
            <span className="v-dx"><span className="code">{v.dx.split(" ")[0]}</span>{v.dxShort}</span>
            <span className="v-sub">
              {v.status === "in-progress" && <span className="chip chip-teal"><span className="dot" />Në vijim</span>}
              {v.status === "completed" && <span className="chip chip-green"><span className="dot" />Kryer</span>}
              <span className="v-pay"><span className="code">{v.pay}</span>{v.payAmt}</span>
              {v.hasUS && <span className="v-us"><Icon d="M3 5h10v7H3z M3 9l3-2 2 1.5 3-3" size={11} />US</span>}
            </span>
          </span>
          <span className="v-chev"><Icon d="chevright" size={16} /></span>
        </button>
      ))}
    </div>
  );
}

// ── Data tab (Të dhëna) ────────────────────────────────────────────────────
function DataTab({ p }) {
  return (
    <div className="m-scroll">
      <div className="ms-data-card">
        <div className="dc-head">Të dhënat personale</div>
        <div className="ms-data-row"><span className="k">Emri i plotë</span><span className="v">{p.name}</span></div>
        <div className="ms-data-row"><span className="k">Gjinia</span><span className="v">{p.sexLabel}</span></div>
        <div className="ms-data-row"><span className="k">Datëlindja</span><span className="v">{p.dob} · {p.age}</span></div>
        <div className="ms-data-row"><span className="k">ID e pacientit</span><span className="v" style={{ fontFamily: "var(--font-mono)", fontSize: 13 }}>#{p.id}</span></div>
        <div className="ms-data-row"><span className="k">Adresa</span><span className="v">{p.address}</span></div>
      </div>
      <div className="ms-data-card">
        <div className="dc-head">Kujdestari</div>
        <div className="ms-data-row"><span className="k">Emri</span><span className="v">{p.guardian}</span></div>
        <div className="ms-data-row"><span className="k">Telefoni</span><span className="v">{p.guardianPhone}</span></div>
      </div>
      <div className="ms-data-card">
        <div className="dc-head">Të dhënat e lindjes</div>
        <div className="ms-data-row"><span className="k">Pesha e lindjes</span><span className="v">{p.birthWeight} g</span></div>
        <div className="ms-data-row"><span className="k">Gjatësia e lindjes</span><span className="v">{p.birthLength} cm</span></div>
        <div className="ms-data-row"><span className="k">Perimetri i kokës</span><span className="v">{p.birthHC} cm</span></div>
      </div>
      <div style={{ height: 24 }} />
    </div>
  );
}

// ── Receptionist master strip (identity + contact ONLY — privacy boundary) ─
function ReceptionMasterStrip({ p }) {
  return (
    <div className="ms-master">
      <div className="mm-top">
        <span className={"mm-avatar " + p.sex}>{initials(p.name)}</span>
        <div className="mm-id">
          <div className="mm-name">{p.name}<span className={"sex-pill" + (p.sex === "m" ? " m" : "")}>{p.sex === "f" ? "F" : "M"}</span></div>
          <div className="mm-sub"><span className="strong">{p.age}</span> · lindur {p.dob} · <span className="mm-pid">#{p.id}</span></div>
        </div>
      </div>
    </div>
  );
}

// Appointment history for the receptionist — date + time + status, NO
// diagnosis / payment / clinical data (ADR privacy boundary).
const RECEPTION_APPTS = [
  { id: "v5", date: "14.05.2026", time: "14:20", status: "in-progress", today: true },
  { id: "v4", date: "01.04.2026", time: "11:10", status: "completed" },
  { id: "v3", date: "22.02.2026", time: "10:30", status: "completed" },
  { id: "v2", date: "17.12.2025", time: "16:00", status: "completed" },
  { id: "v1", date: "04.10.2025", time: "09:40", status: "completed" },
];

// ── Receptionist patient chart (restricted) ───────────────────────────────
function ReceptionChart({ device, showBack, onBack, onSchedule }) {
  const p = PATIENT;
  const [tab, setTab] = React.useState("appts");
  return (
    <div className="m-app" style={{ flex: 1 }}>
      {showBack && (
        <div className="ms-subbar">
          <button className="back" onClick={onBack}><Icon d="chevleft" size={18} />Pacientët</button>
          <div className="sb-spacer" />
          <button className="btn btn-secondary btn-sm" onClick={onSchedule} style={{ minHeight: 38 }}><Icon d="plus" size={15} sw={2} style={{ marginRight: 5 }} />Vizitë pa termin</button>
        </div>
      )}
      <ReceptionMasterStrip p={p} />
      <div className="ms-locked" style={{ marginTop: 0, borderRadius: 0, border: "none", borderBottom: "1px solid var(--border)", background: "var(--bg-subtle)" }}>
        <span className="ic"><Icon d="M5 9V6.5a3 3 0 0 1 6 0V9 M3.5 9h9v6.5h-9z" size={16} /></span>
        <span>Recepsioni sheh vetëm <strong>emrin, datëlindjen dhe terminet</strong>. Të dhënat klinike janë vetëm për mjekun.</span>
      </div>
      <div className="ms-charttabs">
        <button className={"ms-charttab" + (tab === "appts" ? " is-active" : "")} onClick={() => setTab("appts")}>Terminet<span className="cnt">{RECEPTION_APPTS.length}</span></button>
        <button className={"ms-charttab" + (tab === "data" ? " is-active" : "")} onClick={() => setTab("data")}>Të dhëna</button>
      </div>

      {tab === "appts" && (
        <div className="m-scroll">
          <div>
            {RECEPTION_APPTS.map(a => (
              <div key={a.id} className="ms-visit" style={{ cursor: "default" }}>
                <span>
                  <span className="v-date">{a.date}{a.today && " · sot"} · {a.time}</span>
                  <span className="v-sub" style={{ marginTop: 6 }}>
                    {a.status === "in-progress" && <span className="chip chip-teal"><span className="dot" />Në vijim</span>}
                    {a.status === "completed" && <span className="chip chip-green"><span className="dot" />Përfunduar</span>}
                    {a.status === "scheduled" && <span className="chip chip-indigo"><span className="dot" />I planifikuar</span>}
                  </span>
                </span>
              </div>
            ))}
          </div>
          <div style={{ height: 16 }} />
          <button className="m-fab" onClick={onSchedule} aria-label="Vizitë pa termin"><Icon d="plus" size={24} sw={2} /></button>
        </div>
      )}

      {tab === "data" && (
        <div className="m-scroll">
          <div className="ms-data-card">
            <div className="dc-head">Të dhënat bazë</div>
            <div className="ms-data-row"><span className="k">Emri i plotë</span><span className="v">{p.name}</span></div>
            <div className="ms-data-row"><span className="k">Gjinia</span><span className="v">{p.sexLabel}</span></div>
            <div className="ms-data-row"><span className="k">Datëlindja</span><span className="v">{p.dob} · {p.age}</span></div>
            <div className="ms-data-row"><span className="k">ID e pacientit</span><span className="v" style={{ fontFamily: "var(--font-mono)", fontSize: 13 }}>#{p.id}</span></div>
          </div>
          <div className="ms-data-card">
            <div className="dc-head">Kontakti i kujdestarit</div>
            <div className="ms-data-row"><span className="k">Emri</span><span className="v">{p.guardian}</span></div>
            <div className="ms-data-row"><span className="k">Telefoni</span><span className="v">{p.guardianPhone}</span></div>
            <div className="ms-data-row"><span className="k">Adresa</span><span className="v">{p.address}</span></div>
          </div>
          <div style={{ height: 24 }} />
        </div>
      )}
    </div>
  );
}

// ── Patient chart (adaptive) ───────────────────────────────────────────────
function PatientChart({ device, role, showBack, onBack, onOpenVisit, onNewVisit }) {
  // Privacy boundary: receptionists get the restricted chart, never clinical.
  if (role === "reception") {
    return <ReceptionChart device={device} showBack={showBack} onBack={onBack} onSchedule={onNewVisit} />;
  }
  const p = PATIENT;
  const isLandscape = device === "ipad-l";
  const [tab, setTab] = React.useState("visits");
  const [selVisit, setSelVisit] = React.useState(isLandscape ? VISITS[0] : null);
  const [newMode, setNewMode] = React.useState(false);
  const [growthOpen, setGrowthOpen] = React.useState(false);
  const [growthType, setGrowthType] = React.useState("weight");
  const [lbStudy, setLbStudy] = React.useState(null);
  const [lbStart, setLbStart] = React.useState(0);
  const [lbOpen, setLbOpen] = React.useState(false);

  const [linkStudyObj, setLinkStudyObj] = React.useState(null);
  const [linkOpen, setLinkOpen] = React.useState(false);
  const openGrowth = (t) => { setGrowthType(t); setGrowthOpen(true); };
  const openLightbox = (study, i) => { setLbStudy(study); setLbStart(i); setLbOpen(true); };
  const linkStudy = (study) => { setLinkStudyObj(study); setLinkOpen(true); };

  const tabs = [
    { id: "visits", label: "Vizitat", cnt: VISITS.length },
    { id: "growth", label: "Rritja" },
    { id: "dicom", label: "Ultrazëri", badge: DICOM_STUDIES.some(s => !s.linked) },
    { id: "data", label: "Të dhëna" },
  ];

  const TabletBack = showBack ? (
    <div className="ms-subbar">
      <button className="back" onClick={onBack}><Icon d="chevleft" size={18} />Pacientët</button>
      <div className="sb-spacer" />
      <button className="btn btn-secondary btn-sm" onClick={() => { setNewMode(true); setSelVisit(null); }} style={{ minHeight: 38 }}><Icon d="plus" size={15} sw={2} style={{ marginRight: 5 }} />Vizitë e re</button>
    </div>
  ) : null;

  // ── Split-pane (landscape) ──
  if (isLandscape) {
    return (
      <div className="m-app" style={{ flex: 1 }}>
        {TabletBack}
        <MasterStrip p={p} />
        <div className="ms-split">
          <div className="sp-left">
            <div className="sp-lead"><h3>Vizitat</h3><span className="meta">{VISITS.length} · {p.visits} gjithsej</span></div>
            <VisitList selectedId={newMode ? null : (selVisit && selVisit.id)} onSelect={(v) => { setSelVisit(v); setNewMode(false); }} />
            <div style={{ padding: 12 }}>
              <button className="btn btn-secondary" style={{ width: "100%", minHeight: 44 }} onClick={() => { setNewMode(true); setSelVisit(null); }}><Icon d="plus" size={16} sw={2} style={{ marginRight: 6 }} />Vizitë e re</button>
            </div>
          </div>
          <div className="sp-right">
            {newMode
              ? <VisitForm device={device} role={role} isNew={true} onCloseNew={() => { setNewMode(false); setSelVisit(VISITS[0]); }} />
              : selVisit
              ? <VisitForm device={device} role={role} isNew={false} key={selVisit.id} />
              : <div className="ms-empty" style={{ height: "100%" }}><span className="ico"><Icon d="report" size={26} /></span><span className="t">Zgjedh një vizitë</span><span className="d">Zgjedh një vizitë nga lista për ta parë dhe redaktuar.</span></div>}
          </div>
        </div>
        <DicomLightbox open={lbOpen} study={lbStudy} startIndex={lbStart} onClose={() => setLbOpen(false)} onLink={(s) => { setLbOpen(false); linkStudy(s); }} />
        <GrowthLightbox open={growthOpen} type={growthType} sex={p.sex} onClose={() => setGrowthOpen(false)} />
        <DicomLinkSheet open={linkOpen} study={linkStudyObj} onClose={() => setLinkOpen(false)} onLinked={() => setLinkOpen(false)} />
      </div>
    );
  }

  // ── Drilldown (phone + tablet portrait) ──
  return (
    <div className="m-app" style={{ flex: 1 }}>
      {TabletBack}
      <MasterStrip p={p} />
      <div className="ms-charttabs">
        {tabs.map(t => (
          <button key={t.id} className={"ms-charttab" + (tab === t.id ? " is-active" : "")} onClick={() => setTab(t.id)}>
            {t.label}
            {t.cnt != null && <span className="cnt">{t.cnt}</span>}
            {t.badge && <span className="badge-new">re</span>}
          </button>
        ))}
      </div>

      {tab === "visits" && (
        <div className="m-scroll">
          <VisitList selectedId={null} onSelect={onOpenVisit} />
          <div style={{ height: 16 }} />
        </div>
      )}
      {tab === "growth" && (
        <div className="m-scroll">
          <GrowthTab device={device} sex={p.sex} onOpen={openGrowth} />
        </div>
      )}
      {tab === "dicom" && <DicomTab device={device} onOpenLightbox={openLightbox} onLink={linkStudy} />}
      {tab === "data" && <DataTab p={p} />}
      {tab === "visits" && (
        <button className="m-fab" onClick={onNewVisit} aria-label="Vizitë e re"><Icon d="plus" size={24} sw={2} /></button>
      )}

      <DicomLightbox open={lbOpen} study={lbStudy} startIndex={lbStart} onClose={() => setLbOpen(false)} onLink={(s) => { setLbOpen(false); linkStudy(s); }} />
      <GrowthLightbox open={growthOpen} type={growthType} sex={p.sex} onClose={() => setGrowthOpen(false)} />
      <DicomLinkSheet open={linkOpen} study={linkStudyObj} onClose={() => setLinkOpen(false)} onLinked={() => setLinkOpen(false)} />
    </div>
  );
}

Object.assign(window, { PatientList, PatientChart, MasterStrip, VisitList, DataTab, ReceptionChart });
