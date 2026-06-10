// screens-error.jsx — error / offline pages + DICOM link-to-visit bottom sheet.

function ErrorPage({ kind, onHome, onRetry }) {
  const e = ERRORS[kind] || ERRORS[404];
  return (
    <div className="m-app" style={{ flex: 1 }}>
      <div className="ms-errpage">
        <span className="ico"><Icon d={e.icon} size={32} /></span>
        {e.code && <span className="code">GABIM {e.code}</span>}
        <span className="t">{e.title}</span>
        <span className="d">{e.desc}</span>
        <div className="acts">
          <button className="btn btn-primary" onClick={e.primary.includes("përsëri") ? onRetry : onHome}>{e.primary}</button>
          {e.secondary && <button className="btn btn-secondary" onClick={onHome}>{e.secondary}</button>}
        </div>
      </div>
    </div>
  );
}

// DICOM link-to-visit bottom sheet.
// Shows the DICOM patient name (verification), a mismatch warning when it
// differs from the current chart, recent visits (last 30 days), and a
// "leave unlinked" escape. Multi-study note included.
function DicomLinkSheet({ open, study, onClose, onLinked }) {
  const [linkedId, setLinkedId] = React.useState(null);
  React.useEffect(() => { if (open) setLinkedId(null); }, [open, study]);
  if (!study) return null;

  // Simulate a DICOM patient_name that matches the current chart.
  const dicomName = PATIENT.name;
  const mismatch = false; // toggle-able demo; matches current chart

  return (
    <>
      <div className={"m-scrim" + (open ? " is-open" : "")} onClick={onClose} style={{ pointerEvents: open ? "auto" : "none" }} />
      <div className={"m-sheet" + (open ? " is-open" : "")} role="dialog" aria-label="Lidh studimin me vizitën" style={{ maxHeight: "86%" }}>
        <div className="sheet-grip" />
        <div className="sheet-head">
          <h3>Lidh me vizitën</h3>
          <button className="m-iconbtn" onClick={onClose} aria-label="Mbyll"><Icon d="close" /></button>
        </div>

        {/* Verification header — DICOM patient name */}
        <div className={"ms-link-verify" + (mismatch ? " warn" : "")}>
          <span className="ic"><Icon d={mismatch ? "M10 2l8 14H2z M10 7v4 M10 14h.01" : "M10 17a7 7 0 1 0 0-14 7 7 0 0 0 0 14 M6.5 10l2.5 2.5 4.5-5"} size={18} /></span>
          <span className="lv">
            <span className="k">Pacienti nga aparati</span>
            <span className="v">{dicomName}</span>
          </span>
          <span className="chip chip-neutral">{study.modality} · {study.images} imazhe</span>
        </div>
        {mismatch && (
          <div className="ms-link-mismatch">
            <Icon d="M10 2l8 14H2z M10 7v4 M10 14h.01" size={15} style={{ flexShrink: 0, marginTop: 1, color: "var(--amber)" }} />
            <span>Emri nga aparati nuk përputhet me kartelën aktuale (<strong>{PATIENT.name}</strong>). Verifiko para se ta lidhësh.</span>
          </div>
        )}

        <div className="sheet-body">
          <div className="ms-search-recent" style={{ paddingTop: 10 }}>Vizitat e fundit · 30 ditët e fundit</div>
          {LINK_VISITS.map(v => (
            <div className="ms-link-visit" key={v.id}>
              <span className="lvd">
                <span className="date">{v.date}{v.today && " · sot"} · {v.time}</span>
                <span className="sub">
                  {v.status === "in-progress" ? <span className="chip chip-teal"><span className="dot" />Në vijim</span> : <span className="chip chip-green"><span className="dot" />Kryer</span>}
                  <span className="pay">Kodi {v.pay}</span>
                </span>
              </span>
              {linkedId === v.id
                ? <span className="chip chip-green"><span className="dot" />E lidhur</span>
                : <button className="btn btn-secondary btn-sm" style={{ minHeight: 38 }} onClick={() => { setLinkedId(v.id); setTimeout(() => onLinked && onLinked(v), 600); }}>Lidh me këtë</button>}
            </div>
          ))}

          {study.images > 1 && (
            <div style={{ padding: "12px 16px", fontSize: 12, color: "var(--text-muted)", display: "flex", gap: 8, alignItems: "flex-start" }}>
              <Icon d="M10 17a7 7 0 1 0 0-14 7 7 0 0 0 0 14 M10 9v4 M10 6.5h.01" size={15} style={{ flexShrink: 0, marginTop: 1, color: "var(--text-faint)" }} />
              <span>Të {study.images} imazhet e këtij studimi lidhen bashkë me vizitën e zgjedhur.</span>
            </div>
          )}

          <div style={{ padding: "8px 16px 4px" }}>
            <button className="btn btn-ghost" style={{ width: "100%", minHeight: 44, color: "var(--text-muted)" }} onClick={onClose}>Lëre i palidhur</button>
          </div>
        </div>
      </div>
    </>
  );
}

Object.assign(window, { ErrorPage, DicomLinkSheet });
