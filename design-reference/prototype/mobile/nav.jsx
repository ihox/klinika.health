// nav.jsx — role config + mobile navigation system.
//   Phone:  TopAppBar + BottomTabs (+ MoreSheet)  OR  hamburger Drawer
//   Tablet: TabletTopNav (enlarged desktop topbar)
//   Shared: SearchSheet (⌘K equivalent)

// ── Role configuration ────────────────────────────────────────────────────
// Role-aware nav. "Raporti" is present for all three clinic roles (it is the
// platform_admin pages that lack it — those are out of mobile scope entirely).
const ROLE_CONFIG = {
  doctor: {
    name: "Dr. Taulant Shala", email: "taulant@donetamed.com", initials: "TS",
    chips: [["doctor", "Mjeku"], ["admin", "Administrator i klinikës"]],
    home: "home",
    tabs: [
      { id: "home", label: "Sot", icon: "home" },
      { id: "patients", label: "Pacientët", icon: "patients" },
      { id: "report", label: "Raporti", icon: "report" },
    ],
    links: [
      { id: "home", label: "Pamja e ditës" },
      { id: "patients", label: "Pacientët" },
      { id: "report", label: "Raporti" },
      { id: "settings", label: "Cilësimet" },
    ],
  },
  reception: {
    name: "Liridona Berisha", email: "liridona@donetamed.com", initials: "LB",
    chips: [["reception", "Recepsioniste"]],
    home: "home",
    tabs: [
      { id: "home", label: "Kalendari", icon: "calendar" },
      { id: "report", label: "Raporti", icon: "report" },
    ],
    links: [
      { id: "home", label: "Kalendari" },
      { id: "report", label: "Raporti" },
    ],
  },
  admin: {
    name: "Arben Krasniqi", email: "arben@donetamed.com", initials: "AK",
    chips: [["admin", "Administrator i klinikës"]],
    home: "settings",
    tabs: [
      { id: "settings", label: "Cilësimet", icon: "settings" },
      { id: "patients", label: "Pacientët", icon: "patients" },
      { id: "report", label: "Raporti", icon: "report" },
    ],
    links: [
      { id: "settings", label: "Cilësimet" },
      { id: "users", label: "Përdoruesit" },
      { id: "report", label: "Raporti" },
    ],
  },
};

const SCREEN_TITLES = {
  home: { doctor: "Pamja e ditës", reception: "Kalendari", admin: "Kryefaqja" },
  patients: "Pacientët",
  report: "Raporti ditor",
  settings: "Cilësimet",
  users: "Përdoruesit",
  profile: "Profili im",
};
function screenTitle(screen, role) {
  const t = SCREEN_TITLES[screen];
  return typeof t === "object" ? t[role] : (t || "Klinika");
}

// Overflow / drawer items beyond the primary tabs.
function moreItems(role) {
  const cfg = ROLE_CONFIG[role];
  const inTabs = new Set(cfg.tabs.map(t => t.id));
  const items = [];
  if (!inTabs.has("settings") && (role === "admin" || role === "doctor"))
    items.push({ id: "settings", label: "Cilësimet", icon: "settings" });
  items.push({ id: "profile", label: "Profili im", icon: "profile", sub: cfg.name });
  return items;
}

// ── Phone top app bar ─────────────────────────────────────────────────────
function TopAppBar({ title, sub, role, navVariant, onMenu, onSearch, onProfile, leadingBack, onBack, hideActions }) {
  const cfg = ROLE_CONFIG[role];
  return (
    <header className="m-appbar">
      {leadingBack ? (
        <button className="m-iconbtn" onClick={onBack} aria-label="Kthehu"><Icon d="back" /></button>
      ) : navVariant === "drawer" ? (
        <button className="m-iconbtn" onClick={onMenu} aria-label="Menyja">
          <Icon d="M3 6h14 M3 10h14 M3 14h14" sw={1.8} />
        </button>
      ) : (
        <span className="brand-mark" style={{ width: 30, height: 30, borderRadius: 9 }} aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" style={{ width: "58%", height: "58%" }}><path d="M3 12h4l2-6 4 12 2-6h6" /></svg>
        </span>
      )}
      <div className="ab-title-wrap" style={{ flex: 1, minWidth: 0 }}>
        <div className="ab-title">{title}</div>
        {sub && <div className="ab-sub">{sub}</div>}
      </div>
      <button className="m-iconbtn" onClick={onSearch} aria-label="Kërko" style={hideActions ? { display: "none" } : undefined}><Icon d="search" /></button>
      <button className="m-iconbtn" onClick={onProfile} aria-label="Profili" style={hideActions ? { display: "none" } : undefined}>
        <span className="ab-avatar">{cfg.initials}</span>
      </button>
    </header>
  );
}

// ── Phone bottom tab bar ──────────────────────────────────────────────────
function BottomTabs({ role, current, onNav, navVariant, onMore }) {
  const cfg = ROLE_CONFIG[role];
  let tabs = cfg.tabs.slice(0, 3);
  if (navVariant === "tabs-more") {
    tabs = [...tabs, { id: "__more", label: "Më shumë", icon: "more" }];
  } else {
    tabs = [...tabs, { id: "profile", label: "Profili", icon: "profile" }];
  }
  return (
    <nav className="m-tabbar" aria-label="Navigimi kryesor">
      {tabs.map(t => {
        const active = t.id === "__more" ? false : current === t.id;
        return (
          <button key={t.id} className={"m-tab" + (active ? " is-active" : "")}
                  onClick={() => t.id === "__more" ? onMore() : onNav(t.id)}>
            <span className="ic"><Icon d={t.icon} size={24} /></span>
            <span className="lbl">{t.label}</span>
          </button>
        );
      })}
    </nav>
  );
}

// ── Overflow sheet ("Më shumë") ───────────────────────────────────────────
function MoreSheet({ open, role, current, onClose, onNav }) {
  const items = moreItems(role);
  return (
    <>
      <div className={"m-scrim" + (open ? " is-open" : "")} onClick={onClose}
           style={{ pointerEvents: open ? "auto" : "none" }} />
      <div className={"m-sheet" + (open ? " is-open" : "")} role="dialog" aria-label="Më shumë">
        <div className="sheet-grip" />
        <div className="sheet-head"><h3>Më shumë</h3>
          <button className="m-iconbtn" onClick={onClose} aria-label="Mbyll"><Icon d="close" /></button>
        </div>
        <div className="sheet-body">
          <div className="m-list">
            {items.map(it => (
              <button key={it.id} className={"m-listitem" + (current === it.id ? " is-active" : "")}
                      onClick={() => { onNav(it.id); onClose(); }}>
                <span className="li-ic"><Icon d={it.icon} /></span>
                <span className="li-text">{it.label}{it.sub && <div className="sub">{it.sub}</div>}</span>
                <span className="li-chev"><Icon d="chevright" size={16} /></span>
              </button>
            ))}
            <button className="m-listitem" onClick={() => { onNav("help"); onClose(); }}>
              <span className="li-ic"><Icon d="help" /></span>
              <span className="li-text">Ndihmë</span>
              <span className="li-chev"><Icon d="chevright" size={16} /></span>
            </button>
            <div className="m-divider-soft" />
            <button className="m-listitem danger" onClick={() => { onNav("login"); onClose(); }}>
              <span className="li-ic"><Icon d="logout" /></span>
              <span className="li-text">Dilni</span>
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

// ── Hamburger drawer (drawer nav variant) ─────────────────────────────────
function Drawer({ open, role, current, onClose, onNav }) {
  const cfg = ROLE_CONFIG[role];
  const items = [...cfg.tabs, ...moreItems(role).filter(i => i.id !== "profile")];
  return (
    <>
      <div className={"m-scrim" + (open ? " is-open" : "")} onClick={onClose}
           style={{ pointerEvents: open ? "auto" : "none" }} />
      <aside className={"m-drawer" + (open ? " is-open" : "")} aria-label="Menyja">
        <div style={{ padding: "calc(var(--m-statusbar-phone) + 8px) 16px 14px", borderBottom: "1px solid var(--border-soft)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
            <span className="brand-mark" style={{ width: 30, height: 30, borderRadius: 9 }} aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" style={{ width: "58%", height: "58%" }}><path d="M3 12h4l2-6 4 12 2-6h6" /></svg>
            </span>
            <span style={{ fontFamily: "var(--font-display)", fontSize: 17, fontWeight: 600, letterSpacing: "-0.02em" }}>klinika<span style={{ color: "var(--text-faint)", fontWeight: 400 }}>.health</span></span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span className="ms-identity-avatar" style={{ width: 40, height: 40, borderRadius: 999, background: "var(--teal-700)", color: "#fff", display: "grid", placeItems: "center", fontFamily: "var(--font-display)", fontWeight: 600, fontSize: 14 }}>{cfg.initials}</span>
            <div>
              <div style={{ fontFamily: "var(--font-display)", fontSize: 14, fontWeight: 600 }}>{cfg.name}</div>
              <div style={{ display: "flex", gap: 4, marginTop: 4 }}>{cfg.chips.map(([c, l]) => <span key={c} className={"chip-role " + c + " sm"}>{l}</span>)}</div>
            </div>
          </div>
        </div>
        <div className="m-scroll">
          <div className="m-list">
            {items.map(it => (
              <button key={it.id} className={"m-listitem" + (current === it.id ? " is-active" : "")}
                      onClick={() => { onNav(it.id); onClose(); }}>
                <span className="li-ic"><Icon d={it.icon} /></span>
                <span className="li-text">{it.label}</span>
              </button>
            ))}
            <button className="m-listitem" onClick={() => { onNav("profile"); onClose(); }}>
              <span className="li-ic"><Icon d="profile" /></span><span className="li-text">Profili im</span>
            </button>
            <div className="m-divider-soft" />
            <button className="m-listitem danger" onClick={() => { onNav("login"); onClose(); }}>
              <span className="li-ic"><Icon d="logout" /></span><span className="li-text">Dilni</span>
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}

// ── Tablet top nav ────────────────────────────────────────────────────────
function TabletTopNav({ role, current, onNav, onSearch, onProfile }) {
  const cfg = ROLE_CONFIG[role];
  return (
    <header className="m-topnav">
      <div className="tn-brand">
        <span className="brand-mark" style={{ width: 30, height: 30, borderRadius: 9 }} aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" style={{ width: "58%", height: "58%" }}><path d="M3 12h4l2-6 4 12 2-6h6" /></svg>
        </span>
        klinika<span className="ext">.health</span>
      </div>
      <nav className="tn-links">
        {cfg.links.map(l => (
          <button key={l.id} className={"tn-link" + (current === l.id ? " is-active" : "")}
                  onClick={() => onNav(l.id)}>{l.label}</button>
        ))}
      </nav>
      <div className="tn-spacer" />
      <button className="tn-search" onClick={onSearch}>
        <Icon d="search" size={16} /> Kërko pacient <span className="kbd" style={{ marginLeft: "auto" }}>⌘K</span>
      </button>
      <button className="tn-user" onClick={onProfile}>
        <span className="avatar">{cfg.initials}</span>
        <span className="name">{cfg.name.replace("Dr. ", "Dr. ")}</span>
        <Icon d="chevdown" size={14} style={{ color: "var(--text-faint)" }} />
      </button>
    </header>
  );
}

// ── Search bottom sheet (⌘K equivalent) ───────────────────────────────────
function SearchSheet({ open, onClose, onPick, emptyState }) {
  const [q, setQ] = React.useState("");
  const inputRef = React.useRef(null);
  React.useEffect(() => {
    if (open) { setQ(""); setTimeout(() => inputRef.current && inputRef.current.focus(), 320); }
  }, [open]);
  const results = React.useMemo(() => {
    if (emptyState) return [];
    const term = q.trim().toLowerCase();
    if (!term) return PATIENTS.slice(0, 5);
    return PATIENTS.filter(p => p.name.toLowerCase().includes(term));
  }, [q, emptyState]);
  return (
    <>
      <div className={"m-scrim" + (open ? " is-open" : "")} onClick={onClose}
           style={{ pointerEvents: open ? "auto" : "none" }} />
      <div className={"m-sheet" + (open ? " is-open" : "")} role="dialog" aria-label="Kërko pacient"
           style={{ maxHeight: "82%" }}>
        <div className="sheet-grip" />
        <div className="sheet-head"><h3>Kërko pacient</h3>
          <button className="m-iconbtn" onClick={onClose} aria-label="Mbyll"><Icon d="close" /></button>
        </div>
        <div className="ms-search-field">
          <span className="icon"><Icon d="search" size={18} /></span>
          <input ref={inputRef} value={q} onChange={e => setQ(e.target.value)}
                 placeholder="Emër ose datëlindje" autoComplete="off" />
        </div>
        <div className="sheet-body">
          {!q && results.length > 0 && <div className="ms-search-recent">Të fundit</div>}
          {results.map(p => (
            <button key={p.name} className="ms-result" onClick={() => onPick && onPick(p)}>
              <span className="avatar">{initials(p.name)}</span>
              <span className="info">
                <span className="nm">{p.name}</span>
                <span className="dob">DL {p.dob} · {p.age}</span>
              </span>
              {p.recent
                ? <span className="chip chip-green"><span className="dot" />{p.recent === "7d" ? "7 ditë" : "30 ditë"}</span>
                : <span className="visits">{p.visits} vizita</span>}
            </button>
          ))}
          {results.length === 0 && (
            <div className="ms-empty" style={{ padding: "32px 32px 24px" }}>
              <span className="ico"><Icon d="search" size={24} /></span>
              <span className="t">Asnjë pacient</span>
              <span className="d">{q ? `Asnjë rezultat për "${q}".` : "Shkruaj për të kërkuar."}</span>
            </div>
          )}
          <button className="ms-search-add" onClick={() => onPick && onPick({ isNew: true, q })}>
            <span className="plus">+</span> Shto pacient të ri{q && <span style={{ color: "var(--text-strong)", marginLeft: 4 }}>"{q}"</span>}
          </button>
        </div>
      </div>
    </>
  );
}

Object.assign(window, {
  ROLE_CONFIG, screenTitle, moreItems,
  TopAppBar, BottomTabs, MoreSheet, Drawer, TabletTopNav, SearchSheet,
});
