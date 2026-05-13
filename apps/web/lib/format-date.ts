/**
 * Render a date in `dd.MM.yyyy` (Europe/Belgrade). Used in profile and
 * audit displays so timestamps look consistent regardless of the
 * user's browser locale.
 */
export function formatDateBelgrade(input: string | Date | null | undefined): string {
  if (!input) return '—';
  const d = typeof input === 'string' ? new Date(input) : input;
  if (Number.isNaN(d.getTime())) return '—';
  const fmt = new Intl.DateTimeFormat('sq-AL', {
    timeZone: 'Europe/Belgrade',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
  return fmt.format(d).replace(/\//g, '.').replace(/-/g, '.');
}

/** Render `dd.MM.yyyy · HH:mm` in Europe/Belgrade. */
export function formatDateTimeBelgrade(input: string | Date | null | undefined): string {
  if (!input) return '—';
  const d = typeof input === 'string' ? new Date(input) : input;
  if (Number.isNaN(d.getTime())) return '—';
  const fmt = new Intl.DateTimeFormat('sq-AL', {
    timeZone: 'Europe/Belgrade',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = fmt.formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('day')}.${get('month')}.${get('year')} · ${get('hour')}:${get('minute')}`;
}
