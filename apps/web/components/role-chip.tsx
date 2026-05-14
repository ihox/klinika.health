import type { ClinicRole } from '@/lib/role-labels';
import { roleLabel } from '@/lib/role-labels';

/**
 * Role chip — the canonical visual token for a clinic role.
 *
 * Colour families (per role-chips.html): doctor → indigo,
 * receptionist → violet, clinic_admin → slate. Two sizes mirror the
 * prototype: default (12px) for the user menu + profile + create/edit
 * modals; `.sm` (10.5px) for inline table cells and audit-log diffs.
 *
 * Strings come from `lib/role-labels.ts` so the chip, table, dropdown,
 * and modal stay in lockstep on the Albanian copy.
 */

type Size = 'default' | 'sm';

const COLOURS: Record<ClinicRole, string> = {
  doctor: 'bg-indigo-50 text-indigo-800 border-indigo-200',
  receptionist: 'bg-violet-50 text-violet-800 border-violet-200',
  clinic_admin: 'bg-slate-100 text-slate-800 border-slate-300',
};

const SIZES: Record<Size, string> = {
  default: 'text-[12px] px-2.5 py-0.5 font-medium',
  sm: 'text-[10.5px] px-2 py-[1px] font-medium',
};

interface Props {
  role: ClinicRole;
  size?: Size;
  /** Override the label (rarely needed — use only when the role
   *  should display as a different word, e.g. in the create modal's
   *  side-by-side picker). */
  label?: string;
  className?: string;
}

export function RoleChip({ role, size = 'default', label, className = '' }: Props) {
  return (
    <span
      className={[
        'inline-flex items-center rounded-full border',
        SIZES[size],
        COLOURS[role],
        className,
      ].join(' ')}
      data-role={role}
    >
      {label ?? roleLabel(role)}
    </span>
  );
}
