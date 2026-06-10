// screens-settings.jsx — Cilësimet (clinic admin) with horizontal-scroll tab
// row, working hours, payment codes, email toggles, audit, and a user-
// management sub-view (grouped list + add/edit user form).

function Toggle({ on, onClick }) {
  return <button className={"ms-switch" + (on ? " on" : "")} onClick={onClick} role="switch" aria-checked={on}><i /></button>;
}

function SettingsScreen({ device }) {
  const [tab, setTab] = React.useState("general");
  const [userView, setUserView] = React.useState(null); // null | "add" | user object
  const [hours, setHours] = React.useState(HOURS);
  const [emailToggles, setEmailToggles] = React.useState({ confirm: true, reminder: true, reset: true });

  const toggleDay = (iso) => setHours(h => h.map(d => d.iso === iso ? { ...d, open: !d.open } : d));

  // User add/edit sub-view (full-screen takeover)
  if (tab === "users" && userView) {
    return <UserForm device={device} user={userView === "add" ? null : userView} onBack={() => setUserView(null)} />;
  }

  return (
    <div className="m-app" style={{ flex: 1 }}>
      <div className="ms-settabs">
        {SETTINGS_TABS.map(t => (
          <button key={t.id} className={"ms-settab" + (tab === t.id ? " is-active" : "")} onClick={() => setTab(t.id)}>
            {t.label}{t.count != null && <span className="count">{t.count}</span>}
          </button>
        ))}
      </div>

      <div className="m-scroll">
        {tab === "general" && (
          <div className="ms-set-pane">
            <h2>Përgjithshme</h2>
            <div className="pane-sub">Informacionet bazë të klinikës që shfaqen në dokumente dhe në ndërfaqe.</div>
            <div className="ms-set-card">
              <div className="head"><h3>Identiteti i klinikës</h3></div>
              <div className="body">
                <div className="ms-set-field"><label>Emri i klinikës</label><input defaultValue="DonetaMED" /></div>
                <div className="ms-set-field"><label>Qyteti</label><input defaultValue="Prizren" /></div>
                <div className="ms-set-grid2">
                  <div className="ms-set-field"><label>Telefoni</label><input defaultValue="+383 29 244 100" inputMode="tel" /></div>
                  <div className="ms-set-field"><label>Email</label><input defaultValue="info@donetamed.com" inputMode="email" /></div>
                </div>
                <div className="ms-set-field"><label>Adresa</label><input defaultValue="rr. Rilindja Kombëtare, Prizren" /></div>
              </div>
            </div>
          </div>
        )}

        {tab === "hours" && (
          <div className="ms-set-pane">
            <h2>Orari dhe terminet</h2>
            <div className="pane-sub">Orari i punës për çdo ditë. Këto cilësime drejtojnë kalendarin e recepsionit dhe dialogun e caktimit.</div>
            <div className="ms-set-card">
              <div className="head"><h3>Orari i punës</h3><div className="desc">Një interval hapje–mbyllje për çdo ditë.</div></div>
              <div>
                {hours.map(d => (
                  <div className={"ms-hours-row" + (d.open ? "" : " closed")} key={d.iso}>
                    <span className="day">{d.day}</span>
                    {d.open ? (
                      <span className="times"><input defaultValue={d.from} /><span className="dash">—</span><input defaultValue={d.to} /></span>
                    ) : (
                      <span className="times">E mbyllur</span>
                    )}
                    <Toggle on={d.open} onClick={() => toggleDay(d.iso)} />
                  </div>
                ))}
              </div>
            </div>
            <div className="ms-set-card">
              <div className="head"><h3>Kohëzgjatjet e termineve</h3></div>
              <div className="body">
                <div className="ms-set-grid2">
                  <div className="ms-set-field"><label>Standarde</label><select defaultValue="15"><option>10 min</option><option value="15">15 min</option><option>20 min</option></select></div>
                  <div className="ms-set-field"><label>Vizitë e parë</label><select defaultValue="40"><option>30 min</option><option value="40">40 min</option><option>45 min</option></select></div>
                </div>
              </div>
            </div>
          </div>
        )}

        {tab === "users" && (
          <UserList device={device} onOpen={setUserView} />
        )}

        {tab === "payments" && (
          <div className="ms-set-pane">
            <h2>Kodet e pagesave</h2>
            <div className="pane-sub">Kode të shkurtra që mjeku zgjedh gjatë vizitës. Vetëm mjeku i sheh — nuk shfaqen për recepsion ose pacient.</div>
            <div className="ms-set-card">
              {PAY_CODES_FULL.map(c => (
                <div className="ms-code-row" key={c.code}>
                  <span className="badge" style={{ background: c.color }}>{c.code}</span>
                  <span className="ci"><span className="l">{c.label}</span></span>
                  <span className="price">{c.price} €</span>
                  <span className="chev"><Icon d="chevright" size={16} /></span>
                </div>
              ))}
            </div>
          </div>
        )}

        {tab === "email" && (
          <div className="ms-set-pane">
            <h2>Email</h2>
            <div className="pane-sub">Si dërgohen vërtetimet, kujtesat dhe linket për reset të fjalëkalimit.</div>
            <div className="ms-set-card">
              <div className="ms-toggle-row"><span className="tr-text"><span className="l">Vërtetim termini</span><span className="s">Dërgohet kur caktohet një termin</span></span><Toggle on={emailToggles.confirm} onClick={() => setEmailToggles(s => ({ ...s, confirm: !s.confirm }))} /></div>
              <div className="ms-toggle-row"><span className="tr-text"><span className="l">Kujtesë termini</span><span className="s">24 orë para vizitës</span></span><Toggle on={emailToggles.reminder} onClick={() => setEmailToggles(s => ({ ...s, reminder: !s.reminder }))} /></div>
              <div className="ms-toggle-row"><span className="tr-text"><span className="l">Reset i fjalëkalimit</span><span className="s">Link për stafin e klinikës</span></span><Toggle on={emailToggles.reset} onClick={() => setEmailToggles(s => ({ ...s, reset: !s.reset }))} /></div>
            </div>
          </div>
        )}

        {tab === "audit" && (
          <div className="ms-set-pane">
            <h2>Auditimi</h2>
            <div className="pane-sub">Ndryshimet e të dhënave klinike dhe veprimet e përdoruesve. Mbahen për 7 vjet sipas rregullores.</div>
            <div className="ms-set-card">
              {[
                { when: "14.05 · 16:22", who: "Dr. Taulant Shala", what: "Përfundoi vizitën · Era Krasniqi" },
                { when: "14.05 · 15:40", who: "Liridona Berisha", what: "Shtoi pacient pa termin · Dorian Hoxha" },
                { when: "14.05 · 11:02", who: "Arben Krasniqi", what: "Ndryshoi orarin e së shtunës" },
                { when: "13.05 · 18:15", who: "Dr. Taulant Shala", what: "Lidhi ekografi me vizitën · 22.02" },
              ].map((a, i) => (
                <div className="ms-data-row" key={i} style={{ alignItems: "flex-start", flexDirection: "column", gap: 3 }}>
                  <span style={{ display: "flex", justifyContent: "space-between", width: "100%" }}>
                    <span style={{ fontSize: 13, fontWeight: 500 }}>{a.who}</span>
                    <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-faint)" }}>{a.when}</span>
                  </span>
                  <span style={{ fontSize: 12.5, color: "var(--text-muted)" }}>{a.what}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Sticky save bar on editable panes */}
      {(tab === "general" || tab === "hours" || tab === "payments" || tab === "email") && (
        <div className="ms-savebar">
          <span className="autosave"><span className="dot" />Ndryshimet ruhen automatikisht</span>
          <button className="btn btn-primary">Ruaj</button>
        </div>
      )}
    </div>
  );
}

// ── User management (grouped list) ────────────────────────────────────────
function UserList({ device, onOpen }) {
  const groups = [
    { role: "doctor", label: "Mjekë" },
    { role: "reception", label: "Recepsion" },
    { role: "admin", label: "Administratorë" },
  ];
  return (
    <div className="m-app" style={{ flex: 1 }}>
      <div className="m-scroll">
        <div className="ms-set-pane" style={{ paddingBottom: 0 }}>
          <h2>Përdoruesit</h2>
          <div className="pane-sub">Stafi i klinikës që hyn në Klinika. Një përdorues mund të ketë një ose më shumë role.</div>
        </div>
        {groups.map(g => {
          const us = USERS.filter(u => u.roles.includes(g.role));
          if (!us.length) return null;
          return (
            <div key={g.role}>
              <div className="ms-user-group-label">{g.label} · {us.length}</div>
              {us.map(u => (
                <button key={u.email} className={"ms-user-row" + (u.active ? "" : " inactive")} onClick={() => onOpen(u)} style={{ width: "100%", textAlign: "left" }}>
                  <span className="av">{u.initials}</span>
                  <span className="info">
                    <span className="nm">{u.name}{u.you && <span className="you">Ti</span>}</span>
                    <span className="em">{u.email}</span>
                    <span className="roles">{u.roles.map(r => <span key={r} className={"chip-role " + ROLE_META[r].cls + " sm"}>{ROLE_META[r].label}</span>)}</span>
                  </span>
                  <span className="tail">
                    {u.active ? <span className="chip chip-green"><span className="dot" />Aktiv</span> : <span className="chip chip-amber"><span className="dot" />Joaktiv</span>}
                    <span className="last">{u.last}</span>
                  </span>
                </button>
              ))}
            </div>
          );
        })}
        <div style={{ height: 80 }} />
      </div>
      <button className="m-fab" onClick={() => onOpen("add")} aria-label="Shto përdorues" style={{ bottom: 16 }}><Icon d="plus" size={24} sw={2} /></button>
    </div>
  );
}

// ── Add / edit user (full-screen takeover) ────────────────────────────────
function UserForm({ device, user, onBack }) {
  const isNew = !user;
  const [roles, setRoles] = React.useState(isNew ? [] : user.roles);
  const [active, setActive] = React.useState(isNew ? true : user.active);
  const toggleRole = (r) => setRoles(rs => rs.includes(r) ? rs.filter(x => x !== r) : [...rs, r]);

  return (
    <div className="m-app" style={{ flex: 1 }}>
      <div className="ms-subbar">
        <button className="back" onClick={onBack}><Icon d="chevleft" size={18} />Përdoruesit</button>
        <div className="sb-spacer" />
        <span className="sb-title">{isNew ? "Përdorues i ri" : "Ndrysho"}</span>
      </div>
      <div className="m-scroll">
        {!isNew && (
          <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "18px 16px", borderBottom: "1px solid var(--border)" }}>
            <span className="av" style={{ width: 56, height: 56, borderRadius: 999, background: active ? "var(--teal-700)" : "var(--text-faint)", color: "#fff", display: "grid", placeItems: "center", fontFamily: "var(--font-display)", fontWeight: 600, fontSize: 19 }}>{user.initials}</span>
            <div>
              <div style={{ fontFamily: "var(--font-display)", fontSize: 18, fontWeight: 600 }}>{user.name}</div>
              <div style={{ fontFamily: "var(--font-mono)", fontSize: 12.5, color: "var(--text-muted)" }}>{user.email}</div>
            </div>
          </div>
        )}

        <div className="ms-userform-field"><label>Emri i plotë</label><input defaultValue={isNew ? "" : user.name} placeholder="p.sh. Dr. Vesa Hoxha" /></div>
        <div className="ms-userform-field"><label>Email</label><input defaultValue={isNew ? "" : user.email} placeholder="emri@donetamed.com" inputMode="email" /></div>

        <div className="ms-userform-field">
          <label>Rolet</label>
          <div className="ms-role-picker">
            {Object.entries(ROLE_META).map(([k, m]) => (
              <button key={k} type="button" className={"ms-role-opt" + (roles.includes(k) ? " checked" : "")} onClick={() => toggleRole(k)}>
                <span className="box">{roles.includes(k) && <Icon d="M4 10l4 4 8-9" size={14} sw={2} />}</span>
                <span className="rt">
                  <span className="l">{m.label}</span>
                  <span className="s">{k === "doctor" ? "Vizita, kartela, raporti" : k === "reception" ? "Kalendari, pacientët (emër+DL)" : "Cilësimet, përdoruesit, pagesat"}</span>
                </span>
              </button>
            ))}
          </div>
        </div>

        {!isNew && (
          <div className="ms-toggle-row" style={{ borderTop: "1px solid var(--border-soft)" }}>
            <span className="tr-text"><span className="l">Llogaria aktive</span><span className="s">{active ? "Mund të hyjë në sistem" : "Qasja e bllokuar"}</span></span>
            <Toggle on={active} onClick={() => setActive(a => !a)} />
          </div>
        )}

        <div className="ms-user-actions">
          {!isNew && (
            <>
              <button className="btn btn-secondary btn-lg">
                <Icon d="M10 3a4 4 0 0 0-4 4v2 M3.5 9h13v8h-13z M10 13v2" size={16} style={{ marginRight: 6 }} />Dërgo reset të fjalëkalimit
              </button>
            </>
          )}
        </div>
        <div style={{ height: 12 }} />
      </div>

      <div className="ms-savebar">
        {isNew ? (
          <>
            <button className="btn btn-ghost" onClick={onBack} style={{ flex: "0 0 auto" }}>Anulo</button>
            <button className="btn btn-primary" onClick={onBack}>Shto përdoruesin</button>
          </>
        ) : (
          <>
            <button className="btn btn-danger" style={{ flex: "0 0 auto" }} onClick={onBack}>Fshij</button>
            <button className="btn btn-primary" onClick={onBack}>Ruaj</button>
          </>
        )}
      </div>
    </div>
  );
}

Object.assign(window, { SettingsScreen, UserList, UserForm, Toggle });
