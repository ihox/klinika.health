// screens-visit.jsx — visit detail / new visit form with sticky save bar,
// payment bottom-sheet picker, ICD-10 chips, and the receptionist edit-lock.

function PaymentSheet({ open, value, onClose, onPick }) {
  return (
    <>
      <div className={"m-scrim" + (open ? " is-open" : "")} onClick={onClose} style={{ pointerEvents: open ? "auto" : "none" }} />
      <div className={"m-sheet" + (open ? " is-open" : "")} role="dialog" aria-label="Kategoria e pagesës">
        <div className="sheet-grip" />
        <div className="sheet-head"><h3>Kategoria e pagesës</h3>
          <button className="m-iconbtn" onClick={onClose} aria-label="Mbyll"><Icon d="close" /></button>
        </div>
        <div className="sheet-body">
          {PAYMENT_CODES.map(p => (
            <button key={p.code} className={"ms-payopt" + (value === p.code ? " is-active" : "")} onClick={() => { onPick(p.code); onClose(); }}>
              <span className="pcode">{p.code}</span>
              <span className="pinfo"><span className="l">{p.label}</span><span className="s">Kodi {p.code}</span></span>
              <span className="pamt">{p.amt}</span>
              {value === p.code && <span className="tick"><Icon d="M4 10l4 4 8-9" size={18} /></span>}
            </button>
          ))}
        </div>
      </div>
    </>
  );
}

function VisitForm({ device, role, isNew, onCloseNew }) {
  const f = VISIT_FORM;
  const isReception = role === "reception";
  const [pay, setPay] = React.useState(isNew ? "" : f.payment);
  const [paySheet, setPaySheet] = React.useState(false);
  const [food, setFood] = React.useState(isNew ? { gji: false, formule: false, solid: false } : f.food);
  const [saving, setSaving] = React.useState(false);
  const [dx, setDx] = React.useState(isNew ? [] : f.dx);
  const [showDxSuggest, setShowDxSuggest] = React.useState(false);
  const [ankesaErr, setAnkesaErr] = React.useState(false);
  const payInfo = PAYMENT_CODES.find(p => p.code === pay);

  const toggleFood = (k) => setFood(s => ({ ...s, [k]: !s[k] }));
  const removeDx = (code) => setDx(d => d.filter(x => x.code !== code));
  const addDx = (s) => { setDx(d => [...d, { code: s.code, label: s.desc, primary: d.length === 0 }]); setShowDxSuggest(false); };

  return (
    <>
      <div className="m-scroll">
        {isReception && (
          <div className="ms-locked">
            <span className="ic"><Icon d="M5 9V6.5a3 3 0 0 1 6 0V9 M3.5 9h9v6.5h-9z" size={18} /></span>
            <span><strong>Vetëm shikim.</strong> Mjeku duhet të shënojë statusin dhe të dhënat klinike. Recepsioni mund të menaxhojë terminin dhe pagesën.</span>
          </div>
        )}

        <div className="ms-vform">
          {/* 1. Vizita */}
          <div className="ms-vsection">
            <h4>Vizita</h4>
            <div className="ms-field">
              <label>Ankesa</label>
              <textarea className={ankesaErr ? "err" : ""} defaultValue={isNew ? "" : f.ankesa}
                        placeholder="Ankesa kryesore e pacientit" disabled={isReception}
                        onBlur={e => setAnkesaErr(isNew && !e.target.value.trim())} />
              {ankesaErr && <div className="err-msg"><Icon d="M10 6v5 M10 14h.01 M10 2l8 14H2z" size={14} />Ankesa është e detyrueshme.</div>}
            </div>
            <div className="ms-field">
              <label>Ushqimi</label>
              <div className="ms-foodchecks">
                {[["gji", "Gji"], ["formule", "Formulë"], ["solid", "Solid"]].map(([k, lab]) => (
                  <button key={k} type="button" className={"ms-foodcheck" + (food[k] ? " checked" : "")} onClick={() => !isReception && toggleFood(k)} disabled={isReception}>
                    <span className="box">{food[k] && <Icon d="M3 8l3 3 6-7" size={13} sw={2} />}</span>{lab}
                  </button>
                ))}
              </div>
            </div>
            <div className="ms-field">
              <label>Shenjat vitale</label>
              <div className="ms-vitals">
                {f.vitals.map((v, i) => (
                  <div className="ms-vital" key={i}>
                    <label>{v.label}</label>
                    <div className="wrap"><input defaultValue={isNew ? "" : v.value} disabled={isReception} inputMode="decimal" /><span className="unit">{v.unit}</span></div>
                    {!isNew && <span className={"pct" + (v.warn ? " warn" : "")}>{v.pct}</span>}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* 2. Ekzaminimi */}
          <div className="ms-vsection">
            <h4>Ekzaminimi</h4>
            <div className="ms-field"><label>Ekzaminime</label><textarea defaultValue={isNew ? "" : f.ekzaminime} disabled={isReception} placeholder="Gjetjet e ekzaminimit fizik" style={{ minHeight: 110 }} /></div>
            <div className="ms-field"><label>Ultrazëri <span style={{ color: "var(--text-faint)", fontWeight: 400 }}>· opsionale</span></label><textarea defaultValue="" disabled={isReception} placeholder="Gjetjet e ultrazërit, nëse ka..." /></div>
          </div>

          {/* 3. Diagnoza */}
          <div className="ms-vsection">
            <h4>Diagnoza <span className="opt">· ICD-10</span></h4>
            <div className="ms-dx-wrap" onClick={() => !isReception && setShowDxSuggest(true)}>
              {dx.map(d => (
                <span key={d.code} className={"ms-dx-chip" + (d.primary ? " primary" : "")}>
                  <span className="code">{d.code}</span>{d.label}
                  {!isReception && <span className="x" onClick={(e) => { e.stopPropagation(); removeDx(d.code); }}><Icon d="close" size={12} /></span>}
                </span>
              ))}
              {!isReception && <input placeholder={dx.length ? "Shto tjetër..." : "Kërko ICD-10 (kod ose përshkrim)"} onFocus={() => setShowDxSuggest(true)} />}
            </div>
            {showDxSuggest && !isReception && (
              <div className="ms-dx-suggest">
                {ICD_SUGGEST.filter(s => !dx.find(d => d.code === s.code)).map(s => (
                  <button key={s.code} className="opt" onClick={() => addDx(s)} style={{ width: "100%", textAlign: "left" }}>
                    <span className="code">{s.code}</span><span className="desc">{s.desc}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* 4. Terapia */}
          <div className="ms-vsection">
            <h4>Terapia</h4>
            <div className="ms-field"><textarea className="mono" defaultValue={isNew ? "" : f.terapia} disabled={isReception} placeholder="Barnat, dozat, udhëzimet" style={{ minHeight: 120 }} /></div>
            {!isReception && !isNew && (
              <div className="ms-locked" style={{ margin: "10px 0 0", background: "var(--amber-bg)", borderColor: "var(--amber-soft)", color: "#78350F" }}>
                <span className="ic" style={{ color: "var(--amber)" }}><Icon d="M10 2l8 14H2z M10 7v4 M10 14h.01" size={16} /></span>
                <span><strong>Alergji:</strong> {PATIENT.allergy}. Verifiko para përshkrimit.</span>
              </div>
            )}
          </div>

          {/* 5. Plani */}
          <div className="ms-vsection">
            <h4>Plani</h4>
            <div className="ms-field"><label>Analizat</label><textarea defaultValue="" disabled={isReception} placeholder="Asnjë analizë e kërkuar" style={{ minHeight: 60 }} /></div>
            <div className="ms-field"><label>Kontrolla</label><textarea defaultValue={isNew ? "" : f.kontrolla} disabled={isReception} style={{ minHeight: 60 }} /></div>
            <div className="ms-field"><label>Tjera <span style={{ color: "var(--text-faint)", fontWeight: 400 }}>· opsionale</span></label><textarea defaultValue={isNew ? "" : f.tjera} disabled={isReception} style={{ minHeight: 60 }} /></div>
          </div>

          {/* 6. Pagesa — reception CAN edit this */}
          <div className="ms-vsection">
            <h4>Pagesa</h4>
            <button className="ms-payrow" onClick={() => setPaySheet(true)} style={{ width: "100%" }}>
              {payInfo ? (
                <span className="pv">
                  <span className="pcode">{payInfo.code}</span>
                  <span className="ptext"><span className="l">{payInfo.label}</span><span className="s">Kategoria {payInfo.code}</span></span>
                </span>
              ) : (
                <span className="pv"><span className="pcode" style={{ background: "var(--bg-subtle)", color: "var(--text-faint)", border: "1px solid var(--border)" }}>?</span><span className="ptext"><span className="l" style={{ color: "var(--text-faint)" }}>Zgjedh kategorinë</span></span></span>
              )}
              <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
                {payInfo && <span className="pamt">{payInfo.amt}</span>}
                <Icon d="chevright" size={16} style={{ color: "var(--text-faint)" }} />
              </span>
            </button>
          </div>

          <div style={{ height: 8 }} />
        </div>
      </div>

      {/* Sticky save bar — doctor only; reception sees a lighter "done" bar */}
      <div className="ms-savebar">
        {isReception ? (
          <>
            <span className="autosave"><span className="dot" />Pagesa ruhet automatikisht</span>
            <button className="btn btn-secondary" onClick={isNew ? onCloseNew : undefined}>Mbyll</button>
          </>
        ) : (
          <>
            <span className={"autosave" + (saving ? " saving" : "")}>
              <span className="dot" />{saving ? "Po ruhet…" : isNew ? "Draft i paruajtur" : "Ruajtur 14:18"}
            </span>
            {isNew && <button className="btn btn-ghost" onClick={onCloseNew}>Anulo</button>}
            <button className="btn btn-primary" onClick={() => { setSaving(true); setTimeout(() => setSaving(false), 1100); }}>
              {isNew ? "Ruaj vizitën" : "Përfundo vizitën"}
            </button>
          </>
        )}
      </div>

      <PaymentSheet open={paySheet} value={pay} onClose={() => setPaySheet(false)} onPick={setPay} />
    </>
  );
}

Object.assign(window, { VisitForm, PaymentSheet });
