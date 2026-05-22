'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';

import { ApiError } from '@/lib/api';
import { formatLongAlbanianDate } from '@/lib/appointment-client';
import { clinicClient, type ClinicSettings } from '@/lib/clinic-client';
import {
  dailyReportClient,
  type DailyReportResponse,
  type DailyReportStatus,
  type DailyReportVisit,
} from '@/lib/daily-report-client';
import { ageLabel } from '@/lib/patient-client';
import { useMe } from '@/lib/use-me';

import {
  centsToEur,
  chipLabel,
  countPaid,
  formatCompactSq,
  formatDl,
  primaryRoleFor,
  sumCents,
} from '../raporti-utils';

const DAY_LABELS: Record<number, string> = {
  0: 'E diel',
  1: 'E hënë',
  2: 'E martë',
  3: 'E mërkurë',
  4: 'E enjte',
  5: 'E premte',
  6: 'E shtunë',
};

const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

const STATUS_PRINT_SOLID: Record<DailyReportStatus, string> = {
  scheduled: '#4F46E5',
  arrived: '#0E7490',
  in_progress: '#0E7490',
  completed: '#15803D',
  no_show: '#B45309',
};

export function RaportiPrintView() {
  const router = useRouter();
  const params = useSearchParams();
  const date = params?.get('date') ?? '';
  const autoPrint = params?.get('print') === '1';

  const { me } = useMe();
  const [report, setReport] = useState<DailyReportResponse | null>(null);
  const [settings, setSettings] = useState<ClinicSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [issuedAt, setIssuedAt] = useState<string>('');

  useEffect(() => {
    if (!date) {
      setError('Mungon parametri data.');
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all([dailyReportClient.get(date), clinicClient.getSettings()])
      .then(([r, s]) => {
        if (cancelled) return;
        setReport(r);
        setSettings(s);
      })
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 403) {
          setError(
            err.body.reason === 'date_out_of_range'
              ? 'Nuk keni qasje për këtë datë.'
              : 'Pa qasje.',
          );
          return;
        }
        setError('Nuk u ngarkua raporti.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [date]);

  useEffect(() => {
    // Stamp the issued-at on mount; matches the prototype script.
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    setIssuedAt(
      `${pad(now.getDate())}.${pad(now.getMonth() + 1)}.${now.getFullYear()} · ${pad(now.getHours())}:${pad(now.getMinutes())}`,
    );
  }, []);

  useEffect(() => {
    if (!autoPrint) return;
    if (loading || error || !report || !settings) return;
    const t = setTimeout(() => window.print(), 250);
    return () => clearTimeout(t);
  }, [autoPrint, loading, error, report, settings]);

  const dayOfWeek = useMemo(() => {
    if (!date) return '';
    const d = new Date(`${date}T00:00:00Z`);
    return DAY_LABELS[d.getUTCDay()] ?? '';
  }, [date]);

  const orariLabel = useMemo(() => {
    if (!settings) return '';
    if (!date) return '';
    const d = new Date(`${date}T00:00:00Z`);
    const key = DAY_KEYS[d.getUTCDay()];
    if (!key) return '';
    const day = settings.hours.days[key];
    if (!day.open) return 'Mbyllur';
    return `${day.start} – ${day.end}`;
  }, [settings, date]);

  const doctorLabel = useMemo(() => {
    if (!me) return '';
    const title = me.title ? `${me.title} ` : '';
    return `${title}${me.firstName} ${me.lastName}`.trim();
  }, [me]);

  if (loading) {
    return (
      <div className="bg-[#E7E5E4] min-h-screen grid place-items-center text-stone-500">
        Po ngarkohet…
      </div>
    );
  }
  if (error || !report || !settings) {
    return (
      <div className="bg-[#E7E5E4] min-h-screen grid place-items-center text-stone-700 text-sm">
        {error ?? 'Pa të dhëna.'}
      </div>
    );
  }

  const completed = report.statusBreakdown.completed;
  const noShow = report.statusBreakdown.no_show;
  const scheduledIsh =
    report.statusBreakdown.scheduled +
    report.statusBreakdown.arrived +
    report.statusBreakdown.in_progress;

  return (
    <div className="bg-[#E7E5E4] min-h-screen">
      <style jsx global>{`
        @page {
          size: A4 portrait;
          margin: 0;
        }
        @media print {
          body {
            background: white !important;
          }
          .preview-bar {
            display: none !important;
          }
          .paper-area {
            padding: 0 !important;
            gap: 0 !important;
          }
          .paper {
            box-shadow: none !important;
            margin: 0 !important;
          }
        }
      `}</style>

      <div
        className="preview-bar sticky top-0 z-10 flex items-center gap-4 border-b border-line bg-surface-elevated px-6 py-3 shadow-[0_1px_2px_rgba(28,25,23,0.04)]"
      >
        <button
          type="button"
          onClick={() => router.push(`/raporti?date=${encodeURIComponent(date)}`)}
          className="text-[13px] text-ink-muted hover:text-ink"
        >
          ← Kthehu te raporti
        </button>
        <div>
          <div className="font-display text-[15px] font-semibold">Raporti i ditës</div>
          <div className="text-[12px] text-ink-muted">
            {formatCompactSq(date)} · A4 portret
          </div>
        </div>
        <div className="flex-1" />
        <button
          type="button"
          onClick={() => window.print()}
          className="rounded-md bg-primary px-3 py-1.5 text-[13px] font-medium text-white hover:bg-primary-dark"
        >
          Printo
        </button>
      </div>

      <div className="paper-area flex flex-col items-center gap-3.5 px-6 pb-12 pt-8">
        <article
          className="paper relative flex flex-col bg-white"
          style={{
            width: '210mm',
            minHeight: '297mm',
            padding: '14mm 16mm 18mm',
            fontFamily: 'Inter, system-ui, sans-serif',
            fontSize: '10pt',
            color: '#1c1917',
            lineHeight: 1.45,
            boxShadow:
              '0 8px 24px rgba(28,25,23,0.16), 0 2px 8px rgba(28,25,23,0.08)',
          }}
        >
          {/* Letterhead */}
          <header
            className="grid items-start"
            style={{
              gridTemplateColumns: '1.2fr 1fr',
              gap: '12mm',
              paddingBottom: '5mm',
              borderBottom: '1.5px solid #0F766E',
              marginBottom: '4mm',
            }}
          >
            <div>
              <span
                className="block uppercase"
                style={{
                  fontSize: '7.5pt',
                  fontWeight: 500,
                  letterSpacing: '0.04em',
                  color: '#57534E',
                  marginBottom: '1.2mm',
                  lineHeight: 1.2,
                }}
              >
                {/* Formal subtitle — derived from the clinic shortName.
                    The prototype hardcodes "Ordinanca Specialistike
                    Pediatrike"; v1 reuses shortName until the schema
                    grows a dedicated formal-name column. */}
                {settings.general.shortName}
              </span>
              <div
                style={{
                  fontFamily: "'Inter Tight', 'Inter', sans-serif",
                  fontSize: '18pt',
                  fontWeight: 700,
                  letterSpacing: '-0.015em',
                  color: '#0F766E',
                  lineHeight: 1,
                }}
              >
                {settings.general.name}
              </div>
              <div
                style={{
                  marginTop: '2.5mm',
                  fontSize: '8.2pt',
                  color: '#57534E',
                  lineHeight: 1.55,
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {settings.general.address}, {settings.general.city}, Kosovë
                <br />
                {settings.general.phones.join(' · ')}
                {settings.general.email ? (
                  <>
                    {' '}
                    · {settings.general.email}
                  </>
                ) : null}
                <br />
                {orariLabel ? `Orari: ${orariLabel}` : null}
              </div>
            </div>
            <div className="text-right">
              <span
                className="inline-block uppercase"
                style={{
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: '7.5pt',
                  color: '#0F766E',
                  background: '#F0FDFA',
                  border: '1px solid #99F6E4',
                  padding: '1.5mm 3mm',
                  borderRadius: '999px',
                  letterSpacing: '0.06em',
                  fontWeight: 600,
                  marginBottom: '2mm',
                }}
              >
                Raporti i ditës
              </span>
              <div
                style={{
                  fontFamily: "'Inter Tight', sans-serif",
                  fontSize: '22pt',
                  fontWeight: 700,
                  letterSpacing: '-0.02em',
                  lineHeight: 1.05,
                  color: '#1c1917',
                }}
              >
                {formatLongAlbanianDate(date)}
              </div>
              <div
                style={{
                  marginTop: '2mm',
                  fontSize: '9pt',
                  color: '#57534E',
                  lineHeight: 1.5,
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                <MetaRow k="Dita" v={dayOfWeek} />
                <MetaRow k="Orari" v={orariLabel || '—'} />
                <MetaRow k="Mjeku" v={doctorLabel || '—'} />
              </div>
            </div>
          </header>

          {/* Body */}
          <div className="flex flex-1 flex-col" style={{ gap: '5mm' }}>
            {/* Stat block */}
            <div
              className="grid overflow-hidden"
              style={{
                gridTemplateColumns: '1.3fr 1fr 1.4fr',
                border: '1px solid #D6D3D1',
                borderRadius: '3px',
              }}
            >
              <StatCell tone="revenue">
                <StatLabel>Të ardhura totale</StatLabel>
                <div
                  style={{
                    fontFamily: "'Inter Tight', sans-serif",
                    fontWeight: 700,
                    fontVariantNumeric: 'tabular-nums',
                    fontSize: '28pt',
                    color: '#0F766E',
                    letterSpacing: '-0.02em',
                    lineHeight: 1,
                  }}
                >
                  {centsToEur(report.totalRevenueCents)}
                  <span
                    style={{
                      fontFamily: "'Inter', sans-serif",
                      fontSize: '14pt',
                      color: '#0F766E',
                      fontWeight: 600,
                      marginLeft: '1.5mm',
                      letterSpacing: 0,
                    }}
                  >
                    €
                  </span>
                </div>
                <StatFootNote>
                  {report.paymentCodeBreakdown
                    .filter((b) => b.count > 0)
                    .map((b, i, arr) => (
                      <span key={b.code}>
                        <strong style={{ color: '#1c1917', fontWeight: 600 }}>
                          {b.code}
                        </strong>{' '}
                        ×{b.count}{' '}
                        {b.code === 'E' ? '(falas)' : `(${centsToEur(b.amountCents)}€)`}
                        {i < arr.length - 1 ? (
                          <span style={{ color: '#C4C0BC', margin: '0 1mm' }}>·</span>
                        ) : null}
                      </span>
                    ))}
                </StatFootNote>
              </StatCell>
              <StatCell>
                <StatLabel>Numri i vizitave</StatLabel>
                <div
                  style={{
                    fontFamily: "'Inter Tight', sans-serif",
                    fontWeight: 700,
                    fontVariantNumeric: 'tabular-nums',
                    fontSize: '22pt',
                    color: '#1c1917',
                    letterSpacing: '-0.02em',
                    lineHeight: 1,
                  }}
                >
                  {report.visitCount}
                </div>
                <StatFootNote>
                  <strong style={{ color: '#1c1917', fontWeight: 600 }}>
                    {report.paidCount}
                  </strong>{' '}
                  të paguara
                  <span style={{ color: '#C4C0BC', margin: '0 1mm' }}>·</span>
                  <strong style={{ color: '#1c1917', fontWeight: 600 }}>
                    {Math.max(report.visitCount - report.paidCount, 0)}
                  </strong>{' '}
                  të tjera
                </StatFootNote>
              </StatCell>
              <StatCell>
                <StatLabel>Statusi i vizitave</StatLabel>
                <div
                  className="flex flex-col"
                  style={{ gap: '1.2mm', fontSize: '9pt' }}
                >
                  <StatusLine
                    color={STATUS_PRINT_SOLID.completed}
                    label="Të përfunduara"
                    count={completed}
                  />
                  <StatusLine
                    color={STATUS_PRINT_SOLID.no_show}
                    label="Mungesa"
                    count={noShow}
                  />
                  <StatusLine
                    color={STATUS_PRINT_SOLID.scheduled}
                    label="Të planifikuara"
                    count={scheduledIsh}
                  />
                </div>
              </StatCell>
            </div>

            {/* Section heading */}
            <div
              className="flex items-baseline justify-between"
              style={{
                marginTop: '1mm',
                marginBottom: '2mm',
                paddingBottom: '1.5mm',
                borderBottom: '1px solid #D6D3D1',
              }}
            >
              <h2
                style={{
                  fontFamily: "'Inter Tight', sans-serif",
                  fontSize: '11pt',
                  fontWeight: 700,
                  color: '#1c1917',
                  letterSpacing: '-0.01em',
                }}
              >
                Vizitat e ditës
              </h2>
              <span
                className="uppercase"
                style={{
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: '7.5pt',
                  color: '#78716C',
                  letterSpacing: '0.06em',
                }}
              >
                {report.visitCount}{' '}
                {report.visitCount === 1 ? 'rresht' : 'rreshta'} · sipas orës
              </span>
            </div>

            {/* Visits table */}
            <PrintTable
              visits={report.visits}
              total={sumCents(report.visits)}
              paid={countPaid(report.visits)}
              other={Math.max(report.visitCount - countPaid(report.visits), 0)}
            />

            {/* Code legend */}
            <div
              className="flex flex-wrap"
              style={{
                marginTop: '2mm',
                fontSize: '7.5pt',
                color: '#78716C',
                gap: '4mm',
                padding: '2mm 0',
                borderTop: '0.5px dashed #D6D3D1',
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {report.paymentCodes.map((c) => (
                <span key={c.code}>
                  <span
                    style={{
                      fontFamily: "'JetBrains Mono', monospace",
                      fontWeight: 700,
                      color: '#1c1917',
                      marginRight: '1mm',
                    }}
                  >
                    {c.code}
                  </span>
                  {c.code === 'E' ? 'Falas' : `${centsToEur(c.amountCents)} €`}
                </span>
              ))}
            </div>
          </div>

          {/* Footer — issue stamp on the left, signature on the right.
              NO QR code per the brief. */}
          <footer
            className="flex items-end justify-between"
            style={{
              marginTop: '8mm',
              paddingTop: '8mm',
              borderTop: '0.5px solid #D6D3D1',
              gap: '12mm',
            }}
          >
            <div
              style={{
                fontSize: '8.5pt',
                color: '#57534E',
                lineHeight: 1.5,
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              <div
                style={{
                  color: '#1c1917',
                  fontWeight: 600,
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: '9pt',
                }}
              >
                {issuedAt}
              </div>
              <div style={{ marginTop: '1mm', fontWeight: 500 }}>
                {settings.general.city}
              </div>
              <div style={{ marginTop: '1.2mm', fontSize: '7.5pt', color: '#78716C' }}>
                Lëshuar nga sistemi Klinika · për arkivim të brendshëm
              </div>
            </div>
            <div
              style={{
                fontSize: '9pt',
                minWidth: '70mm',
                textAlign: 'right',
              }}
            >
              <div
                style={{
                  borderTop: '1px solid #1c1917',
                  paddingTop: '1.5mm',
                  width: '70mm',
                  marginLeft: 'auto',
                  marginTop: '14mm',
                }}
              />
              <div style={{ fontWeight: 600, fontSize: '10pt' }}>{doctorLabel || '—'}</div>
              {me?.title ? (
                <div style={{ color: '#57534E', fontSize: '8pt' }}>
                  {me.title}
                  {settings.general.shortName ? ` · ${settings.general.shortName}` : ''}
                </div>
              ) : null}
              <div
                style={{
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: '7pt',
                  color: '#78716C',
                  textTransform: 'uppercase',
                  letterSpacing: '0.08em',
                  marginTop: '1mm',
                }}
              >
                {signatureRoleLabel(me?.roles ?? [])}
              </div>
            </div>
          </footer>
        </article>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function MetaRow({ k, v }: { k: string; v: string }) {
  return (
    <div style={{ marginBottom: '0.6mm' }}>
      <span
        style={{
          color: '#A8A29E',
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          fontSize: '7pt',
          fontWeight: 500,
          marginRight: '2mm',
        }}
      >
        {k}
      </span>
      <span style={{ color: '#1c1917', fontWeight: 600 }}>{v}</span>
    </div>
  );
}

function StatCell({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone?: 'revenue';
}) {
  return (
    <div
      className="flex flex-col"
      style={{
        padding: '5mm 6mm',
        borderRight: '1px solid #E7E5E4',
        background: tone === 'revenue' ? '#F0FDFA' : 'transparent',
        gap: '1.5mm',
      }}
    >
      {children}
    </div>
  );
}

function StatLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="uppercase"
      style={{
        fontSize: '7.3pt',
        fontWeight: 700,
        color: '#0F766E',
        letterSpacing: '0.08em',
      }}
    >
      {children}
    </div>
  );
}

function StatFootNote({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        marginTop: 'auto',
        paddingTop: '1.5mm',
        fontSize: '7.5pt',
        color: '#78716C',
        fontVariantNumeric: 'tabular-nums',
      }}
    >
      {children}
    </div>
  );
}

function StatusLine({
  color,
  label,
  count,
}: {
  color: string;
  label: string;
  count: number;
}) {
  return (
    <div
      className="grid items-center"
      style={{ gridTemplateColumns: '5mm 1fr auto', gap: '2mm' }}
    >
      <span
        style={{
          width: '8px',
          height: '8px',
          borderRadius: '2px',
          background: color,
          display: 'block',
        }}
      />
      <span
        style={{
          color: '#1c1917',
          fontWeight: 500,
          fontSize: '9pt',
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontFamily: "'Inter Tight', sans-serif",
          fontWeight: 700,
          color: '#1c1917',
          fontSize: '11pt',
        }}
      >
        {count}
      </span>
    </div>
  );
}

function PrintTable({
  visits,
  total,
  paid,
  other,
}: {
  visits: DailyReportVisit[];
  total: number;
  paid: number;
  other: number;
}) {
  const now = useMemo(() => new Date(), []);
  return (
    <table
      className="w-full"
      style={{
        borderCollapse: 'collapse',
        fontVariantNumeric: 'tabular-nums',
        fontSize: '9pt',
      }}
    >
      <thead>
        <tr>
          <PrintTh w="14mm">Ora</PrintTh>
          <PrintTh>Pacienti</PrintTh>
          <PrintTh w="22mm">DL</PrintTh>
          <PrintTh w="28mm">Statusi</PrintTh>
          <PrintTh w="18mm" align="right">Pagesa</PrintTh>
          <PrintTh w="14mm">Kodi</PrintTh>
        </tr>
      </thead>
      <tbody>
        {visits.length === 0 ? (
          <tr>
            <td
              colSpan={6}
              style={{
                padding: '8mm 2mm',
                textAlign: 'center',
                color: '#78716C',
                fontSize: '9pt',
              }}
            >
              Nuk ka vizita për këtë ditë.
            </td>
          </tr>
        ) : null}
        {visits.map((v) => {
          const dimmed =
            v.status === 'no_show' ||
            v.status === 'scheduled' ||
            v.status === 'arrived' ||
            v.status === 'in_progress';
          return (
            <tr key={v.id}>
              <PrintTd
                style={{
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: '8.5pt',
                  color: '#57534E',
                }}
              >
                {v.time}
              </PrintTd>
              <PrintTd style={{ color: dimmed ? '#1c1917' : '#1c1917', fontWeight: 600 }}>
                {v.patient.firstName} {v.patient.lastName}
                {v.patient.dateOfBirth ? (
                  <span
                    style={{
                      color: '#A8A29E',
                      fontWeight: 400,
                      marginLeft: '1.5mm',
                      fontSize: '7.5pt',
                    }}
                  >
                    {ageLabel(v.patient.dateOfBirth, now)}
                  </span>
                ) : null}
                {v.isFirstVisit ? (
                  <span
                    style={{
                      display: 'block',
                      color: '#78716C',
                      fontWeight: 400,
                      fontSize: '7.5pt',
                      fontStyle: 'italic',
                      marginTop: '0.3mm',
                    }}
                  >
                    Vizita e parë
                  </span>
                ) : null}
              </PrintTd>
              <PrintTd
                style={{
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: '8pt',
                  color: dimmed ? '#78716C' : '#57534E',
                }}
              >
                {formatDl(v.patient.dateOfBirth)}
              </PrintTd>
              <PrintTd style={{ color: dimmed ? '#78716C' : undefined }}>
                <PrintChip status={v.status} />
              </PrintTd>
              <PrintTd
                align="right"
                style={{
                  fontFamily: "'Inter Tight', sans-serif",
                  fontWeight: 700,
                  color: '#1c1917',
                  fontSize: '10pt',
                  letterSpacing: '-0.01em',
                }}
              >
                {renderPrintPayment(v)}
              </PrintTd>
              <PrintTd
                align="center"
                style={{
                  fontFamily: "'JetBrains Mono', monospace",
                  fontWeight: 700,
                  color: '#1c1917',
                  fontSize: '9.5pt',
                }}
              >
                {v.paymentCode ?? <span style={{ color: '#C4C0BC', fontWeight: 400 }}>—</span>}
              </PrintTd>
            </tr>
          );
        })}
      </tbody>
      {visits.length > 0 ? (
        <tfoot>
          <tr>
            <td
              colSpan={2}
              style={{
                padding: '2.5mm 2mm 1.5mm',
                borderTop: '1.2px solid #1c1917',
                fontFamily: "'Inter', sans-serif",
                fontWeight: 500,
                color: '#57534E',
                textTransform: 'uppercase',
                letterSpacing: '0.06em',
                fontSize: '8pt',
              }}
            >
              Totali
            </td>
            <td
              colSpan={2}
              style={{
                padding: '2.5mm 2mm 1.5mm',
                borderTop: '1.2px solid #1c1917',
                fontFamily: "'JetBrains Mono', monospace",
                fontWeight: 400,
                color: '#78716C',
                fontSize: '7.5pt',
                textTransform: 'uppercase',
                letterSpacing: '0.06em',
                textAlign: 'right',
              }}
            >
              {paid} të paguara · {other} të tjera
            </td>
            <td
              style={{
                padding: '2.5mm 2mm 1.5mm',
                borderTop: '1.2px solid #1c1917',
                fontFamily: "'Inter Tight', sans-serif",
                fontWeight: 700,
                color: '#0F766E',
                fontSize: '14pt',
                textAlign: 'right',
                letterSpacing: '-0.015em',
              }}
            >
              {centsToEur(total)}
              <span
                style={{
                  fontFamily: "'Inter', sans-serif",
                  fontWeight: 600,
                  color: '#0F766E',
                  fontSize: '10pt',
                  marginLeft: '0.8mm',
                }}
              >
                €
              </span>
            </td>
            <td style={{ borderTop: '1.2px solid #1c1917' }}></td>
          </tr>
        </tfoot>
      ) : null}
    </table>
  );
}

function PrintTh({
  children,
  w,
  align,
}: {
  children: React.ReactNode;
  w?: string;
  align?: 'left' | 'right' | 'center';
}) {
  return (
    <th
      className="uppercase"
      style={{
        textAlign: align ?? 'left',
        fontFamily: "'Inter', sans-serif",
        fontSize: '7.5pt',
        fontWeight: 600,
        color: '#57534E',
        letterSpacing: '0.06em',
        padding: '1.8mm 2mm',
        borderBottom: '1px solid #1c1917',
        background: 'white',
        width: w,
      }}
    >
      {children}
    </th>
  );
}

function PrintTd({
  children,
  align,
  style,
}: {
  children: React.ReactNode;
  align?: 'left' | 'right' | 'center';
  style?: React.CSSProperties;
}) {
  return (
    <td
      style={{
        padding: '1.4mm 2mm',
        borderBottom: '0.5px solid #E7E5E4',
        verticalAlign: 'middle',
        textAlign: align ?? 'left',
        ...style,
      }}
    >
      {children}
    </td>
  );
}

function PrintChip({ status }: { status: DailyReportStatus }) {
  const color =
    status === 'completed'
      ? '#14532D'
      : status === 'no_show'
        ? '#92400E'
        : status === 'scheduled'
          ? '#3730A3'
          : '#155E75';
  const dot = STATUS_PRINT_SOLID[status];
  return (
    <span
      className="inline-flex items-center"
      style={{ gap: '1.2mm', fontSize: '8pt', fontWeight: 500, color }}
    >
      <span
        style={{
          width: '6px',
          height: '6px',
          borderRadius: '999px',
          background: dot,
          display: 'inline-block',
        }}
      />
      {chipLabel(status)}
    </span>
  );
}

function renderPrintPayment(v: DailyReportVisit): React.ReactNode {
  if (v.status !== 'completed' || v.paymentAmountCents == null) {
    return <span style={{ color: '#A8A29E', fontWeight: 400 }}>—</span>;
  }
  if (v.paymentCode === 'E') {
    return (
      <span style={{ color: '#78716C', fontStyle: 'italic', fontWeight: 500, fontSize: '8.5pt' }}>
        Falas
      </span>
    );
  }
  return <>{centsToEur(v.paymentAmountCents)} €</>;
}

function signatureRoleLabel(roles: readonly string[]): string {
  const label = primaryRoleFor(roles);
  if (!label) return 'Nënshkrimi';
  if (label === 'Mjeku') return 'Nënshkrimi i mjekut';
  if (label === 'Recepsioniste') return 'Nënshkrimi i recepsionistes';
  if (label === 'Administrator') return 'Nënshkrimi i administratorit';
  return 'Nënshkrimi';
}
