// Shared 5-minute snap helpers.
//
// System-wide rule: every appointment time lives on a HH:00 / HH:05 /
// HH:10 / ... / HH:55 boundary. Any code that computes a "snapped time"
// — the empty-slot hover ghost, the booking dialog's pre-fill, the
// drag-and-drop drop target — routes through these helpers so the
// math stays in one place.

const FIVE_MIN_MS = 5 * 60 * 1000;

export function snapToFiveMinutes(date: Date): Date {
  return new Date(Math.round(date.getTime() / FIVE_MIN_MS) * FIVE_MIN_MS);
}

/** Snap an HH:MM string to the nearest 5-minute mark. */
export function snapTimeStringToFiveMinutes(time: string): string {
  const [hStr, mStr] = time.split(':');
  const h = Number(hStr);
  const m = Number(mStr);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return time;
  let total = h * 60 + Math.round(m / 5) * 5;
  if (total < 0) total = 0;
  if (total >= 24 * 60) total = 24 * 60 - 5;
  const hh = Math.floor(total / 60);
  const mm = total % 60;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

/** Returns true when `time` (HH:MM) sits exactly on a 5-minute mark. */
export function isOnFiveMinuteMark(time: string): boolean {
  const [, mStr] = time.split(':');
  const m = Number(mStr);
  return Number.isFinite(m) && m % 5 === 0;
}
