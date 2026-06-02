// screens-doctor.jsx — Doctor home ("Pamja e ditës").
// Phone: single-column agenda (next-patient hero + today's list + stats).
// Tablet portrait: same, roomier. Tablet landscape: two columns (next + log
// left, agenda right) — closer to desktop richness per the design decision.

function ApptRow({ a, onOpen }) {
  const stateCls = a.state === "done" || a.state === "noshow" ? "done" : a.state;
  return (
    <button className={"ms-appt " + stateCls + (a.state === "noshow" ? " noshow" : "")} onClick={onOpen}>
      <span className="time">{a.time}</span>
      <span className="sd" />
      <span style={{ minWidth: 0 }}>
        <span className="nm">
          {a.walkin && <span className="wn" title="Pa termin"><Icon d="walkin" size={10} sw={2} /></span>}
          {a.name}<span className="age">{a.age}</span>
        </span>
        <span className="rs">{a.walkin && <span className="wn-tag">Pa termin · </span>}{a.reason}</span>
      </span>
      <span className={"chip " + (a.chipClass || "")}>{a.chipClass && a.chip !== "MS" && <span className="dot" />}{a.chip}</span>
    </button>
  );
}

function NextPatientCard({ onOpen, device }) {
  const n = NEXT_PATIENT;
  return (
    <button className="ms-next" onClick={onOpen}>
      <span className="nx-tag"><span className="dot" />Pacienti në vijim · pas {n.inMin} minutash</span>
      <span className="nx-top">
        <span>
          <span className="nx-name">{n.name}</span>
          <span className="nx-meta">
            <span><strong>{n.age}</strong> · {n.sex}</span>
            <span>{n.visits} vizita</span>
            <span className="chip chip-green"><span className="dot" />{n.lastSeen} nga vizita e fundit</span>
          </span>
        </span>
        <span className="nx-time">
          <span className="t">{n.time}</span>
          <span className="s">Mar · {n.dur}</span>
        </span>
      </span>
      <span className="nx-vitals">
        <span className="nx-textcol">
          <span className="nx-item"><span className="lab">Diagnoza e fundit</span><span className="v" style={{ fontSize: 14 }}>{n.dx}</span><span className="vs">{n.dxCode}</span></span>
          <span className="nx-item"><span className="lab">Arsyeja</span><span className="v" style={{ fontSize: 14 }}>{n.reason}</span><span className="vs">{n.reasonSub}</span></span>
        </span>
        <span className="nx-measures">
          <span className="nx-item"><span className="lab">Pesha</span><span className="v">{n.weight}<span className="u">kg</span></span><span className="vs">{n.weightSub}</span></span>
          <span className="nx-item"><span className="lab">Gjatësia</span><span className="v">{n.height}<span className="u">cm</span></span><span className="vs">{n.heightSub}</span></span>
          <span className="nx-item"><span className="lab">Perimetri i kokës</span><span className="v">{n.hc}<span className="u">cm</span></span><span className="vs">{n.hcSub}</span></span>
        </span>
      </span>
      <span className="nx-actions">
        <span className="btn btn-primary">Hap kartelën →</span>
        {device !== "phone" && <span className="btn btn-secondary">Shiko historinë</span>}
      </span>
    </button>
  );
}

function ApptListCard({ filter, setFilter, onOpen }) {
  const list = filter
    ? DOCTOR_APPTS.filter(a => (a.name + " " + a.reason).toLowerCase().includes(filter.toLowerCase()))
    : DOCTOR_APPTS;
  return (
    <section className="ms-card">
      <div className="ms-card-head">
        <h3>Terminet e sotit</h3>
        <span className="meta">17 vizita · 5 të kryera</span>
      </div>
      <div className="ms-listsearch">
        <span className="icon"><Icon d="search" size={16} /></span>
        <input type="search" value={filter} onChange={e => setFilter(e.target.value)}
               placeholder="Kërko pacientin në listë" autoComplete="off" />
      </div>
      <div>
        {list.map((a, i) => <ApptRow key={i} a={a} onOpen={onOpen} />)}
        {list.length === 0 && <div style={{ padding: "18px 16px", fontSize: 13, color: "var(--text-faint)", textAlign: "center" }}>Asnjë pacient nuk përputhet.</div>}
      </div>
    </section>
  );
}

function DoneLogCard() {
  return (
    <section className="ms-card">
      <div className="ms-card-head"><h3>Vizitat e sotshme</h3><span className="meta">5 të regjistruara</span></div>
      <div className="ms-log">
        {DOCTOR_LOG.map((r, i) => (
          <div className="row" key={i}>
            <span className="time">{r.time}</span>
            <span className="pt">{r.pt}<span className="age">{r.age}</span><span className="dx">{r.dx}</span></span>
            <span className="pay"><span className="code">{r.code}</span>{r.pay}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function DoctorHome({ device, emptyState, onOpenChart }) {
  const [filter, setFilter] = React.useState("");

  if (emptyState) {
    return (
      <div className="m-scroll">
        <div className="ms-intro">
          <div className="gr">Mirëdita, <span className="accent">Dr. Taulant</span>.</div>
          <div className="sub">E diel, 18 maj 2026 · klinika është e mbyllur sot</div>
        </div>
        <div className="ms-empty" style={{ paddingTop: 64 }}>
          <span className="ico"><Icon d="calendar" size={26} /></span>
          <span className="t">Asnjë termin sot</span>
          <span className="d">Nuk ka vizita të planifikuara. Pacientët pa termin do të shfaqen këtu sapo të arrijnë.</span>
        </div>
      </div>
    );
  }

  const intro = (
    <div className="ms-intro">
      <div className="gr">Mirëdita, <span className="accent">Dr. Taulant</span>.</div>
      <div className="sub">E martë, 14 maj · 5 të kryera · 9 të mbetura · <span className="wn">3 pa termin</span></div>
    </div>
  );

  if (device === "ipad-l") {
    return (
      <div className="m-scroll">
        {intro}
        <div className="ms-two">
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--m-s4)" }}>
            <NextPatientCard device={device} onOpen={onOpenChart} />
            <DoneLogCard />
          </div>
          <ApptListCard filter={filter} setFilter={setFilter} onOpen={onOpenChart} />
        </div>
        <div style={{ height: 24 }} />
      </div>
    );
  }

  return (
    <div className="m-scroll">
      {intro}
      <NextPatientCard device={device} onOpen={onOpenChart} />
      <ApptListCard filter={filter} setFilter={setFilter} onOpen={onOpenChart} />
      {device !== "phone" && <DoneLogCard />}
      <div style={{ height: 24 }} />
    </div>
  );
}

Object.assign(window, { DoctorHome, NextPatientCard, ApptListCard, DoneLogCard });
