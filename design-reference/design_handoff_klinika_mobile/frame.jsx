// frame.jsx — device bezel (iPhone / iPad portrait / iPad landscape) with
// auto-fit scaling, iOS status bar, and home indicator.

const DEVICE_DIMS = {
  phone:  { w: 390,  h: 844,  cls: "is-phone",  kind: "phone",  pad: 14 },
  "ipad-p": { w: 768,  h: 1024, cls: "is-tablet", kind: "tablet", pad: 16 },
  "ipad-l": { w: 1024, h: 768,  cls: "is-tablet", kind: "tablet", pad: 16 },
};

function useFit(device) {
  const [scale, setScale] = React.useState(1);
  const dim = DEVICE_DIMS[device] || DEVICE_DIMS.phone;
  React.useEffect(() => {
    const recalc = () => {
      const marginX = 48, marginY = 40;
      const fw = dim.w + dim.pad * 2;
      const fh = dim.h + dim.pad * 2;
      const availW = window.innerWidth - marginX * 2;
      const availH = window.innerHeight - marginY * 2;
      setScale(Math.min(availW / fw, availH / fh, 1));
    };
    recalc();
    window.addEventListener("resize", recalc);
    return () => window.removeEventListener("resize", recalc);
  }, [device, dim.w, dim.h, dim.pad]);
  return { scale, dim };
}

function StatusBar({ onDark, kind }) {
  const [time, setTime] = React.useState("9:41");
  // Keep a believable clock; clinic day fixtures sit around 14:xx so anchor there.
  React.useEffect(() => {
    const t = new Date();
    const tick = () => {
      const d = new Date();
      setTime(`${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`);
    };
    tick();
    const id = setInterval(tick, 15000);
    return () => clearInterval(id);
  }, []);
  return (
    <div className={"m-statusbar" + (onDark ? " on-dark" : "")}>
      <span className="sb-time">{time}</span>
      <span className="sb-icons">
        {/* signal */}
        <svg width="18" height="12" viewBox="0 0 18 12" fill="currentColor" aria-hidden="true">
          <rect x="0" y="8" width="3" height="4" rx="1"/>
          <rect x="5" y="5.5" width="3" height="6.5" rx="1"/>
          <rect x="10" y="3" width="3" height="9" rx="1"/>
          <rect x="15" y="0.5" width="3" height="11.5" rx="1" opacity="0.4"/>
        </svg>
        {/* wifi */}
        <svg width="16" height="12" viewBox="0 0 16 12" fill="currentColor" aria-hidden="true">
          <path d="M8 11.2 9.6 9.2a2 2 0 0 0-3.2 0L8 11.2Z"/>
          <path d="M8 4.2c1.9 0 3.7.7 5 2l1.2-1.5A9 9 0 0 0 8 1.7 9 9 0 0 0 1.8 4.7L3 6.2A7 7 0 0 1 8 4.2Z" opacity="0.95"/>
          <path d="M8 7.2c1 0 2 .4 2.7 1.1l1.2-1.5A6 6 0 0 0 8 5 6 6 0 0 0 4.1 6.8l1.2 1.5A4 4 0 0 1 8 7.2Z"/>
        </svg>
        {/* battery */}
        <svg width="26" height="13" viewBox="0 0 26 13" fill="none" aria-hidden="true">
          <rect x="0.5" y="0.5" width="22" height="12" rx="3.5" stroke="currentColor" opacity="0.4"/>
          <rect x="2" y="2" width="16" height="9" rx="2" fill="currentColor"/>
          <path d="M24 4.2v4.6c1-.4 1-4.2 0-4.6Z" fill="currentColor" opacity="0.5"/>
        </svg>
      </span>
    </div>
  );
}

function DeviceFrame({ device, statusDark = false, hideStatus = false, hideHomeIndicator = false, children }) {
  const { scale, dim } = useFit(device);
  const fw = dim.w + dim.pad * 2;
  const fh = dim.h + dim.pad * 2;
  return (
    <div className="m-stage">
      <div className="m-scaler" style={{ width: fw * scale, height: fh * scale, minWidth: fw * scale, minHeight: fh * scale }}>
        <div className={"device " + dim.cls + (device === "ipad-l" ? " is-tablet-l" : "") + (device === "ipad-p" ? " is-tablet-p" : "")}
             style={{ width: dim.w, height: dim.h, minWidth: dim.w, minHeight: dim.h, transform: `scale(${scale})`, transformOrigin: "top left" }}>
          <div className="device-screen">
            {!hideStatus && <StatusBar onDark={statusDark} kind={dim.kind} />}
            {children}
            {dim.kind === "phone" && !hideHomeIndicator && (
              <div className={"m-home-indicator" + (statusDark ? " on-dark" : "")}><i /></div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { DeviceFrame, StatusBar, useFit, DEVICE_DIMS });
