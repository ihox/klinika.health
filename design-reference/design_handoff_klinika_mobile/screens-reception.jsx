// screens-reception.jsx — Receptionist home ("Kalendari").
// Phone: stat cards + day-by-day agenda list + walk-in band (the week grid
//   does not fit a phone, so day-list is the canonical phone view).
// Tablet: Ditë (day list) / Javë (compact week grid) segmented toggle.

const RECEPTION_DAY = [
  { time: "10:00", name: "Era Berisha", age: "4v 2m", state: "completed", reason: "Tonsillitis acuta" },
  { time: "10:30", name: "Dion Hoxha", age: "7m", state: "completed", reason: "Kontroll i rregullt" },
  { time: "11:10", name: "Aria Kelmendi", age: "1v 3m", state: "completed", reason: "Kontroll i rregullt" },
  { time: "12:10", name: "Ben Krasniqi", age: "3v", state: "noshow", reason: "Mungesë" },
  { time: "12:50", name: "Lena Hoti", age: "5v 8m", state: "completed", reason: "Bronkit akut" },
  { time: "14:20", name: "Era Krasniqi", age: "2v 9m", state: "next", reason: "Kontroll i rregullt" },
  { time: "14:50", name: "Mira Hoxhaj", age: "11m", state: "", reason: "Otitis media · pasvizitë" },
  { time: "15:30", name: "Endi Krasniqi", age: "3 ditë", state: "", reason: "Vizita e parë · pacient i ri" },
  { time: "16:30", name: "Lori Gashi", age: "6v 4m", state: "", reason: "Bronkit akut" },
  { time: "17:10", name: "Sara Berisha", age: "8m", state: "", reason: "Kontroll i rregullt" },
];

const FILTERS = [
  { id: "all", cls: "fp-all", label: "Të gjitha", count: 17 },
  { id: "scheduled", cls: "fp-scheduled", label: "Me termin", count: 9 },
  { id: "completed", cls: "fp-completed", label: "Kryer", count: 5 },
  { id: "noshow", cls: "fp-noshow", label: "Mungesë", count: 1 },
];

function StatCards() {
  const s = RECEPTION_STATS;
  return (
    <div className="ms-statgrid">
      <div className="ms-stat accent">
        <div className="lab">Sot · 14 maj</div>
        <div className="num">{s.today.num}</div>
        <div className="foot"><strong>{s.today.done}</strong> kryer · <strong>{s.today.walkin}</strong> pa termin</div>
      </div>
      <div className="ms-stat">
        <div className="lab">Nesër · 15 maj</div>
        <div className="num">{s.tomorrow.num}</div>
        <div className="foot">vizita të planifikuara</div>
      </div>
    </div>
  );
}

function WalkinBand({ device }) {
  return (
    <section className="ms-walkin">
      <div className="wb-head">
        <span className="wb-title">Vizita pa termin sot</span>
        <span className="wb-count"><strong>{WALKINS.length}</strong> · pa orë në kalendar</span>
      </div>
      <div className="wb-grid">
        {WALKINS.map((w, i) => (
          <button className="ms-wcard" key={i}>
            <span className="wc-top">
              <span className="wc-name">{w.name}</span>
              {w.status === "in-progress"
                ? <span className="chip chip-teal"><span className="dot" />Në vizitë</span>
                : <span className="chip chip-green"><span className="dot" />Kryer</span>}
            </span>
            <span style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 6 }}>
              <span className="wc-meta">{w.meta}</span>
              {w.pay
                ? <span className="wc-pay"><span className="code">{w.code}</span>{w.pay}</span>
                : <span className="wc-meta" style={{ fontStyle: "italic" }}>pa pagesë ende</span>}
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}

function WeekGrid({ onOpen }) {
  // 56px per hour. startMin measured from 10:00.
  const PX = 56 / 60;
  return (
    <div className="ms-week">
      <div className="ms-week-grid">
        <div className="wh axis" />
        {WEEK_DAYS.map(d => <div key={d.iso} className={"wh" + (d.today ? " today" : "")}>{d.label}</div>)}
      </div>
      <div className="ms-week-body">
        <div className="ms-week-axis">
          {WEEK_HOURS.map(h => <div className="h" key={h}><span className="lab">{h}</span></div>)}
        </div>
        {WEEK_DAYS.map(d => (
          <div key={d.iso} className={"ms-week-col" + (d.today ? " today" : "")}>
            {(WEEK_APPTS[d.iso] || []).map((a, i) => (
              <button key={i} className={"ms-wappt " + a.st} title={a.nm} onClick={onOpen}
                   style={{ top: a.s * PX, height: Math.max(13, (a.e - a.s) * PX - 2) }}>{a.nm}</button>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function ReceptionHome({ device, emptyState, onOpenChart, onSchedule, onWalkin }) {
  const [filter, setFilter] = React.useState("all");
  const isTablet = device !== "phone";
  const isLandscape = device === "ipad-l";
  // Tablet landscape (desktop-class width) defaults to the week calendar grid,
  // matching the desktop receptionist surface. Portrait/phone default to day list.
  const [view, setView] = React.useState(isLandscape ? "week" : "day"); // day | week (tablet only)
  const [userPickedView, setUserPickedView] = React.useState(false);
  React.useEffect(() => {
    if (!userPickedView) setView(isLandscape ? "week" : "day");
  }, [isLandscape, userPickedView]);
  const pickView = (v) => { setUserPickedView(true); setView(v); };

  if (emptyState) {
    return (
      <div className="m-scroll">
        <StatCards />
        <div className="ms-daystrip">
          <button className="dnav"><Icon d="chevleft" size={18} /></button>
          <span className="dlabel">E diel, 18 maj</span>
          <button className="dnav"><Icon d="chevright" size={18} /></button>
        </div>
        <div className="ms-empty" style={{ paddingTop: 40 }}>
          <span className="ico"><Icon d="calendar" size={26} /></span>
          <span className="t">Klinika është e mbyllur</span>
          <span className="d">Asnjë termin për këtë ditë. Zgjidh një ditë tjetër ose cakto një termin të ri.</span>
        </div>
      </div>
    );
  }

  const dayList = filter === "all" ? RECEPTION_DAY
    : RECEPTION_DAY.filter(a => a.state === filter || (filter === "scheduled" && (a.state === "" || a.state === "next")));

  return (
    <div className="m-app" style={{ flex: 1 }}>
      <div className="m-scroll">
        <StatCards />

        {/* Receptionist's primary actions: schedule (date/time/length) or walk-in */}
        <div className="ms-walkin-cta" style={{ display: "flex", gap: 10 }}>
          <button className="ms-walkin-btn" onClick={onSchedule} style={{ flex: 1.4 }}>
            <Icon d="calendar" size={20} sw={1.7} />Cakto termin
          </button>
          <button className="ms-walkin-btn" onClick={onWalkin} style={{ flex: 1, background: "var(--bg-elevated)", color: "var(--primary-dark)", border: "1px solid var(--teal-300)", boxShadow: "none" }}>
            <Icon d="walkin" size={19} sw={1.7} />Pa termin
          </button>
        </div>

      <div className="ms-daystrip">
        <button className="dnav" aria-label="Dita e mëparshme"><Icon d="chevleft" size={18} /></button>
        <span className="dlabel">E martë, 14 maj <span className="today-pill">Sot</span></span>
        <button className="dnav" aria-label="Dita tjetër"><Icon d="chevright" size={18} /></button>
      </div>

      {isTablet && (
        <div style={{ display: "flex", justifyContent: "center", padding: "4px 0 8px" }}>
          <div className="ms-viewtoggle">
            <button className={view === "day" ? "is-active" : ""} onClick={() => pickView("day")}>Ditë</button>
            <button className={view === "week" ? "is-active" : ""} onClick={() => pickView("week")}>Javë</button>
          </div>
        </div>
      )}

      {isTablet && view === "week" ? (
        <>
          <WeekGrid onOpen={onOpenChart} />
          <div style={{ height: 24 }} />
        </>
      ) : (
        <>
          <div className="ms-pills">
            {FILTERS.map(f => (
              <button key={f.id} className={"filter-pill " + f.cls + (filter === f.id ? " is-active" : "")}
                      onClick={() => setFilter(f.id)}>
                {f.id !== "all" && <span className="dot" />}{f.label}
                <span className="count">{f.count}</span>
              </button>
            ))}
          </div>

          <section className="ms-card">
            <div className="ms-card-head"><h3>Axhenda e ditës</h3><span className="meta">{dayList.length} vizita</span></div>
            <div>
              {dayList.map((a, i) => (
                <button key={i} className={"ms-appt " + (a.state === "completed" || a.state === "noshow" ? "done " : "") + (a.state === "noshow" ? "noshow " : "") + (a.state === "next" ? "next" : "")} onClick={onOpenChart}>
                  <span className="time">{a.time}</span>
                  <span className="sd" style={a.state === "completed" ? { background: "var(--green)" } : a.state === "next" ? { background: "var(--primary)", boxShadow: "0 0 0 3px var(--primary-soft)" } : {}} />
                  <span style={{ minWidth: 0 }}>
                    <span className="nm">{a.name}<span className="age">{a.age}</span></span>
                    <span className="rs">{a.reason}</span>
                  </span>
                  {a.state === "completed" && <span className="chip chip-green"><span className="dot" />Kryer</span>}
                  {a.state === "noshow" && <span className="chip chip-amber"><span className="dot" />MS</span>}
                  {a.state === "next" && <span className="chip chip-teal"><span className="dot" />Tani</span>}
                </button>
              ))}
            </div>
          </section>

          <WalkinBand device={device} />
          <div style={{ height: 24 }} />
        </>
      )}
      </div>
      <button className="m-fab" onClick={onSchedule} aria-label="Cakto termin"><Icon d="plus" size={24} sw={2} /></button>
    </div>
  );
}

Object.assign(window, { ReceptionHome, WeekGrid, StatCards, WalkinBand });
