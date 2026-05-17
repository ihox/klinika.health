/**
 * Shared footer for the split-screen auth pages (clinic login,
 * platform-admin login). Mirrors the prototype convention — left side
 * carries scope context (clinic name or "admin") and the right side
 * advertises the MFA gate. Pages compose this directly so the wrapper
 * `<AuthShell>` stays scope-agnostic.
 */
export function AuthFooter({ left }: { left: string }) {
  return (
    <div className="flex w-full items-center justify-between">
      <span className="text-stone-500">{left}</span>
      <div className="flex items-center gap-1.5 text-stone-500">
        <ShieldIcon />
        <span>Mbrojtur me MFA</span>
      </div>
    </div>
  );
}

function ShieldIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      className="text-teal-600"
      aria-hidden="true"
    >
      <path d="M8 2L3 4v4c0 3 2.5 5.5 5 6.5 2.5-1 5-3.5 5-6.5V4L8 2z" />
    </svg>
  );
}
