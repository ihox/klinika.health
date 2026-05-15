'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react';

import { ClinicTopNav } from '@/components/clinic-top-nav';
import { EmptyState } from '@/components/empty-state';
import { NotificationToast } from '@/components/notification-toast';
import { ChangeHistoryModal } from '@/components/patient/change-history-modal';
import { DeleteVisitDialog } from '@/components/patient/delete-visit-dialog';
import { GrowthPanel } from '@/components/patient/growth-panel';
import { MasterDataStrip } from '@/components/patient/master-data-strip';
import { PrintHistoryDialog } from '@/components/patient/print-history-dialog';
import { SaveFailureDialog } from '@/components/patient/save-failure-dialog';
import { SetSexDialog } from '@/components/patient/set-sex-dialog';
import { UltrazeriPanel } from '@/components/patient/ultrazeri-panel';
import { VertetimDialog } from '@/components/patient/vertetim-dialog';
import { VisitForm } from '@/components/patient/visit-form';
import { Skeleton } from '@/components/skeleton';
import { Button } from '@/components/ui/button';
import { UndoToast } from '@/components/undo-toast';
import { ApiError } from '@/lib/api';
import { useMe } from '@/lib/use-me';
import { calendarClient } from '@/lib/visits-calendar-client';
import { ageInMonths } from '@/lib/growth-chart';
import { masterDataPath } from '@/lib/patient';
import {
  ageLabelChart,
  formatDob,
  patientClient,
  type ChartGrowthPointDto,
  type ChartVertetimDto,
  type ChartVisitDto,
  type PatientChartDto,
  type PatientFullDto,
} from '@/lib/patient-client';
import { openPrintFrame } from '@/lib/print-frame';
import { useAutoSaveStore } from '@/lib/use-visit-autosave';
import { printUrls, type VertetimDto } from '@/lib/vertetim-client';
import { canCompleteVisit, canRevertStatus } from '@/lib/visit-actions';
import { type VisitDto, visitClient } from '@/lib/visit-client';
import { cn } from '@/lib/utils';

const HISTORY_COMPACT_LIMIT = 10;

interface Props {
  patientId: string;
  /** Optional pre-selected visit id from the `/vizita/:visitId` URL. */
  initialVisitId?: string;
}

/**
 * Patient chart shell — doctor's working surface.
 *
 * URL layout:
 *   /pacient/:id              — defaults to the most recent visit
 *   /pacient/:id/vizita/:vid  — specific visit
 *
 * Navigation between visits updates the URL via shallow-style
 * `router.replace` so the doctor can deep-link or browser-back
 * without losing context.
 *
 * The form area on the left is intentionally a placeholder in this
 * slice — slice 12 fills it in. Right column carries the static
 * stubs that the rest of the chart cards (growth charts, ultrazeri,
 * history list, vërtetime list) need so the navigation pieces can
 * be wired up end-to-end.
 */
export function ChartView({ patientId, initialVisitId }: Props): ReactElement {
  const router = useRouter();
  const [data, setData] = useState<PatientChartDto | null>(null);
  const [error, setError] = useState<'forbidden' | 'not-found' | 'unknown' | null>(null);
  const [activeVisitId, setActiveVisitId] = useState<string | null>(initialVisitId ?? null);
  const [activeVisit, setActiveVisit] = useState<VisitDto | null>(null);
  const [historyOpenForVisit, setHistoryOpenForVisit] = useState<VisitDto | null>(null);
  const [pendingDelete, setPendingDelete] = useState<{
    visit: VisitDto;
    restorableUntil: string;
  } | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [showAllHistory, setShowAllHistory] = useState(false);
  const [setSexOpen, setSetSexOpen] = useState(false);
  const [vertetimDialogOpen, setVertetimDialogOpen] = useState(false);
  const [printHistoryOpen, setPrintHistoryOpen] = useState(false);
  const [statusToast, setStatusToast] = useState<{ id: string; message: string } | null>(null);
  const { me } = useMe();

  const refresh = useCallback(async () => {
    try {
      const res = await patientClient.getChart(patientId);
      setData(res);
    } catch {
      // Silent — surfaced via the same UI states as the initial load
      // if it fails again on the next attempt.
    }
  }, [patientId]);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    setData(null);
    (async () => {
      try {
        const res = await patientClient.getChart(patientId);
        if (!cancelled) setData(res);
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError) {
          if (err.status === 401) {
            window.location.href = '/login?reason=session-expired';
            return;
          }
          if (err.status === 403) setError('forbidden');
          else if (err.status === 404) setError('not-found');
          else setError('unknown');
        } else {
          setError('unknown');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [patientId]);

  // Redirect to the master-data form when the patient is missing any
  // of the four required fields (firstName, lastName, dateOfBirth,
  // sex). The chart cannot render meaningfully for an incomplete
  // patient — no growth charts, no print, no vërtetim. Doctors land
  // here either by deep link (a stale URL from before the patient
  // was completed) or by edits in another tab that cleared a field.
  //
  // `router.replace` so the browser history doesn't carry an empty
  // chart entry the back button would land on.
  useEffect(() => {
    if (!data) return;
    if (!data.patient.isComplete) {
      router.replace(masterDataPath(patientId));
    }
  }, [data, patientId, router]);

  // Default to the most-recent visit when no explicit visit id is in
  // the URL. Reflect the resolved visit in the URL via the History
  // API (NOT `router.replace`) so the chart shell doesn't re-mount
  // across visit switches — Next.js treats `/pacient/:id` and
  // `/pacient/:id/vizita/:vid` as separate routes, but they render
  // the same `ChartView`, so we keep all client state in place.
  useEffect(() => {
    if (!data) return;
    if (data.visits.length === 0) {
      if (activeVisitId !== null) setActiveVisitId(null);
      return;
    }
    const matches = activeVisitId
      ? data.visits.find((v) => v.id === activeVisitId)
      : null;
    if (!matches) {
      const first = data.visits[0]!;
      setActiveVisitId(first.id);
      replaceUrl(`/pacient/${patientId}/vizita/${first.id}`);
    }
  }, [data, activeVisitId, patientId]);

  const activeIndex = useMemo(() => {
    if (!data || !activeVisitId) return -1;
    return data.visits.findIndex((v) => v.id === activeVisitId);
  }, [data, activeVisitId]);

  const navigateVisit = useCallback(
    (visitId: string) => {
      setActiveVisitId(visitId);
      replaceUrl(`/pacient/${patientId}/vizita/${visitId}`);
    },
    [patientId],
  );

  // Fetch the full visit record (auto-save target) whenever the
  // active visit id changes. The chart bundle only carries a lean
  // visit list — the form needs the full record (every clinical
  // field) to render. Switching visits triggers a save flush so the
  // user's edits to the previous visit aren't dropped.
  useEffect(() => {
    if (!activeVisitId) {
      setActiveVisit(null);
      return;
    }
    let cancelled = false;
    setActiveVisit(null);
    (async () => {
      try {
        const res = await visitClient.getOne(activeVisitId);
        if (!cancelled) setActiveVisit(res.visit);
      } catch (err) {
        if (cancelled) return;
        // Silent: the chart view shows a placeholder rather than the
        // form when this fails. The chart bundle is the source of
        // truth for "the visit exists" — fetching the row should
        // not normally fail.
        void err;
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeVisitId]);

  // When the patient changes (different chart), reset the auto-save
  // store so a half-edited form from a previous patient doesn't leak.
  useEffect(() => {
    return () => {
      useAutoSaveStore.getState().reset();
    };
  }, [patientId]);

  // ← / → arrow keys jump between visits. Skip when focus is on an
  // editable element so the doctor's free-text typing isn't hijacked.
  useEffect(() => {
    if (!data) return;
    function onKey(e: KeyboardEvent): void {
      if (isEditableTarget(e.target)) return;
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      if (!data) return;
      if (activeIndex === -1) return;
      // Visits are sorted newest-first; ← moves to the previous
      // (older) visit, → to the next (newer) one.
      if (e.key === 'ArrowLeft') {
        const next = data.visits[activeIndex + 1];
        if (next) {
          e.preventDefault();
          navigateVisit(next.id);
        }
      } else {
        const prev = data.visits[activeIndex - 1];
        if (prev) {
          e.preventDefault();
          navigateVisit(prev.id);
        }
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [data, activeIndex, navigateVisit]);

  if (error === 'forbidden') {
    return <ForbiddenChart />;
  }
  if (error === 'not-found') {
    return <NotFoundChart />;
  }
  if (error === 'unknown') {
    return <UnknownErrorChart />;
  }

  return (
    // pb-12 (was pb-24): the action bar is inline within VisitForm now,
    // not the prototype's fixed bottom bar, so we don't need the 96px
    // clearance — pb-12 is plain page-bottom breathing room.
    <main className="min-h-screen bg-surface pb-12">
      <ChartTopBar me={me} />

      {historyOpenForVisit ? (
        <ChangeHistoryModal
          visitId={historyOpenForVisit.id}
          visitDate={historyOpenForVisit.visitDate}
          patientName={
            data
              ? `${data.patient.firstName} ${data.patient.lastName}`
              : ''
          }
          onClose={() => setHistoryOpenForVisit(null)}
        />
      ) : null}

      <SaveFailureDialog />

      {pendingDelete ? (
        <UndoToast
          message="Vizita u fshi."
          secondary={formatDeleteSecondary(pendingDelete.visit)}
          onUndo={() => void undoDelete(pendingDelete.visit.id, refresh)}
          onDismiss={() => setPendingDelete(null)}
        />
      ) : null}

      {statusToast ? (
        <NotificationToast
          key={statusToast.id}
          message={statusToast.message}
          onDismiss={() => setStatusToast(null)}
        />
      ) : null}

      <DeleteVisitDialog
        open={deleteDialogOpen}
        busy={deleteBusy}
        onClose={() => {
          if (!deleteBusy) setDeleteDialogOpen(false);
        }}
        onConfirm={(reason) => {
          if (!activeVisit) return;
          void confirmDelete(
            activeVisit,
            reason,
            setPendingDelete,
            setDeleteDialogOpen,
            setDeleteBusy,
            refresh,
          );
        }}
      />

      {data == null ? (
        <ChartSkeleton />
      ) : (
        <>
          <div className="sticky top-[60px] z-20 border-b border-line bg-surface-elevated">
            <div className="mx-auto max-w-page px-page-x">
              <MasterDataStrip
                patient={data.patient}
                daysSinceLastVisit={data.daysSinceLastVisit}
                visitCount={data.visitCount}
                onEditMasterData={() => router.push(masterDataPath(patientId))}
              />
            </div>
          </div>

          {data.visits.length === 0 ? (
            <EmptyVisitsState
              patientId={patientId}
              onCreateVisit={() => void createNewVisit(patientId, navigateVisit, refresh)}
            />
          ) : (
            <>
              <VisitNav
                visits={data.visits}
                activeIndex={activeIndex}
                onSelect={navigateVisit}
              />

              <div className="mx-auto grid max-w-page grid-cols-1 gap-6 px-page-x pt-5 lg:grid-cols-[60fr_40fr]">
                {activeVisit ? (
                  <VisitForm
                    visit={activeVisit}
                    patientName={`${data.patient.firstName} ${data.patient.lastName}`}
                    visitNumber={data.visits.length - activeIndex}
                    totalVisits={data.visits.length}
                    daysSincePrevious={daysSincePreviousFor(data.visits, activeIndex)}
                    onOpenHistory={() => setHistoryOpenForVisit(activeVisit)}
                    onDeleteRequest={() => setDeleteDialogOpen(true)}
                    onNewVisitRequest={() =>
                      void createNewVisit(patientId, navigateVisit, refresh)
                    }
                    onPrintVisitReport={() =>
                      void printVisitReport(activeVisit)
                    }
                    onIssueVertetim={() => setVertetimDialogOpen(true)}
                    onPrintHistory={() => setPrintHistoryOpen(true)}
                    onCompleteVisit={
                      canCompleteVisit(activeVisit, me?.roles ?? [])
                        ? () =>
                            void completeVisit(
                              activeVisit,
                              setActiveVisit,
                              setStatusToast,
                              refresh,
                            )
                        : undefined
                    }
                    onRevertStatus={
                      canRevertStatus(activeVisit, me?.roles ?? [])
                        ? () =>
                            void revertStatus(
                              activeVisit,
                              setActiveVisit,
                              setStatusToast,
                              refresh,
                            )
                        : undefined
                    }
                  />
                ) : (
                  <VisitFormLoading />
                )}

                <RightColumn
                  patient={data.patient}
                  growthPoints={data.growthPoints}
                  visits={data.visits}
                  vertetime={data.vertetime}
                  activeVisitId={activeVisitId}
                  activeVisitDate={activeVisit?.visitDate ?? null}
                  showAllHistory={showAllHistory}
                  onToggleHistory={() => setShowAllHistory((s) => !s)}
                  onSelectVisit={navigateVisit}
                  onRequestSetSex={() => setSetSexOpen(true)}
                  onViewVertetim={(v) => viewVertetim(v.id)}
                  onReprintVertetim={(v) => reprintVertetim(v.id)}
                />
              </div>
            </>
          )}
          {data ? (
            <SetSexDialog
              open={setSexOpen}
              patient={data.patient}
              onClose={() => setSetSexOpen(false)}
              onSaved={(updated) => {
                setSetSexOpen(false);
                setData((d) => (d ? { ...d, patient: updated } : d));
              }}
            />
          ) : null}
          {data && activeVisit ? (
            <VertetimDialog
              open={vertetimDialogOpen}
              patient={data.patient}
              visit={activeVisit}
              primaryDiagnosis={
                activeVisit.diagnoses[0]
                  ? {
                      code: activeVisit.diagnoses[0].code,
                      latinDescription: activeVisit.diagnoses[0].latinDescription,
                    }
                  : null
              }
              onClose={() => setVertetimDialogOpen(false)}
              onIssued={(issued) => onVertetimIssued(issued, setData)}
            />
          ) : null}
          {data ? (
            <PrintHistoryDialog
              open={printHistoryOpen}
              patient={data.patient}
              ultrasoundImageCount={0}
              onClose={() => setPrintHistoryOpen(false)}
            />
          ) : null}
        </>
      )}
    </main>
  );
}

// =========================================================================
// Top bar (mirrors the doctor dashboard's layout for visual continuity)
// =========================================================================

function ChartTopBar({
  me,
}: {
  me: ReturnType<typeof useMe>['me'];
}): ReactElement {
  // Role-filtered nav (ADR-004). The chart view lives under
  // /pacient/[id], which `ClinicTopNav` matches as part of the
  // "Pacientët" item via its `activePrefixes` list. `me` is hoisted to
  // the parent so adjacent role-gated affordances share the same fetch.
  return <ClinicTopNav me={me} />;
}

// =========================================================================
// Visit navigation bar
// =========================================================================

interface VisitNavProps {
  visits: ChartVisitDto[];
  activeIndex: number;
  onSelect: (visitId: string) => void;
}

function VisitNav({ visits, activeIndex, onSelect }: VisitNavProps): ReactElement {
  // Visits are newest-first; the human-readable counter wants
  // oldest-first numbering ("Vizita 4 nga 12" = 4th from the start).
  const totalVisits = visits.length;
  const displayedNumber = activeIndex >= 0 ? totalVisits - activeIndex : 0;
  const isAtNewest = activeIndex <= 0;
  const isAtOldest = activeIndex >= totalVisits - 1;
  const prevVisit = visits[activeIndex + 1] ?? null; // older
  const nextVisit = visits[activeIndex - 1] ?? null; // newer

  const sincePrevious = useMemo(() => {
    const current = visits[activeIndex];
    if (!current || !prevVisit) return null;
    return daysBetweenIso(prevVisit.visitDate, current.visitDate);
  }, [visits, activeIndex, prevVisit]);

  return (
    <div className="border-b border-line bg-surface-subtle">
      <div className="mx-auto flex max-w-page flex-wrap items-center justify-between gap-3 px-page-x py-3">
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            className="inline-flex h-8 items-center gap-1 rounded-md px-2.5 text-[13px] text-ink-muted enabled:hover:bg-surface-elevated enabled:hover:text-ink disabled:opacity-40"
            disabled={!prevVisit}
            onClick={() => prevVisit && onSelect(prevVisit.id)}
            aria-label="Vizita paraprake"
            title="Vizita paraprake (←)"
          >
            ← Paraprake
          </button>
          <div className="font-display text-[14px] font-semibold tabular-nums">
            Vizita{' '}
            <span className="text-ink-strong">{displayedNumber}</span>{' '}
            <span className="text-ink-muted">nga {totalVisits}</span>
          </div>
          <select
            aria-label="Zgjidh vizitën"
            value={visits[activeIndex]?.id ?? ''}
            onChange={(e) => onSelect(e.target.value)}
            className="h-8 rounded-sm border border-line-strong bg-surface-elevated px-2 text-[12.5px] text-ink"
          >
            {visits.map((v, idx) => (
              <option key={v.id} value={v.id}>
                {formatDob(v.visitDate)}
                {v.primaryDiagnosis
                  ? ` — ${v.primaryDiagnosis.latinDescription}`
                  : v.legacyDiagnosis
                    ? ` — ${truncate(v.legacyDiagnosis, 32)}`
                    : idx === 0
                      ? ' — vizita më e re'
                      : ''}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="inline-flex h-8 items-center gap-1 rounded-md px-2.5 text-[13px] text-ink-muted enabled:hover:bg-surface-elevated enabled:hover:text-ink disabled:opacity-40"
            disabled={!nextVisit}
            onClick={() => nextVisit && onSelect(nextVisit.id)}
            aria-label="Vizita e ardhshme"
            title="Vizita e ardhshme (→)"
          >
            Ardhshme →
          </button>

          {sincePrevious != null ? (
            <span className="border-l border-line pl-3 text-[12px] text-ink-muted">
              Nga vizita paraprake:{' '}
              <strong className="font-medium text-ink">
                {sincePrevious} {sincePrevious === 1 ? 'ditë' : 'ditë'}
              </strong>
            </span>
          ) : null}
        </div>

        <div className="text-[11px] text-ink-faint">
          {isAtNewest ? 'Vizita më e re' : isAtOldest ? 'Vizita më e vjetër' : ''}
        </div>
      </div>
    </div>
  );
}

// =========================================================================
// Visit form area — loading-state placeholder while the full visit
// record is fetched. The real `VisitForm` mounts as soon as the data
// lands; the auto-save store is reset on patient changes.
// =========================================================================

function VisitFormLoading(): ReactElement {
  return (
    <section
      aria-label="Forma e vizitës"
      className="overflow-hidden rounded-lg border border-line bg-surface-elevated shadow-xs"
    >
      <div className="border-b border-line px-5 py-3.5">
        <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-muted">
          Vizita
        </div>
        <div className="mt-2 h-3 w-40 rounded-sm bg-surface-subtle" />
      </div>
      <div className="space-y-3 px-5 py-5">
        <div className="h-3 w-24 rounded-sm bg-surface-subtle" />
        <div className="h-24 rounded-md bg-surface-subtle" />
        <div className="h-24 rounded-md bg-surface-subtle" />
        <div className="h-16 rounded-md bg-surface-subtle" />
      </div>
    </section>
  );
}

// =========================================================================
// Right column — context panels (stubs for this slice)
// =========================================================================

interface RightColumnProps {
  patient: PatientFullDto;
  growthPoints: ChartGrowthPointDto[];
  visits: ChartVisitDto[];
  vertetime: ChartVertetimDto[];
  activeVisitId: string | null;
  activeVisitDate: string | null;
  showAllHistory: boolean;
  onToggleHistory: () => void;
  onSelectVisit: (id: string) => void;
  onRequestSetSex: () => void;
  onViewVertetim: (v: ChartVertetimDto) => void;
  onReprintVertetim: (v: ChartVertetimDto) => void;
}

function RightColumn({
  patient,
  growthPoints,
  visits,
  vertetime,
  activeVisitId,
  activeVisitDate,
  showAllHistory,
  onToggleHistory,
  onSelectVisit,
  onRequestSetSex,
  onViewVertetim,
  onReprintVertetim,
}: RightColumnProps): ReactElement {
  const ageMonths = ageInMonths(patient.dateOfBirth);
  const patientFullName = `${patient.firstName} ${patient.lastName}`;
  return (
    <aside aria-label="Konteksti klinik" className="flex flex-col gap-4">
      <GrowthPanel
        patient={patient}
        ageMonths={ageMonths}
        growthPoints={growthPoints}
        onRequestSetSex={onRequestSetSex}
      />
      {activeVisitId && activeVisitDate ? (
        <UltrazeriPanel
          visitId={activeVisitId}
          visitDateIso={activeVisitDate}
          patientName={patientFullName}
        />
      ) : null}
      <HistoryPanel
        visits={visits}
        activeVisitId={activeVisitId}
        showAll={showAllHistory}
        onToggle={onToggleHistory}
        onSelectVisit={onSelectVisit}
      />
      <VertetimePanel
        vertetime={vertetime}
        onView={onViewVertetim}
        onReprint={onReprintVertetim}
      />
    </aside>
  );
}

// =========================================================================
// History list (compact, jump-to)
// =========================================================================

interface HistoryPanelProps {
  visits: ChartVisitDto[];
  activeVisitId: string | null;
  showAll: boolean;
  onToggle: () => void;
  onSelectVisit: (id: string) => void;
}

function HistoryPanel({
  visits,
  activeVisitId,
  showAll,
  onToggle,
  onSelectVisit,
}: HistoryPanelProps): ReactElement {
  const slice = showAll ? visits : visits.slice(0, HISTORY_COMPACT_LIMIT);
  const hidden = visits.length - slice.length;
  return (
    <section
      aria-label="Historia e vizitave"
      className="overflow-hidden rounded-lg border border-line bg-surface-elevated shadow-xs"
    >
      <header className="flex items-center justify-between border-b border-line px-4 py-2.5">
        <h3 className="text-[12.5px] font-semibold text-ink-strong">
          Historia e shkurtër
        </h3>
        <span className="text-[11px] text-ink-faint">
          {visits.length} {visits.length === 1 ? 'vizitë' : 'vizita'}
        </span>
      </header>
      <ul className="divide-y divide-line-soft">
        {slice.map((v) => (
          <li key={v.id}>
            <button
              type="button"
              onClick={() => onSelectVisit(v.id)}
              aria-current={v.id === activeVisitId ? 'true' : undefined}
              className={cn(
                'grid w-full grid-cols-[68px_1fr_auto] items-center gap-2 px-4 py-2 text-left transition hover:bg-surface-subtle',
                v.id === activeVisitId &&
                  'border-l-2 border-l-primary bg-primary-soft/40 pl-[14px]',
              )}
            >
              <span className="font-mono text-[11px] tabular-nums text-ink-muted">
                {formatShortDate(v.visitDate)}
              </span>
              <span className="min-w-0 truncate text-[12px] text-ink">
                {v.primaryDiagnosis ? (
                  <>
                    <strong className="font-semibold text-ink-strong">
                      {v.primaryDiagnosis.code}
                    </strong>{' '}
                    {v.primaryDiagnosis.latinDescription}
                  </>
                ) : v.legacyDiagnosis ? (
                  <span className="italic text-ink-muted">
                    {truncate(v.legacyDiagnosis, 48)}
                  </span>
                ) : (
                  <span className="text-ink-faint">Pa diagnozë</span>
                )}
              </span>
              <span className="font-mono text-[11px] tabular-nums text-ink-muted">
                {v.paymentCode ?? '—'}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {hidden > 0 ? (
        <button
          type="button"
          onClick={onToggle}
          className="block w-full border-t border-line-soft py-2 text-center text-[12px] font-medium text-primary hover:underline"
        >
          {showAll ? 'Shfaq më pak' : `Shfaq më shumë (${hidden})`}
        </button>
      ) : null}
    </section>
  );
}

// =========================================================================
// Vërtetime list
// =========================================================================

interface VertetimePanelProps {
  vertetime: ChartVertetimDto[];
  onView: (v: ChartVertetimDto) => void;
  onReprint: (v: ChartVertetimDto) => void;
}

function VertetimePanel({ vertetime, onView, onReprint }: VertetimePanelProps): ReactElement {
  return (
    <section
      aria-label="Vërtetime të lëshuara"
      className="overflow-hidden rounded-lg border border-line bg-surface-elevated shadow-xs"
    >
      <header className="flex items-center justify-between border-b border-line px-4 py-2.5">
        <h3 className="text-[12.5px] font-semibold text-ink-strong">Vërtetime</h3>
        <span className="text-[11px] text-ink-faint">{vertetime.length}</span>
      </header>
      {vertetime.length === 0 ? (
        <div className="px-4 py-5 text-[12.5px] italic text-ink-muted">
          Asnjë vërtetim i lëshuar për këtë pacient
        </div>
      ) : (
        <ul className="divide-y divide-line-soft">
          {vertetime.map((c) => (
            <li
              key={c.id}
              className="grid grid-cols-[68px_1fr_auto] items-start gap-3 px-4 py-2.5"
            >
              <span className="font-mono text-[11px] font-semibold tabular-nums text-ink-strong">
                {formatShortDate(c.issuedAt.slice(0, 10))}
              </span>
              <div className="min-w-0">
                <div className="text-[12.5px] tabular-nums text-ink">
                  {formatDob(c.absenceFrom)} – {formatDob(c.absenceTo)}{' '}
                  <span className="text-ink-muted">
                    · {c.durationDays} {c.durationDays === 1 ? 'ditë' : 'ditë'}
                  </span>
                </div>
                <div className="truncate text-[11.5px] text-ink-muted">
                  {c.diagnosisSnapshot}
                </div>
              </div>
              <div className="flex items-center gap-1">
                <IconButton
                  label="Shiko"
                  title="Shiko vërtetimin"
                  data-testid={`vertetim-view-${c.id}`}
                  onClick={() => onView(c)}
                >
                  <EyeIcon />
                </IconButton>
                <IconButton
                  label="Printo"
                  title="Printo vërtetimin"
                  data-testid={`vertetim-reprint-${c.id}`}
                  onClick={() => onReprint(c)}
                >
                  <PrinterIcon />
                </IconButton>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function IconButton({
  children,
  label,
  ...rest
}: {
  children: ReactElement;
  label: string;
} & React.ButtonHTMLAttributes<HTMLButtonElement>): ReactElement {
  return (
    <button
      type="button"
      aria-label={label}
      className="grid h-8 w-8 place-items-center rounded-sm text-ink-muted enabled:hover:bg-surface-subtle enabled:hover:text-primary disabled:cursor-not-allowed"
      {...rest}
    >
      {children}
    </button>
  );
}

// (Sticky bottom action bar removed — the action bar now lives inside
// VisitForm so the auto-save state indicator is co-located with the
// fields. The "Vizitë e re" + "Fshij vizitën" buttons are wired
// through VisitForm props.)

// =========================================================================
// States
// =========================================================================

function ChartSkeleton(): ReactElement {
  return (
    <>
      {/* Master strip skeleton — mirrors loading-skeletons.html §8.1 */}
      <div className="border-b border-line bg-surface-elevated">
        <div className="mx-auto flex max-w-page items-center gap-6 px-page-x py-4">
          <Skeleton className="h-[22px] w-20" />
          <div className="flex flex-col gap-1.5">
            <Skeleton className="h-[22px] w-[220px]" />
            <Skeleton className="h-3 w-40" />
          </div>
          <span className="h-11 w-px bg-line" />
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="flex flex-col gap-1.5">
              <Skeleton className="h-[10px] w-16" />
              <Skeleton className="h-[18px] w-14" />
            </div>
          ))}
          <span className="flex-1" />
          <Skeleton className="h-8 w-[120px] rounded-sm" />
        </div>
      </div>
      {/* Visit area skeleton — boxed columns, no spinner */}
      <div className="mx-auto grid max-w-page grid-cols-1 gap-6 px-page-x pt-5 lg:grid-cols-[60fr_40fr]">
        <div className="overflow-hidden rounded-lg border border-line bg-surface-elevated">
          <div className="space-y-4 px-5 py-5">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-24" />
            <Skeleton className="h-24" />
            <Skeleton className="h-16" />
          </div>
        </div>
        <div className="flex flex-col gap-4">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="overflow-hidden rounded-lg border border-line bg-surface-elevated"
            >
              <div className="space-y-3 px-4 py-4">
                <Skeleton className="h-3 w-32" />
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-2/3" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

function EmptyVisitsState({
  onCreateVisit,
}: {
  patientId: string;
  onCreateVisit: () => void;
}): ReactElement {
  return (
    <div className="mx-auto max-w-page px-page-x py-12">
      <EmptyState
        title="Asnjë vizitë e regjistruar"
        subtitle={<>Shtoni të parën për këtë pacient.</>}
        icon={
          <svg
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <rect x="4" y="5" width="16" height="15" rx="2" />
            <path d="M8 3v4M16 3v4M4 10h16" />
          </svg>
        }
        actions={<Button onClick={onCreateVisit}>+ Vizitë e re</Button>}
      />
    </div>
  );
}

function ForbiddenChart(): ReactElement {
  return (
    <main className="grid min-h-screen place-items-center bg-surface px-6 py-10">
      <EmptyState
        tall
        tone="amber"
        code="Gabim 403"
        title="Ju nuk keni qasje në këtë seksion"
        subtitle="Kartelat e pacientëve janë të dukshme vetëm për mjekun."
        icon={
          <svg
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <rect x="5" y="10" width="14" height="11" rx="2" />
            <path d="M8 10V7a4 4 0 0 1 8 0v3" />
          </svg>
        }
        actions={
          <Link
            href="/"
            className="rounded-md border border-line-strong bg-surface-elevated px-3.5 py-2 text-[13px] font-medium text-ink hover:bg-surface-subtle"
          >
            Kthehu mbrapa
          </Link>
        }
      />
    </main>
  );
}

function NotFoundChart(): ReactElement {
  return (
    <main className="grid min-h-screen place-items-center bg-surface px-6 py-10">
      <EmptyState
        tall
        code="Gabim 404"
        title="Pacienti nuk u gjet"
        subtitle="Linku mund të jetë i vjetëruar."
        icon={
          <svg
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <circle cx="11" cy="11" r="7" />
            <path d="M16 16l5 5" />
          </svg>
        }
        actions={
          <Link
            href="/doctor"
            className="rounded-md bg-teal-600 px-3.5 py-2 text-[13px] font-medium text-white hover:bg-teal-700"
          >
            Te pamja e ditës
          </Link>
        }
      />
    </main>
  );
}

function UnknownErrorChart(): ReactElement {
  return (
    <main className="grid min-h-screen place-items-center bg-surface px-6 py-10">
      <EmptyState
        tall
        tone="amber"
        title="Diçka shkoi keq"
        subtitle="Provoni përsëri pasi lidhja kthehet."
        icon={
          <svg
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <path d="M12 8v5M12 16.5v.01" />
            <circle cx="12" cy="12" r="9" />
          </svg>
        }
        actions={
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="rounded-md bg-teal-600 px-3.5 py-2 text-[13px] font-medium text-white hover:bg-teal-700"
          >
            Provo përsëri
          </button>
        }
      />
    </main>
  );
}

// =========================================================================
// Helpers
// =========================================================================

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName.toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
  if (target.isContentEditable) return true;
  return false;
}

function replaceUrl(path: string): void {
  if (typeof window === 'undefined') return;
  window.history.replaceState(window.history.state, '', path);
}

function formatShortDate(iso: string): string {
  // dd.MM.yy — used in the dense history & vërtetime rows.
  const [y, m, d] = iso.split('-');
  if (!y || !m || !d) return iso;
  return `${d}.${m}.${y.slice(2)}`;
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

function daysBetweenIso(earlierIso: string, laterIso: string): number {
  const a = new Date(`${earlierIso}T00:00:00Z`).getTime();
  const b = new Date(`${laterIso}T00:00:00Z`).getTime();
  return Math.max(0, Math.round((b - a) / 86_400_000));
}

function EyeIcon(): ReactElement {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function PrinterIcon(): ReactElement {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M6 9V2h12v7" />
      <rect x="6" y="14" width="12" height="8" />
      <path d="M6 18H2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5h-4" />
    </svg>
  );
}

// `ageLabelChart` is exported from patient-client.ts but we re-export
// it here so the chart-shell module is a one-stop import for any
// downstream consumer (e.g. unit tests).
export { ageLabelChart };

// =========================================================================
// Visit lifecycle helpers
// =========================================================================
//
// Kept here (not in patient-client.ts) because they orchestrate
// fetches across visit + chart endpoints + local store state. The
// chart-view's effect hooks call these and don't need to coordinate
// the state themselves.

async function createNewVisit(
  patientId: string,
  navigateVisit: (visitId: string) => void,
  refresh: () => Promise<void>,
): Promise<void> {
  // Flush the auto-save store before navigating away from the current
  // visit so the doctor's pending edits land server-side first.
  await useAutoSaveStore.getState().save();
  try {
    const res = await visitClient.create(patientId);
    await refresh();
    navigateVisit(res.visit.id);
  } catch {
    // Surface as a generic error — the form's auto-save state will
    // catch any future PATCH issues, but creation is rare enough to
    // not warrant its own dialog yet.
    if (typeof window !== 'undefined') {
      // eslint-disable-next-line no-alert
      window.alert('Vizita e re nuk u krijua. Provoni përsëri.');
    }
  }
}

/**
 * Soft-delete the active visit after the doctor confirms in the
 * Fshij vizitën dialog. The dialog supplies an optional "Pse?" reason
 * which rides into the audit log via the request body.
 *
 * Flushes the auto-save first so any in-flight edits land on the row
 * before the delete (they're still recoverable via the 30s undo, but
 * the audit history reads cleaner this way).
 */
async function confirmDelete(
  visit: VisitDto,
  reason: string,
  setPendingDelete: (value: { visit: VisitDto; restorableUntil: string } | null) => void,
  setDeleteDialogOpen: (open: boolean) => void,
  setDeleteBusy: (busy: boolean) => void,
  refresh: () => Promise<void>,
): Promise<void> {
  await useAutoSaveStore.getState().save();
  setDeleteBusy(true);
  try {
    const res = await visitClient.softDelete(visit.id, { reason });
    setPendingDelete({ visit, restorableUntil: res.restorableUntil });
    setDeleteDialogOpen(false);
    await refresh();
  } catch (err) {
    setDeleteDialogOpen(false);
    if (typeof window !== 'undefined') {
      const message =
        err instanceof ApiError && err.body.message
          ? err.body.message
          : 'Vizita nuk u fshi. Provoni përsëri.';
      // eslint-disable-next-line no-alert
      window.alert(message);
    }
  } finally {
    setDeleteBusy(false);
  }
}

async function undoDelete(
  visitId: string,
  refresh: () => Promise<void>,
): Promise<void> {
  try {
    await visitClient.restore(visitId);
    await refresh();
  } catch {
    if (typeof window !== 'undefined') {
      // eslint-disable-next-line no-alert
      window.alert('Rikthimi i vizitës dështoi.');
    }
  }
}

// =========================================================================
// Status transitions — "Përfundo vizitën" / "Anulo statusin"
// =========================================================================
//
// Both go through the shared calendar status endpoint
// (`PATCH /api/visits/:id/status`). The server emits `visit.status_
// changed` via SSE on success so the receptionist's calendar and the
// doctor's home dashboard refresh in real time.
//
// We always re-fetch the visit after the PATCH so the auto-save store
// re-seeds with the new status (the chart endpoint's full DTO is the
// auth source for the form). The chart-shell refresh keeps the
// history list + master strip in sync.

async function completeVisit(
  visit: VisitDto,
  setActiveVisit: (v: VisitDto | null) => void,
  setStatusToast: (t: { id: string; message: string } | null) => void,
  refresh: () => Promise<void>,
): Promise<void> {
  // Flush in-flight auto-save first — the doctor's last keystrokes
  // should be on record before the status flips.
  await useAutoSaveStore.getState().save();
  try {
    await calendarClient.changeStatus(visit.id, 'completed');
    const res = await visitClient.getOne(visit.id);
    setActiveVisit(res.visit);
    setStatusToast({
      id: `complete:${visit.id}:${Date.now()}`,
      message: 'Vizita u përfundua.',
    });
    await refresh();
  } catch (err) {
    setStatusToast({
      id: `complete-err:${visit.id}:${Date.now()}`,
      message:
        err instanceof ApiError && err.body.message
          ? err.body.message
          : 'Përfundimi i vizitës dështoi. Provoni përsëri.',
    });
  }
}

async function revertStatus(
  visit: VisitDto,
  setActiveVisit: (v: VisitDto | null) => void,
  setStatusToast: (t: { id: string; message: string } | null) => void,
  refresh: () => Promise<void>,
): Promise<void> {
  try {
    await calendarClient.changeStatus(visit.id, 'arrived');
    const res = await visitClient.getOne(visit.id);
    setActiveVisit(res.visit);
    setStatusToast({
      id: `revert:${visit.id}:${Date.now()}`,
      message: 'Vizita u rihap. Mund të redaktosh të dhënat.',
    });
    await refresh();
  } catch (err) {
    setStatusToast({
      id: `revert-err:${visit.id}:${Date.now()}`,
      message:
        err instanceof ApiError && err.body.message
          ? err.body.message
          : 'Rihapja e vizitës dështoi. Provoni përsëri.',
    });
  }
}

// =========================================================================
// Print + vërtetim helpers
// =========================================================================

async function printVisitReport(visit: VisitDto): Promise<void> {
  // Flush in-flight auto-save edits before printing — the doctor
  // expects the printed report to reflect what's on screen.
  await useAutoSaveStore.getState().save();
  openPrintFrame({ src: printUrls.visitReport(visit.id) });
}

function viewVertetim(vertetimId: string): void {
  // "Shiko vërtetimin" — open the PDF in a new tab so the doctor
  // can scroll the document before deciding whether to print. The
  // iframe path is reserved for the direct-print "Reprint" action.
  if (typeof window !== 'undefined') {
    window.open(printUrls.vertetim(vertetimId), '_blank', 'noopener');
  }
}

function reprintVertetim(vertetimId: string): void {
  // Direct print — re-fetch + open dialog. Reuses the same iframe.
  openPrintFrame({ src: printUrls.vertetim(vertetimId) });
}

function onVertetimIssued(
  issued: VertetimDto,
  setData: (
    updater:
      | PatientChartDto
      | ((d: PatientChartDto | null) => PatientChartDto | null),
  ) => void,
): void {
  setData((d) => {
    if (!d) return d;
    const next: ChartVertetimDto = {
      id: issued.id,
      visitId: issued.visitId,
      issuedAt: issued.issuedAt,
      absenceFrom: issued.absenceFrom,
      absenceTo: issued.absenceTo,
      durationDays: issued.durationDays,
      diagnosisSnapshot: issued.diagnosisSnapshot,
    };
    return { ...d, vertetime: [next, ...d.vertetime] };
  });
}

function daysSincePreviousFor(visits: ChartVisitDto[], index: number): number | null {
  // Visits arrive newest-first; the "previous" visit (older) is at
  // `index + 1`. Returns `null` for the oldest visit and for
  // out-of-range indices.
  const current = visits[index];
  const previous = visits[index + 1];
  if (!current || !previous) return null;
  return daysBetweenIso(previous.visitDate, current.visitDate);
}

function formatDeleteSecondary(visit: VisitDto): string | undefined {
  const date = formatDdMmYyyy(visit.visitDate);
  return date;
}

function formatDdMmYyyy(iso: string): string {
  const [y, m, d] = iso.split('-');
  if (!y || !m || !d) return iso;
  return `${d}.${m}.${y}`;
}
