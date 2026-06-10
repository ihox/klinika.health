// screens-raporti.jsx — Raporti i ditës (daily report) for mobile/tablet.
// Three tiles (revenue first/biggest on phone), filter pills, visits as a
// card list (phone) or table (tablet), date arrows + Sot, print preview.

function RaportiScreen({ device, role, emptyState }) {
  const isReception = role === "reception";
  const [filter, setFilter] = React.useState("all");
  const isTablet = device !== "phone";

  const visits = emptyState ? [] : REPORT_VISITS;
  const totals = computeReport(visits);
  const order = ["completed", "no_show", "scheduled"];

  const FILTERS = [
    { id: "all", cls: "fp-all", label: "Të gjitha", count: totals.count },
    { id: "completed", cls: "fp-completed", label: "Kryer", count: totals.byStatus.completed || 0 },
    { id: "no_show", cls: "fp-noshow", label: "Mungesa", count: totals.byStatus.no_show || 0 },
    { id: "scheduled", cls: "fp-scheduled", label: "Planifikuara", count: totals.byStatus.scheduled || 0 },
  ];
  const rows = filter === "all" ? visits : visits.filter(v => v.status === filter);
  const filteredRevenue = rows.reduce((s, v) => s + (v.price || 0), 0);

  if (emptyState) {
    return (
      <div className="m-scroll">
        <div className="ms-rp-date">
          <button className="dnav"><Icon d="chevleft" size={18} /></button>
          <span className="lbl"><span className="d">E diel, 18 maj 2026</span></span>
          <button className="dnav"><Icon d="chevright" size={18} /></button>
        </div>
        <div className="ms-empty" style={{ paddingTop: 56 }}>
          <span className="ico"><Icon d="report" size={26} /></span>
          <span className="t">Asnjë vizitë</span>
          <span className="d">Klinika ishte e mbyllur këtë ditë. Zgjedh një ditë tjetër për të parë raportin.</span>
        </div>
      </div>
    );
  }

  return (
    <div className="m-app" style={{ flex: 1 }}>
      <div className="m-scroll">
        {/* Date nav */}
        <div className="ms-rp-date">
          <button className="dnav" aria-label="Dita e mëparshme"><Icon d="chevleft" size={18} /></button>
          <span className="lbl">
            <span className="d">E martë, 14 maj 2026 {!isReception ? <span className="today-pill">Sot</span> : <span className="today-pill">Sot</span>}</span>
          </span>
          <button className="dnav" aria-label="Dita tjetër" disabled={isReception}><Icon d="chevright" size={18} /></button>
        </div>

        {isReception && (
          <div className="ms-locked" style={{ marginTop: 0 }}>
            <span className="ic"><Icon d="M10 17a7 7 0 1 0 0-14 7 7 0 0 0 0 14 M10 9v4 M10 6.5h.01" size={18} /></span>
            <span>Recepsioni sheh raportin vetëm për <strong>sot dhe dje</strong>.</span>
          </div>
        )}

        {/* Three tiles */}
        <div className="ms-rp-tiles">
          <div className="ms-rp-tile revenue">
            <div className="lab">Të ardhura totale</div>
            <div className="v-big">{totals.revenue}<span className="unit">€</span></div>
            <div className="foot">
              {totals.codeBreakdown.map((b, i) => (
                <span key={b.code}>{i > 0 && <span className="sep">·</span>} <strong>{b.code}</strong>×{b.n}</span>
              ))}
            </div>
          </div>
          <div className="ms-rp-tile">
            <div className="lab">Numri i vizitave</div>
            <div className="v-med">{totals.count}</div>
            <div className="foot"><strong>{totals.byStatus.completed || 0}</strong> të përfunduara <span className="sep">·</span> <strong>{(totals.byStatus.no_show || 0) + (totals.byStatus.scheduled || 0)}</strong> të tjera</div>
          </div>
          <div className="ms-rp-tile status ms-rp-status">
            <div className="lab">Statusi i vizitave</div>
            <div className="bar">
              {order.map(k => {
                const v = totals.byStatus[k] || 0;
                if (!v) return null;
                return <span key={k} className="seg" style={{ width: (v / totals.count) * 100 + "%", background: RP_STATUS[k].solid }} />;
              })}
            </div>
            <div className="legend">
              {order.map(k => (
                <div className="item" key={k}>
                  <span className="sw" style={{ background: RP_STATUS[k].solid }} />
                  <span className="n">{totals.byStatus[k] || 0}</span>
                  <span className="ll">{RP_STATUS[k].label.toLowerCase()}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Filter pills */}
        <div className="ms-pills" style={{ paddingTop: 16 }}>
          {FILTERS.map(f => (
            <button key={f.id} className={"filter-pill " + f.cls + (filter === f.id ? " is-active" : "")} onClick={() => setFilter(f.id)}>
              {f.id !== "all" && <span className="dot" />}{f.label}<span className="count">{f.count}</span>
            </button>
          ))}
        </div>

        {/* Visits — card list (phone) or table (tablet) */}
        <section className="ms-card">
          <div className="ms-card-head">
            <h3>Vizitat {filter !== "all" && <span style={{ color: "var(--text-faint)", fontWeight: 400 }}>· {FILTERS.find(f => f.id === filter).label.toLowerCase()}</span>}</h3>
            <span className="meta">{rows.length} rreshta · {filteredRevenue} €</span>
          </div>

          {isTablet ? (
            <table className="ms-rp-table">
              <thead>
                <tr><th>Ora</th><th>Pacienti</th><th>Statusi</th><th>Kodi</th><th className="right">Pagesa</th></tr>
              </thead>
              <tbody>
                {rows.map((v, i) => (
                  <tr key={i}>
                    <td className="t">{v.t}</td>
                    <td><span className="nm">{v.name}<span className="age">{v.age}</span></span>{v.note && <div style={{ fontSize: 11, color: "var(--text-faint)", fontStyle: "italic" }}>{v.note}</div>}</td>
                    <td><span className={"chip " + RP_STATUS[v.status].cls}><span className="dot" />{RP_STATUS[v.status].singular}</span></td>
                    <td>{v.code ? <span className="code-badge">{v.code}</span> : <span style={{ color: "var(--text-faint)" }}>—</span>}</td>
                    <td className="right pay">{v.price == null ? <span style={{ color: "var(--text-faint)" }}>—</span> : v.price === 0 ? <span style={{ color: "var(--text-faint)", fontStyle: "italic" }}>Falas</span> : <>{v.price}<span style={{ color: "var(--text-muted)", fontSize: 11, marginLeft: 1 }}>€</span></>}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr><td colSpan="4">Totali · {FILTERS.find(f => f.id === filter).label.toLowerCase()}</td><td className="right sum">{filteredRevenue} €</td></tr>
              </tfoot>
            </table>
          ) : (
            <div className="ms-rp-list">
              {rows.map((v, i) => (
                <div className="ms-rp-vcard" key={i}>
                  <span className="t">{v.t}</span>
                  <span style={{ minWidth: 0 }}>
                    <span className="nm">{v.name}<span className="age">{v.age}</span></span>
                    <span className="meta">
                      <span className={"chip " + RP_STATUS[v.status].cls}><span className="dot" />{RP_STATUS[v.status].singular}</span>
                      {v.note && <span className="note">{v.note}</span>}
                    </span>
                  </span>
                  <span className={"pay" + (v.price == null ? " none" : v.price === 0 ? " free" : "")}>
                    {v.price == null ? "—" : v.price === 0 ? "Falas" : <>{v.code && <span className="code">{v.code}</span>}{v.price} €</>}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>
        <div style={{ height: 20 }} />
      </div>
    </div>
  );
}

Object.assign(window, { RaportiScreen });
