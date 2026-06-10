// screens-dicom.jsx — DICOM (ultrasound) picker + fullscreen lightbox.

// Ultrasound image placeholder (dark scan-cone; no real DICOM data).
function UsImage({ caption, lg }) {
  return (
    <div className={"us-img" + (lg ? " lg" : "")}>
      {caption && <span className="us-cap">{caption}</span>}
    </div>
  );
}

const DICOM_FILTERS = [
  { id: "all", cls: "fp-all", label: "Të gjitha" },
  { id: "today", cls: "fp-scheduled", label: "Sot" },
  { id: "older", cls: "fp-completed", label: "Më herët" },
  { id: "unlinked", cls: "fp-noshow", label: "Të palidhura" },
];

function StudyCard({ study, onOpen, onLink }) {
  const thumbs = Array.from({ length: Math.min(study.images, 4) });
  return (
    <div className={"ms-study" + (study.linked ? "" : " unlinked")}>
      <button className="st-head" onClick={() => onOpen(study, 0)} style={{ width: "100%" }}>
        <span className="l">
          <span className="modality">{study.modality}</span>
          <span className="title">{study.label}</span>
        </span>
        <span className="date">{study.date}</span>
      </button>
      <div className="st-thumbs">
        {thumbs.map((_, i) => (
          <button key={i} onClick={() => onOpen(study, i)} style={{ display: "block", border: "none", padding: 0, background: "none" }}>
            <UsImage caption={i === 3 && study.images > 4 ? `+${study.images - 3}` : null} />
          </button>
        ))}
      </div>
      <div className="st-foot">
        {study.linked ? (
          <span className="linkinfo">
            <Icon d="M7 10a3 3 0 0 1 3-3h1 M13 10a3 3 0 0 1-3 3H9 M8 10h4" size={15} />
            E lidhur me vizitën {study.visit}
          </span>
        ) : (
          <span className="linkinfo unlinked">
            <span className="dot" style={{ width: 7, height: 7, borderRadius: 999, background: "var(--accent-500)", display: "inline-block" }} />
            E re · pa vizitë
          </span>
        )}
        {study.linked
          ? <span style={{ fontSize: 12, color: "var(--text-faint)" }}>{study.images} imazhe</span>
          : <button className="btn btn-secondary btn-sm" onClick={() => onLink(study)} style={{ minHeight: 36 }}>Lidh me vizitën</button>}
      </div>
    </div>
  );
}

function DicomTab({ device, onOpenLightbox, onLink }) {
  const [filter, setFilter] = React.useState("all");
  const unlinkedCount = DICOM_STUDIES.filter(s => !s.linked).length;
  const list = DICOM_STUDIES.filter(s => {
    if (filter === "all") return true;
    if (filter === "unlinked") return !s.linked;
    return s.group === filter;
  });
  return (
    <div className="m-scroll">
      {unlinkedCount > 0 && (
        <div className="ms-locked" style={{ background: "var(--primary-tint)", borderColor: "var(--teal-200)", color: "var(--teal-900)" }}>
          <span className="ic" style={{ color: "var(--primary)" }}><Icon d="M10 3a4 4 0 0 0-4 4c0 4-1.5 5-1.5 5h11s-1.5-1-1.5-5a4 4 0 0 0-4-4 M8.5 16a1.7 1.7 0 0 0 3 0" size={18} /></span>
          <span><strong>{unlinkedCount} studim i ri</strong> nga aparati i ultrazërit nuk është i lidhur me asnjë vizitë. Lidhe për ta shfaqur në kartelë.</span>
        </div>
      )}
      <div className="ms-dicom-filters">
        {DICOM_FILTERS.map(f => (
          <button key={f.id} className={"filter-pill " + f.cls + (filter === f.id ? " is-active" : "")} onClick={() => setFilter(f.id)}>
            {f.id !== "all" && <span className="dot" />}{f.label}
            {f.id === "unlinked" && unlinkedCount > 0 && <span className="count">{unlinkedCount}</span>}
          </button>
        ))}
      </div>
      <div className="ms-dicom-grid">
        {list.map(s => <StudyCard key={s.id} study={s} onOpen={onOpenLightbox} onLink={onLink} />)}
      </div>
      {list.length === 0 && (
        <div className="ms-empty"><span className="ico"><Icon d="M3 5h14v10H3z M3 11l4-3 3 2 4-4 3 3" size={24} /></span><span className="t">Asnjë studim</span><span className="d">Nuk ka ekografi për këtë filtër.</span></div>
      )}
      <div style={{ height: 24 }} />
    </div>
  );
}

// Fullscreen lightbox with swipe between images + metadata toggle.
function DicomLightbox({ open, study, startIndex, onClose, onLink }) {
  const [idx, setIdx] = React.useState(startIndex || 0);
  const [showMeta, setShowMeta] = React.useState(false);
  const startX = React.useRef(null);
  const [dragX, setDragX] = React.useState(0);
  React.useEffect(() => { setIdx(startIndex || 0); setShowMeta(false); }, [startIndex, study]);
  if (!study) return <div className={"ms-lightbox"} aria-hidden="true" />;
  const n = study.images;
  const onStart = (e) => { startX.current = (e.touches ? e.touches[0].clientX : e.clientX); };
  const onMove = (e) => { if (startX.current == null) return; setDragX((e.touches ? e.touches[0].clientX : e.clientX) - startX.current); };
  const onEnd = () => {
    if (dragX < -60 && idx < n - 1) setIdx(idx + 1);
    else if (dragX > 60 && idx > 0) setIdx(idx - 1);
    setDragX(0); startX.current = null;
  };
  return (
    <div className={"ms-lightbox" + (open ? " is-open" : "")} role="dialog" aria-label="Imazhi i ultrazërit">
      <div className="ms-lb-top">
        <div className="lb-meta">
          <div className="t">{study.label}</div>
          <div className="s">{study.modality} · {study.date} · {idx + 1}/{n}</div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="ms-lb-btn" onClick={() => setShowMeta(v => !v)} aria-label="Të dhënat"><Icon d="M10 17a7 7 0 1 0 0-14 7 7 0 0 0 0 14 M10 9v4 M10 6.5h.01" /></button>
          <button className="ms-lb-btn" onClick={onClose} aria-label="Mbyll"><Icon d="close" /></button>
        </div>
      </div>

      <div className="ms-lb-stage"
           onMouseDown={onStart} onMouseMove={onMove} onMouseUp={onEnd} onMouseLeave={() => { if (startX.current != null) onEnd(); }}
           onTouchStart={onStart} onTouchMove={onMove} onTouchEnd={onEnd}>
        <div className="ms-lb-track" style={{ transform: `translateX(calc(${-idx * 100}% + ${dragX}px))`, transition: dragX ? "none" : undefined }}>
          {Array.from({ length: n }).map((_, i) => (
            <div className="slide" key={i}>
              <UsImage lg caption={`KLINIKA · US · ${study.date} · IM-${String(i + 1).padStart(2, "0")}`} />
              {i === idx && (
                <div className="ms-lb-zoomhint">
                  <Icon d="M7 7m-5 0a5 5 0 1 0 10 0a5 5 0 1 0 -10 0 M11 11l3 3 M7 5v4 M5 7h4" size={22} />
                  Pinçoni për zmadhim
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {showMeta && (
        <div className="ms-lb-meta-overlay">
          <div><span className="k">PACIENTI</span> {PATIENT.name}</div>
          <div><span className="k">STUDIM</span> {study.label}</div>
          <div><span className="k">DATA</span> {study.date}</div>
          <div><span className="k">MODALITETI</span> Ultrazë (US)</div>
          <div><span className="k">IMAZHE</span> {n}</div>
          <div><span className="k">LIDHJA</span> {study.linked ? `Vizita ${study.visit}` : "E palidhur"}</div>
        </div>
      )}

      <div className="ms-lb-bottom">
        <div className="ms-lb-dots">
          {Array.from({ length: n }).map((_, i) => <i key={i} className={i === idx ? "on" : ""} />)}
        </div>
        <div className="ms-lb-actions">
          {!study.linked && <button className="btn btn-glass" onClick={() => onLink(study)}><Icon d="M7 10a3 3 0 0 1 3-3h1 M13 10a3 3 0 0 1-3 3H9 M8 10h4" size={16} style={{ marginRight: 6 }} />Lidh me vizitën</button>}
          <button className="btn btn-glass" style={{ flex: study.linked ? 1 : "0 0 auto" }}><Icon d="M10 3v9 M6.5 8.5L10 12l3.5-3.5 M4 15h12" size={16} style={{ marginRight: 6 }} />Shkarko</button>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { UsImage, DicomTab, DicomLightbox, StudyCard });
