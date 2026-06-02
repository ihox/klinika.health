// screens-shared.jsx — Login, Profile, and Phase 2/3 placeholders.

function LoginScreen({ device, onLogin }) {
  const [role, setRole] = React.useState("doctor");
  return (
    <div className="ms-login">
      <div className="brand">
        <span className="brand-mark" style={{ width: 38, height: 38, borderRadius: 11 }} aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" style={{ width: "58%", height: "58%" }}><path d="M3 12h4l2-6 4 12 2-6h6" /></svg>
        </span>
        <span className="word">klinika<span className="ext">.health</span></span>
      </div>

      <div className="hero">
        <div className="ttl">Mirë se erdhët</div>
        <div className="sub">Hyni në llogarinë tuaj për të vazhduar.</div>
      </div>

      <form className="form" onSubmit={e => { e.preventDefault(); onLogin(role === "reception" ? "reception" : "doctor"); }}>
        <div className="field">
          <label className="field-label">Email</label>
          <input className="input" type="email" defaultValue="taulant@donetamed.al" autoComplete="username" />
        </div>
        <div className="field">
          <label className="field-label">Fjalëkalimi</label>
          <input className="input" type="password" defaultValue="••••••••••" autoComplete="current-password" />
        </div>
        <div className="rowbtw">
          <label className="check"><input type="checkbox" defaultChecked /> Më mbaj të kyçur</label>
          <a className="link" href="#" onClick={e => e.preventDefault()}>Harruat fjalëkalimin?</a>
        </div>
        <div className="roleswitch" role="tablist">
          <button type="button" className={role === "doctor" ? "is-active" : ""} onClick={() => setRole("doctor")}>Mjeku</button>
          <button type="button" className={role === "reception" ? "is-active" : ""} onClick={() => setRole("reception")}>Recepsioni</button>
        </div>
        <button className="btn btn-primary btn-lg" type="submit" style={{ marginTop: 4 }}>Hyr</button>
      </form>

      <div className="foot">
        <span>DonetaMED · Prizren</span><span>·</span><span>v1.0</span>
      </div>
    </div>
  );
}

function ProfileScreen({ role, device }) {
  const cfg = ROLE_CONFIG[role];
  return (
    <div className="m-scroll">
      <div className="ms-profile">
        <div className="ms-identity">
          <span className="avatar">{cfg.initials}</span>
          <div>
            <div className="nm">{cfg.name}</div>
            <div className="em">{cfg.email}</div>
            <div className="roles">{cfg.chips.map(([c, l]) => <span key={c} className={"chip-role " + c}>{l}</span>)}</div>
          </div>
        </div>

        <div className="ms-pcard">
          <div className="h">Të dhënat</div>
          <div className="ms-prow"><span className="k">Emri i plotë</span><span className="val">{cfg.name}</span></div>
          <div className="ms-prow"><span className="k">Email</span><span className="val" style={{ fontFamily: "var(--font-mono)", fontSize: 13 }}>{cfg.email}<Icon d="M5 8V6a3 3 0 0 1 6 0v2 M3.5 8h9v6.5h-9z" size={13} style={{ marginLeft: 6, verticalAlign: -2, color: "var(--text-faint)" }} /></span></div>
          <div className="ms-prow"><span className="k">Telefoni</span><span className="val">+383 44 218 470</span></div>
          <div className="ms-prow"><span className="k">Gjuha</span><span className="val">Shqip</span></div>
        </div>

        <div className="ms-pcard">
          <div className="h">Siguria</div>
          <button className="ms-prow tappable" style={{ width: "100%", textAlign: "left" }}>
            <span className="k">Ndrysho fjalëkalimin</span><span className="chev"><Icon d="chevright" size={16} /></span>
          </button>
          <button className="ms-prow tappable" style={{ width: "100%", textAlign: "left" }}>
            <span className="k">Vërtetimi me dy hapa (MFA)</span>
            <span style={{ display: "flex", alignItems: "center", gap: 8 }}><span className="chip chip-green"><span className="dot" />Aktiv</span><span className="chev"><Icon d="chevright" size={16} /></span></span>
          </button>
        </div>

        <button className="btn btn-danger btn-lg" style={{ width: "100%" }}>
          <Icon d="logout" size={16} style={{ marginRight: 6 }} /> Dilni
        </button>
      </div>
    </div>
  );
}

// Honest placeholder for surfaces scheduled in later phases — keeps nav from
// dead-ending while signalling exactly what's coming.
const PLACEHOLDER_COPY = {
  patients: { icon: "patients", title: "Lista e pacientëve", phase: "Faza 2", desc: "Kërkim, kartela e pacientit, vizitat, ultrazëri dhe kurba e rritjes — të optimizuara për prekje." },
  report: { icon: "report", title: "Raporti ditor", phase: "Faza 3", desc: "Tri pllaka të stivosura vertikalisht, filtra horizontalë dhe printim nga tableti në fund të ditës." },
  settings: { icon: "settings", title: "Cilësimet", phase: "Faza 3", desc: "Orari dhe terminet, kodet e pagesës dhe menaxhimi i përdoruesve me navigim tabesh." },
  users: { icon: "patients", title: "Përdoruesit", phase: "Faza 3", desc: "Shtimi dhe menaxhimi i stafit të klinikës me role." },
  help: { icon: "help", title: "Ndihmë", phase: "", desc: "Udhëzues dhe kontakt për mbështetje." },
};

function PlaceholderScreen({ screen }) {
  const c = PLACEHOLDER_COPY[screen] || PLACEHOLDER_COPY.help;
  return (
    <div className="m-scroll">
      <div className="ms-empty" style={{ paddingTop: 80 }}>
        <span className="ico"><Icon d={c.icon} size={26} /></span>
        <span className="t">{c.title}</span>
        {c.phase && <span className="chip chip-teal" style={{ marginBottom: 2 }}>{c.phase}</span>}
        <span className="d">{c.desc}</span>
      </div>
    </div>
  );
}

Object.assign(window, { LoginScreen, ProfileScreen, PlaceholderScreen });
