// screens-growth.jsx — WHO growth sparkline cards + fullscreen growth lightbox.
// Pure SVG generated from WHO fixtures; sex-tinted patient series (pink/blue).

// Build an SVG path from [x,y] pixel points.
function linePath(pts) {
  return pts.map((p, i) => (i === 0 ? "M" : "L") + p[0].toFixed(1) + " " + p[1].toFixed(1)).join(" ");
}

// Map data → pixel space for a given metric.
function makeScales(metric, w, h, pad) {
  const xMax = 36;
  const sx = (m) => pad.l + (m / xMax) * (w - pad.l - pad.r);
  const sy = (v) => h - pad.b - ((v - metric.yMin) / (metric.yMax - metric.yMin)) * (h - pad.t - pad.b);
  return { sx, sy };
}

// Sparkline (compact, no axes) for the chart cards.
function GrowthSparkline({ type, sex }) {
  const m = WHO[type];
  const W = 320, H = 110, pad = { l: 4, r: 24, t: 8, b: 6 };
  const { sx, sy } = makeScales(m, W, H, pad);
  const band = (lo, hi) => {
    const top = WHO_AGES.map((a, i) => [sx(a), sy(hi[i])]);
    const bot = WHO_AGES.map((a, i) => [sx(a), sy(lo[i])]).reverse();
    return linePath([...top, ...bot]) + " Z";
  };
  const curve = (arr) => linePath(WHO_AGES.map((a, i) => [sx(a), sy(arr[i])]));
  const ptsPx = m.pts.map(([a, v]) => [sx(a), sy(v)]);
  return (
    <svg className="gc-svg" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
      <path className="gx-band-outer" d={band(m.p3, m.p97)} />
      <path className="gx-band-mid" d={band(m.p15, m.p85)} />
      <path className="gx-curve outer" d={curve(m.p97)} />
      <path className="gx-curve median" d={curve(m.p50)} />
      <path className="gx-curve outer" d={curve(m.p3)} />
      <path className={"gx-patient-line" + (sex === "m" ? " m" : "")} d={linePath(ptsPx)} />
      {ptsPx.map((p, i) => (
        <circle key={i} className={"gx-patient-pt" + (i === ptsPx.length - 1 ? " current" : "") + (sex === "m" ? " m" : "")}
                cx={p[0]} cy={p[1]} r={i === ptsPx.length - 1 ? 3.6 : 2.4} />
      ))}
    </svg>
  );
}

// Full chart with axes + labels for the lightbox.
function GrowthChartFull({ type, sex }) {
  const m = WHO[type];
  const W = 560, H = 380, pad = { l: 40, r: 40, t: 18, b: 34 };
  const { sx, sy } = makeScales(m, W, H, pad);
  const band = (lo, hi) => {
    const top = WHO_AGES.map((a, i) => [sx(a), sy(hi[i])]);
    const bot = WHO_AGES.map((a, i) => [sx(a), sy(lo[i])]).reverse();
    return linePath([...top, ...bot]) + " Z";
  };
  const curve = (arr) => linePath(WHO_AGES.map((a, i) => [sx(a), sy(arr[i])]));
  const ptsPx = m.pts.map(([a, v]) => [sx(a), sy(v)]);
  const yTicks = [];
  for (let v = m.yMin; v <= m.yMax; v += m.yStep) yTicks.push(v);
  return (
    <svg className="glb-chart" viewBox={`0 0 ${W} ${H}`}>
      {/* grid + y axis */}
      {yTicks.map((v, i) => (
        <g key={i}>
          <line className="gx-grid" x1={pad.l} y1={sy(v)} x2={W - pad.r} y2={sy(v)} />
          <text className="gx-axis-text" x={pad.l - 6} y={sy(v) + 3} textAnchor="end">{v}</text>
        </g>
      ))}
      {/* x axis ticks (months) */}
      {WHO_AGES.map((a, i) => (
        <text key={i} className="gx-axis-text" x={sx(a)} y={H - pad.b + 16} textAnchor="middle">{a}</text>
      ))}
      <text className="gx-axis-text" x={(pad.l + W - pad.r) / 2} y={H - 4} textAnchor="middle" style={{ letterSpacing: "0.08em" }}>MUAJ</text>
      <line className="gx-axis" x1={pad.l} y1={pad.t} x2={pad.l} y2={H - pad.b} />
      {/* bands + curves */}
      <path className="gx-band-outer" d={band(m.p3, m.p97)} />
      <path className="gx-band-mid" d={band(m.p15, m.p85)} />
      <path className="gx-curve outer" d={curve(m.p97)} />
      <path className="gx-curve inner" d={curve(m.p85)} />
      <path className="gx-curve median" d={curve(m.p50)} />
      <path className="gx-curve inner" d={curve(m.p15)} />
      <path className="gx-curve outer" d={curve(m.p3)} />
      {/* percentile labels at right edge */}
      {[["P97", m.p97], ["P50", m.p50], ["P3", m.p3]].map(([lab, arr], i) => (
        <text key={i} className="gx-pct-label" x={W - pad.r + 4} y={sy(arr[arr.length - 1]) + 3}>{lab}</text>
      ))}
      {/* patient series */}
      <path className={"gx-patient-line" + (sex === "m" ? " m" : "")} d={linePath(ptsPx)} />
      {ptsPx.map((p, i) => (
        <circle key={i} className={"gx-patient-pt" + (i === ptsPx.length - 1 ? " current" : "") + (sex === "m" ? " m" : "")}
                cx={p[0]} cy={p[1]} r={i === ptsPx.length - 1 ? 5 : 3.4} />
      ))}
    </svg>
  );
}

// Growth tab content (3 sparkline cards).
function GrowthTab({ device, sex, onOpen }) {
  const order = ["weight", "length", "hc"];
  return (
    <div className="ms-growth-grid">
      {order.map((type) => {
        const m = WHO[type];
        const last = m.pts[m.pts.length - 1];
        const warn = m.cur !== "P50" && type === "hc" ? false : false;
        return (
          <button className="ms-gcard" key={type} onClick={() => onOpen(type)}>
            <div className="gc-head">
              <span className="t">{m.title}</span>
              <span className="pct">{m.cur}</span>
            </div>
            <GrowthSparkline type={type} sex={sex} />
            <div className="gc-foot">
              <span className="v">{last[1]}<span className="u">{m.unit}</span></span>
              <span className="lbl">në {last[0]} muaj · {m.cur}</span>
            </div>
          </button>
        );
      })}
    </div>
  );
}

// Fullscreen growth lightbox with metric tabs + data table.
function GrowthLightbox({ open, type, sex, onClose }) {
  const [tab, setTab] = React.useState(type || "weight");
  React.useEffect(() => { if (type) setTab(type); }, [type]);
  const m = WHO[tab];
  const last = m.pts[m.pts.length - 1];
  const tabs = [["weight", "Pesha"], ["length", "Gjatësia"], ["hc", "Perim. kokës"]];
  // Build per-measurement percentile guess for the table.
  const rows = m.pts.map(([a, v], i) => ({ age: a, val: v, pct: i === m.pts.length - 1 ? m.cur : "P50", current: i === m.pts.length - 1 }));
  return (
    <div className={"ms-growth-lb" + (open ? " is-open" : "")} role="dialog" aria-label="Diagrami i rritjes">
      <div className="glb-head">
        <button className="m-iconbtn" onClick={onClose} aria-label="Mbyll"><Icon d="chevdown" /></button>
        <span className="t">Diagramet e rritjes · WHO</span>
        <button className="m-iconbtn" aria-label="Printo"><Icon d="report" /></button>
      </div>
      <div className="glb-tabs">
        {tabs.map(([id, lab]) => (
          <button key={id} className={tab === id ? "is-active" : ""} onClick={() => setTab(id)}>{lab}</button>
        ))}
      </div>
      <div className="glb-body">
        <div className="glb-current">
          <div>
            <div className="v">{last[1]}<span className="u">{m.unit}</span></div>
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>Matja e fundit · {last[0]} muaj</div>
          </div>
          <span className="pct">{m.cur} · {PATIENT.sexLabel}</span>
        </div>
        <div className="glb-chartwrap">
          <GrowthChartFull type={tab} sex={sex} />
        </div>
        <div className="glb-table">
          <div className="row header"><span>Mosha</span><span>{m.unit}</span><span>Perc.</span></div>
          {rows.map((r, i) => (
            <div key={i} className={"row" + (r.current ? " current" : "")}>
              <span className="date">{r.age} muaj</span>
              <span className="val">{r.val}</span>
              <span className="pct">{r.pct}</span>
            </div>
          ))}
        </div>
        <div style={{ padding: "0 var(--m-gutter) 24px", fontSize: 11, color: "var(--text-faint)", fontFamily: "var(--font-mono)" }}>
          Burimi: WHO Child Growth Standards · 0–36 muaj · {PATIENT.sexLabel.toLowerCase()}
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { GrowthSparkline, GrowthChartFull, GrowthTab, GrowthLightbox });
