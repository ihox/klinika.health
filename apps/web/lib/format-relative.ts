const SECOND = 1_000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * "5 min më parë" / "2 orë më parë" — relative time in Albanian.
 *
 * Times further than ~30 days back fall back to an absolute date
 * format because relative phrasing past that point becomes harder
 * to parse than just the date.
 */
export function formatRelativeAlbanian(iso: string | null | undefined): string {
  if (!iso) return '—';
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '—';
  const diffMs = Date.now() - t;
  if (diffMs < 30 * SECOND) return 'Tani';
  if (diffMs < MINUTE) {
    return `${Math.round(diffMs / SECOND)} sek më parë`;
  }
  if (diffMs < HOUR) {
    const m = Math.round(diffMs / MINUTE);
    return `${m} min më parë`;
  }
  if (diffMs < DAY) {
    const h = Math.round(diffMs / HOUR);
    return `${h} orë më parë`;
  }
  if (diffMs < 30 * DAY) {
    const d = Math.round(diffMs / DAY);
    return `${d} ditë më parë`;
  }
  return new Intl.DateTimeFormat('sq-AL', {
    timeZone: 'Europe/Belgrade',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(new Date(t));
}

/** dd.MM.yyyy in Europe/Belgrade. */
export function formatDateAlbanian(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return '—';
  return new Intl.DateTimeFormat('sq-AL', {
    timeZone: 'Europe/Belgrade',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(d);
}
