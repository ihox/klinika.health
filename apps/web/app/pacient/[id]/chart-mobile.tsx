'use client';

import * as React from 'react';
import { useEffect, useState, type ReactElement, type ReactNode } from 'react';

import { NavIcon } from '@/components/mobile/nav-icon';
import { ageLabel, formatDob, type PatientFullDto } from '@/lib/patient-client';
import type { ChartVisitDto } from '@/lib/patient-client';
import { cn } from '@/lib/utils';

/**
 * Adaptive chart body for tablet + phone (mobile handoff §11.2). Mounted by
 * ChartView only below desktop, so the desktop ≥1280 layout is untouched.
 * Reuses ChartView's already-built elements (visit form, growth + ultrazeri
 * panels) and orchestration — this component is presentation only.
 *
 *   - tablet landscape (1024–1279): split-pane — visit-list rail + detail.
 *   - phone + tablet portrait (<1024): single-pane drilldown — segmented
 *     tabs (Vizitat · Rritja · Ultrazëri · Të dhëna); tapping a visit opens
 *     the form full-screen with the bottom tab bar hidden.
 */
const CHART_TABS = [
  { id: 'visits', label: 'Vizitat' },
  { id: 'growth', label: 'Rritja' },
  { id: 'dicom', label: 'Ultrazëri' },
  { id: 'data', label: 'Të dhëna' },
] as const;
type ChartTab = (typeof CHART_TABS)[number]['id'];

interface ChartMobileBodyProps {
  isTabletLandscape: boolean;
  patient: PatientFullDto;
  visits: ChartVisitDto[];
  activeVisitId: string | null;
  onSelectVisit: (id: string) => void;
  onNewVisit: () => void;
  canNewVisit: boolean;
  visitForm: ReactElement;
  growthPanel: ReactElement;
  ultrazeriPanel: ReactElement | null;
  onEditMasterData: () => void;
}

export function ChartMobileBody(props: ChartMobileBodyProps): ReactElement {
  if (props.isTabletLandscape) {
    return <SplitPane {...props} />;
  }
  return <Drilldown {...props} />;
}

// ── Split-pane (tablet landscape) ────────────────────────────────────────────

function SplitPane({
  visits,
  activeVisitId,
  onSelectVisit,
  onNewVisit,
  canNewVisit,
  visitForm,
  growthPanel,
  ultrazeriPanel,
}: ChartMobileBodyProps): ReactElement {
  return (
    <div className="mx-auto grid max-w-page grid-cols-[300px_1fr] gap-5 px-[var(--m-gutter-lg)] pt-4">
      <aside className="flex flex-col">
        <div className="flex items-center justify-between px-1 pb-2">
          <h2 className="text-[13px] font-semibold text-ink-strong">Vizitat</h2>
          <span className="text-[12px] text-ink-muted">
            {visits.length} {visits.length === 1 ? 'vizitë' : 'vizita'}
          </span>
        </div>
        <div className="overflow-hidden rounded-lg border border-line bg-surface-elevated shadow-xs">
          <MobileVisitList visits={visits} activeVisitId={activeVisitId} onSelect={onSelectVisit} />
        </div>
        {canNewVisit ? (
          <button
            type="button"
            onClick={onNewVisit}
            className="mt-3 flex min-h-[44px] items-center justify-center gap-1.5 rounded-md border border-line-strong bg-surface-elevated text-[14px] font-medium text-ink transition hover:bg-surface-subtle"
          >
            <NavIcon name="plus" size={16} /> Vizitë e re
          </button>
        ) : null}
      </aside>
      <div className="flex flex-col gap-4 pb-28">
        {visitForm}
        {growthPanel}
        {ultrazeriPanel}
      </div>
    </div>
  );
}

// ── Drilldown (phone + tablet portrait) ──────────────────────────────────────

function Drilldown({
  patient,
  visits,
  activeVisitId,
  onSelectVisit,
  onNewVisit,
  canNewVisit,
  visitForm,
  growthPanel,
  ultrazeriPanel,
  onEditMasterData,
}: ChartMobileBodyProps): ReactElement {
  const [tab, setTab] = useState<ChartTab>('visits');
  const [detailOpen, setDetailOpen] = useState(false);

  // While the visit detail is open, hide the phone bottom tab bar so the
  // form's sticky action bar is reachable (full-screen takeover, §11.3).
  useEffect(() => {
    if (detailOpen) {
      document.body.dataset.hideTabbar = '1';
      return () => {
        delete document.body.dataset.hideTabbar;
      };
    }
    return undefined;
  }, [detailOpen]);

  // Visit detail (full-screen form within the Vizitat tab).
  if (tab === 'visits' && detailOpen) {
    return (
      <div className="mx-auto flex max-w-page flex-col px-[var(--m-gutter)] pt-2 md:px-[var(--m-gutter-lg)]">
        <button
          type="button"
          onClick={() => setDetailOpen(false)}
          className="-ml-2 mb-1 flex min-h-[44px] items-center gap-1 self-start rounded-md px-2 text-[14px] font-medium text-ink-muted transition active:bg-surface-subtle"
        >
          <NavIcon name="back" size={18} /> Vizitat
        </button>
        <div className="pb-28">{visitForm}</div>
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-page flex-col px-[var(--m-gutter)] md:px-[var(--m-gutter-lg)]">
      <ChartTabs tab={tab} onChange={setTab} visitCount={visits.length} />

      {tab === 'visits' ? (
        <div className="relative pt-3">
          <div className="overflow-hidden rounded-lg border border-line bg-surface-elevated shadow-xs">
            <MobileVisitList
              visits={visits}
              activeVisitId={activeVisitId}
              onSelect={(id) => {
                onSelectVisit(id);
                setDetailOpen(true);
              }}
            />
          </div>
          {canNewVisit ? (
            <button
              type="button"
              onClick={onNewVisit}
              aria-label="Vizitë e re"
              className="fixed bottom-[calc(var(--m-tabbar-h)+env(safe-area-inset-bottom,0px)+16px)] right-[var(--m-gutter)] z-30 grid h-14 w-14 place-items-center rounded-2xl bg-primary text-white shadow-lg transition active:scale-95"
            >
              <NavIcon name="plus" size={24} strokeWidth={2} />
            </button>
          ) : null}
        </div>
      ) : null}

      {tab === 'growth' ? <div className="pt-4">{growthPanel}</div> : null}

      {tab === 'dicom' ? (
        <div className="pt-4">
          {ultrazeriPanel ?? (
            <p className="px-1 py-6 text-center text-[13px] text-ink-muted">
              Zgjedh një vizitë për të parë ultrazërin.
            </p>
          )}
        </div>
      ) : null}

      {tab === 'data' ? (
        <div className="pt-4">
          <MobileDataTab patient={patient} onEdit={onEditMasterData} />
        </div>
      ) : null}
    </div>
  );
}

// ── Chart tab row ─────────────────────────────────────────────────────────────

function ChartTabs({
  tab,
  onChange,
  visitCount,
}: {
  tab: ChartTab;
  onChange: (t: ChartTab) => void;
  visitCount: number;
}): ReactElement {
  return (
    <div
      role="tablist"
      aria-label="Seksionet e kartelës"
      className="sticky top-[52px] z-10 -mx-[var(--m-gutter)] flex gap-1 overflow-x-auto border-b border-line bg-surface px-[var(--m-gutter)] py-2 [-ms-overflow-style:none] [scrollbar-width:none] md:top-[64px] md:-mx-[var(--m-gutter-lg)] md:px-[var(--m-gutter-lg)] [&::-webkit-scrollbar]:hidden"
    >
      {CHART_TABS.map((t) => {
        const active = tab === t.id;
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(t.id)}
            className={cn(
              'inline-flex min-h-[40px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-3.5 text-[14px] font-medium transition',
              active ? 'bg-primary-soft text-primary-dark' : 'text-ink-muted active:bg-surface-subtle',
            )}
          >
            {t.label}
            {t.id === 'visits' ? (
              <span
                className={cn(
                  'rounded-full px-1.5 py-px text-[11px] font-semibold tabular-nums',
                  active ? 'bg-primary/15 text-primary-dark' : 'bg-ink/[0.06] text-ink-muted',
                )}
              >
                {visitCount}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

// ── Visit list ────────────────────────────────────────────────────────────────

function MobileVisitList({
  visits,
  activeVisitId,
  onSelect,
}: {
  visits: ChartVisitDto[];
  activeVisitId: string | null;
  onSelect: (id: string) => void;
}): ReactElement {
  if (visits.length === 0) {
    return (
      <div className="px-4 py-8 text-center text-[13px] text-ink-muted">
        Asnjë vizitë e regjistruar.
      </div>
    );
  }
  return (
    <ul className="divide-y divide-line-soft">
      {visits.map((v) => {
        const active = v.id === activeVisitId;
        return (
          <li key={v.id}>
            <button
              type="button"
              onClick={() => onSelect(v.id)}
              aria-current={active ? 'true' : undefined}
              data-testid="mobile-visit-row"
              className={cn(
                'flex min-h-[56px] w-full items-center gap-3 px-4 py-2.5 text-left transition active:bg-surface-subtle [-webkit-tap-highlight-color:transparent]',
                active && 'border-l-2 border-l-primary bg-primary-soft/40 pl-[14px]',
              )}
            >
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  <span className="font-mono text-[12px] tabular-nums text-ink-strong">
                    {formatShortDate(v.visitDate)}
                  </span>
                  <VisitStatusChip status={v.status} />
                </span>
                <span className="mt-0.5 block truncate text-[12.5px] text-ink-muted">
                  {v.primaryDiagnosis ? (
                    <>
                      <strong className="font-semibold text-ink">
                        {v.primaryDiagnosis.code}
                      </strong>{' '}
                      {v.primaryDiagnosis.latinDescription}
                    </>
                  ) : v.legacyDiagnosis ? (
                    <span className="italic">{v.legacyDiagnosis}</span>
                  ) : (
                    'Pa diagnozë'
                  )}
                </span>
              </span>
              <NavIcon name="chevright" size={16} className="shrink-0 text-ink-faint" />
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function VisitStatusChip({ status }: { status: string }): ReactElement | null {
  const map: Record<string, { label: string; cls: string }> = {
    in_progress: { label: 'Në vijim', cls: 'bg-status-in-progress-bg text-status-in-progress-fg' },
    arrived: { label: 'Paraqitur', cls: 'bg-status-in-progress-bg text-status-in-progress-fg' },
    completed: { label: 'Kryer', cls: 'bg-status-completed-bg text-status-completed-fg' },
    no_show: { label: 'Mungesë', cls: 'bg-status-no-show-bg text-status-no-show-fg' },
    scheduled: { label: 'Planifikuar', cls: 'bg-status-scheduled-bg text-status-scheduled-fg' },
  };
  const s = map[status];
  if (!s) return null;
  return (
    <span className={cn('rounded-pill px-1.5 py-px text-[10.5px] font-medium', s.cls)}>
      {s.label}
    </span>
  );
}

// ── Të dhëna (read-only patient data) ────────────────────────────────────────

function MobileDataTab({
  patient,
  onEdit,
}: {
  patient: PatientFullDto;
  onEdit: () => void;
}): ReactElement {
  const sexLabel = patient.sex === 'm' ? 'Mashkull' : patient.sex === 'f' ? 'Femër' : '—';
  return (
    <div className="flex flex-col gap-4">
      <DataCard title="Të dhënat personale">
        <DataRow k="Emri i plotë" v={`${patient.firstName} ${patient.lastName}`} />
        <DataRow k="Gjinia" v={sexLabel} />
        <DataRow k="Datëlindja" v={`${formatDob(patient.dateOfBirth)}${ageLabel(patient.dateOfBirth) ? ` · ${ageLabel(patient.dateOfBirth)}` : ''}`} />
        <DataRow k="Vendlindja" v={patient.placeOfBirth || '—'} />
        <DataRow k="Telefoni" v={patient.phone || '—'} />
      </DataCard>
      <DataCard title="Të dhënat e lindjes">
        <DataRow k="Pesha e lindjes" v={patient.birthWeightG != null ? `${patient.birthWeightG} g` : '—'} />
        <DataRow k="Gjatësia e lindjes" v={patient.birthLengthCm != null ? `${patient.birthLengthCm} cm` : '—'} />
        <DataRow k="Perimetri i kokës" v={patient.birthHeadCircumferenceCm != null ? `${patient.birthHeadCircumferenceCm} cm` : '—'} />
      </DataCard>
      {patient.alergjiTjera ? (
        <DataCard title="Alergji / Tjera">
          <p className="px-4 py-3 text-[13px] text-ink">{patient.alergjiTjera}</p>
        </DataCard>
      ) : null}
      <button
        type="button"
        onClick={onEdit}
        className="flex min-h-[48px] items-center justify-center gap-1.5 rounded-md border border-line-strong bg-surface-elevated text-[14px] font-medium text-primary-dark transition active:bg-surface-subtle"
      >
        Të dhënat e pacientit
        <NavIcon name="chevright" size={16} />
      </button>
    </div>
  );
}

function DataCard({ title, children }: { title: string; children: ReactNode }): ReactElement {
  return (
    <section className="overflow-hidden rounded-lg border border-line bg-surface-elevated shadow-xs">
      <header className="border-b border-line px-4 py-2.5 text-[12.5px] font-semibold text-ink-strong">
        {title}
      </header>
      <div className="divide-y divide-line-soft">{children}</div>
    </section>
  );
}

function DataRow({ k, v }: { k: string; v: string }): ReactElement {
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-2.5">
      <span className="text-[12.5px] text-ink-muted">{k}</span>
      <span className="text-right text-[13.5px] text-ink-strong">{v}</span>
    </div>
  );
}

function formatShortDate(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split('-');
  if (!y || !m || !d) return iso;
  return `${d}.${m}.${y.slice(2)}`;
}
