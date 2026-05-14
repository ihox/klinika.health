'use client';

import {
  type ChangeEvent,
  type FocusEvent,
  type ReactElement,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';

import { Button } from '@/components/ui/button';
import {
  type PaymentCode,
  type VisitDto,
  type VisitFormValues,
  validateFormValues,
} from '@/lib/visit-client';
import {
  useAutoSaveStore,
  useVisitAutoSave,
} from '@/lib/use-visit-autosave';
import { cn } from '@/lib/utils';

// Field key type that drives both the form state and the change-history
// label map. Using `keyof VisitFormValues` keeps the two in lockstep.
type FieldKey = keyof VisitFormValues;

const PAYMENT_CODES: PaymentCode[] = ['A', 'B', 'C', 'D', 'E'];

interface Props {
  visit: VisitDto;
  patientName: string;
  /** Visit number (1-based, oldest = 1 doesn't make sense — chart-view passes the index). */
  visitNumber: number;
  totalVisits: number;
  /** Days since the previous visit, for the "Nga vizita paraprake: N ditë" badge. */
  daysSincePrevious: number | null;
  onOpenHistory: () => void;
  onDeleteRequest: () => void;
  onNewVisitRequest: () => void;
}

/**
 * Visit form — the doctor's daily working surface.
 *
 * Mirrors design-reference/prototype/chart.html §visit-form. Every
 * keystroke auto-saves on a 1.5s debounce (see {@link useVisitAutoSave}).
 * Field blur triggers an immediate save; idle 30s triggers one too;
 * navigating away saves via beforeunload. All these enforce the
 * non-negotiable rule "never lose the doctor's work" (CLAUDE.md §1.9).
 *
 * The receptionist never reaches this component — the API blocks at
 * the route layer and the chart view itself is doctor-only.
 */
export function VisitForm({
  visit,
  patientName,
  visitNumber,
  totalVisits,
  daysSincePrevious,
  onOpenHistory,
  onDeleteRequest,
  onNewVisitRequest,
}: Props): ReactElement {
  const values = useAutoSaveStore((s) => s.values);
  const setValues = useAutoSaveStore((s) => s.setValues);
  const setVisit = useAutoSaveStore((s) => s.setVisit);

  // Re-seed the store whenever the active visit changes.
  useEffect(() => {
    setVisit(visit);
  }, [visit, setVisit]);

  const auto = useVisitAutoSave(visit.id);

  const update = useCallback(
    (key: FieldKey, value: string | boolean) => {
      const current = useAutoSaveStore.getState().values;
      if (!current) return;
      const next = { ...current, [key]: value } as VisitFormValues;
      setValues(next);
    },
    [setValues],
  );

  const onChangeText = useCallback(
    (key: FieldKey) => (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      update(key, e.target.value),
    [update],
  );
  const onChangeCheckbox = useCallback(
    (key: FieldKey) => (e: ChangeEvent<HTMLInputElement>) =>
      update(key, e.target.checked),
    [update],
  );
  const onChangeSelect = useCallback(
    (key: FieldKey) => (e: ChangeEvent<HTMLSelectElement>) =>
      update(key, e.target.value),
    [update],
  );
  const onBlur = useCallback(
    (_e: FocusEvent<HTMLElement>) => {
      // Defer one tick so React commits the latest `setValues` first.
      window.setTimeout(() => {
        void auto.flush();
      }, 0);
    },
    [auto],
  );

  const errors = useMemo(
    () => (values ? validateFormValues(values) : {}),
    [values],
  );

  if (!values) return <FormSkeleton />;

  const sincePreviousBadge =
    daysSincePrevious != null ? (
      <span className="ml-3 border-l border-line pl-3 text-[12px] text-ink-muted">
        Nga vizita paraprake:{' '}
        <strong className="font-medium text-ink">{daysSincePrevious} ditë</strong>
      </span>
    ) : null;

  return (
    <section
      aria-label="Forma e vizitës"
      className="overflow-hidden rounded-lg border border-line bg-surface-elevated shadow-xs"
    >
      <VisitHeader
        visit={visit}
        patientName={patientName}
        visitNumber={visitNumber}
        totalVisits={totalVisits}
        sincePreviousBadge={sincePreviousBadge}
        onOpenHistory={onOpenHistory}
      />

      {/* 1. Vizita — Ankesa, Ushqimi, Vitals */}
      <Section title="Vizita">
        <FieldRow label="Ankesa">
          <Textarea
            id="visit-complaint"
            value={values.complaint}
            onChange={onChangeText('complaint')}
            onBlur={onBlur}
            rows={3}
            placeholder="Ankesa kryesore..."
          />
        </FieldRow>

        <FieldRow label="Ushqimi">
          <div className="flex flex-wrap items-center gap-2.5 py-1.5">
            <FoodCheck
              label="Gji"
              checked={values.feedingBreast}
              onChange={onChangeCheckbox('feedingBreast')}
              onBlur={onBlur}
            />
            <FoodCheck
              label="Formulë"
              checked={values.feedingFormula}
              onChange={onChangeCheckbox('feedingFormula')}
              onBlur={onBlur}
            />
            <FoodCheck
              label="Solid"
              checked={values.feedingSolid}
              onChange={onChangeCheckbox('feedingSolid')}
              onBlur={onBlur}
            />
            <input
              type="text"
              value={values.feedingNotes}
              onChange={onChangeText('feedingNotes')}
              onBlur={onBlur}
              placeholder="Shënim për ushqimin (opsional)"
              className="ml-1 min-w-[180px] flex-1 rounded-md border border-line-strong bg-surface-elevated px-3 py-2 text-[13px] outline-none focus:border-primary focus:shadow-focus"
              aria-label="Shënim për ushqimin"
            />
          </div>
        </FieldRow>

        <div className="grid grid-cols-2 gap-3 pt-2 sm:grid-cols-4">
          <Vital
            label="Pesha"
            unit="kg"
            value={values.weightKg}
            onChange={onChangeText('weightKg')}
            onBlur={onBlur}
            error={errors['weightKg']}
            id="visit-weight"
            inputMode="decimal"
          />
          <Vital
            label="Gjatësia"
            unit="cm"
            value={values.heightCm}
            onChange={onChangeText('heightCm')}
            onBlur={onBlur}
            error={errors['heightCm']}
            id="visit-height"
            inputMode="decimal"
          />
          <Vital
            label="Perimetri i kokës"
            unit="cm"
            value={values.headCircumferenceCm}
            onChange={onChangeText('headCircumferenceCm')}
            onBlur={onBlur}
            error={errors['headCircumferenceCm']}
            id="visit-head-circumference"
            inputMode="decimal"
          />
          <Vital
            label="Temperatura"
            unit="°C"
            value={values.temperatureC}
            onChange={onChangeText('temperatureC')}
            onBlur={onBlur}
            error={errors['temperatureC']}
            id="visit-temperature"
            inputMode="decimal"
          />
        </div>
      </Section>

      {/* 2. Pagesa — clinic-specific category */}
      <Section title="Pagesa">
        <FieldRow label="Kategoria">
          <select
            id="visit-payment-code"
            value={values.paymentCode}
            onChange={onChangeSelect('paymentCode')}
            onBlur={onBlur}
            className="h-9 max-w-[140px] rounded-md border border-line-strong bg-surface-elevated px-2.5 text-[13px] tabular-nums outline-none focus:border-primary focus:shadow-focus"
            aria-label="Kodi i pagesës"
          >
            <option value="">—</option>
            {PAYMENT_CODES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </FieldRow>
      </Section>

      {/* 3. Ekzaminimi — Ekzaminime + Ultrazeri */}
      <Section title="Ekzaminimi">
        <FieldRow label="Ekzaminime">
          <Textarea
            id="visit-examinations"
            value={values.examinations}
            onChange={onChangeText('examinations')}
            onBlur={onBlur}
            rows={4}
            placeholder="Gjetjet e ekzaminimit fizikal..."
          />
        </FieldRow>
        <FieldRow label="Ultrazeri" optional>
          <div className="space-y-2">
            <Textarea
              id="visit-ultrasound-notes"
              value={values.ultrasoundNotes}
              onChange={onChangeText('ultrasoundNotes')}
              onBlur={onBlur}
              rows={3}
              placeholder="Gjetjet e ultrazerit, nëse ka..."
            />
            <div className="rounded-md border border-dashed border-line-strong bg-surface-subtle px-3 py-3 text-[12px] text-ink-faint">
              Lidhja e studimeve DICOM aktivizohet në fazën e ardhshme.
            </div>
          </div>
        </FieldRow>
      </Section>

      {/* 4. Diagnoza — placeholder for slice 13 */}
      <Section title="Diagnoza · ICD-10">
        <div className="rounded-md border border-dashed border-line-strong bg-surface-subtle px-3 py-4 text-center text-[12px] text-ink-faint">
          Përzgjedhja strukturuar ICD-10 vjen në fazën e ardhshme (slice 13).
        </div>
        {visit.legacyDiagnosis ? (
          <div className="mt-3 rounded-md border border-line bg-surface-subtle px-3 py-3 text-[13px] text-ink">
            <div className="mb-1 text-[10.5px] font-semibold uppercase tracking-[0.06em] text-ink-faint">
              Diagnoza e migruar (tekst i lirë)
            </div>
            <div className="font-mono text-[12.5px] leading-snug">
              {visit.legacyDiagnosis}
            </div>
          </div>
        ) : null}
      </Section>

      {/* 5. Terapia — placeholder for slice 13 autocomplete */}
      <Section title="Terapia">
        <Textarea
          id="visit-prescription"
          value={values.prescription}
          onChange={onChangeText('prescription')}
          onBlur={onBlur}
          rows={5}
          mono
          placeholder={`Shembull:\nParacetamol 250mg s.3x\nIbuprofen susp. 100mg/5ml s.n.`}
        />
        <p className="mt-1.5 text-[11px] text-ink-faint">
          Plotësimi automatik me histori personale vjen në slice 13.
        </p>
      </Section>

      {/* 6. Plani — Analizat, Kontrolla, Tjera */}
      <Section title="Plani">
        <FieldRow label="Analizat">
          <Textarea
            id="visit-lab-results"
            value={values.labResults}
            onChange={onChangeText('labResults')}
            onBlur={onBlur}
            rows={2}
            placeholder="Asnjë analizë e kërkuar"
          />
        </FieldRow>
        <FieldRow label="Kontrolla">
          <Textarea
            id="visit-followup-notes"
            value={values.followupNotes}
            onChange={onChangeText('followupNotes')}
            onBlur={onBlur}
            rows={2}
            placeholder="Kontroll pas N ditësh ose data e caktuar..."
          />
        </FieldRow>
        <FieldRow label="Tjera" optional>
          <Textarea
            id="visit-other-notes"
            value={values.otherNotes}
            onChange={onChangeText('otherNotes')}
            onBlur={onBlur}
            rows={2}
            placeholder="Shënime të tjera ose informacione plotësuese"
          />
        </FieldRow>
      </Section>

      <VisitActionBar
        autoSaveState={auto.state}
        lastSavedAt={visit.wasUpdated ? visit.updatedAt : null}
        onSaveNow={() => void auto.flush()}
        onDelete={onDeleteRequest}
        onNewVisit={onNewVisitRequest}
      />
    </section>
  );
}

// =========================================================================
// Visit header (with "Modifikuar nga..." inline indicator)
// =========================================================================

interface VisitHeaderProps {
  visit: VisitDto;
  patientName: string;
  visitNumber: number;
  totalVisits: number;
  sincePreviousBadge: ReactElement | null;
  onOpenHistory: () => void;
}

function VisitHeader({
  visit,
  patientName,
  visitNumber,
  totalVisits,
  sincePreviousBadge,
  onOpenHistory,
}: VisitHeaderProps): ReactElement {
  return (
    <header className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-3.5">
      <div>
        <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-muted">
          Vizita
        </div>
        <div className="mt-1 flex flex-wrap items-baseline gap-2 text-[14px]">
          <span className="font-display text-[15px] font-semibold tabular-nums text-ink-strong">
            {formatDate(visit.visitDate)}
          </span>
          <span className="text-[12.5px] text-ink-muted">
            vizita {visitNumber} nga {totalVisits} · {patientName}
          </span>
          {sincePreviousBadge}
        </div>
      </div>

      {visit.wasUpdated ? (
        <button
          type="button"
          onClick={onOpenHistory}
          className="inline-flex items-center gap-1.5 text-[11.5px] text-ink-faint underline-offset-2 hover:text-ink-muted hover:underline"
          title="Shiko historinë e ndryshimeve"
        >
          <svg
            width="11"
            height="11"
            viewBox="0 0 12 12"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <circle cx="6" cy="6" r="5" />
            <path d="M6 3v3l2 1.5" />
          </svg>
          <span>
            Modifikuar nga{' '}
            <strong className="font-medium text-ink-muted">
              {/* Doctor's name not available here without an extra fetch.
                  We show "Dr." prefix when the visit has been touched at
                  least once — the change-history modal then surfaces the
                  full attributions. */}
              Dr.
            </strong>{' '}
            më {formatDateTime(visit.updatedAt)}
          </span>
        </button>
      ) : (
        <span className="text-[11px] italic text-ink-faint">
          — pa ndryshime të mëparshme —
        </span>
      )}
    </header>
  );
}

// =========================================================================
// Action bar (auto-save state indicator, save now, delete, new visit)
// =========================================================================

interface VisitActionBarProps {
  autoSaveState: 'idle' | 'dirty' | 'saving' | 'saved-flash' | 'error';
  lastSavedAt: string | null;
  onSaveNow: () => void;
  onDelete: () => void;
  onNewVisit: () => void;
}

function VisitActionBar({
  autoSaveState,
  lastSavedAt,
  onSaveNow,
  onDelete,
  onNewVisit,
}: VisitActionBarProps): ReactElement {
  return (
    <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-line bg-surface-subtle px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="secondary"
          size="sm"
          onClick={onDelete}
          className="text-danger hover:!bg-danger-bg"
        >
          Fshij vizitën
        </Button>
        <Button variant="secondary" size="sm" onClick={onNewVisit}>
          + Vizitë e re
        </Button>
        <Button variant="secondary" size="sm" onClick={onSaveNow}>
          Ruaj tani
        </Button>
      </div>
      <AutoSaveIndicator
        state={autoSaveState}
        lastSavedAt={lastSavedAt}
        onRetry={onSaveNow}
      />
    </footer>
  );
}

interface AutoSaveIndicatorProps {
  state: 'idle' | 'dirty' | 'saving' | 'saved-flash' | 'error';
  lastSavedAt: string | null;
  onRetry: () => void;
}

function AutoSaveIndicator({
  state,
  lastSavedAt,
  onRetry,
}: AutoSaveIndicatorProps): ReactElement {
  const relative = useRelativeTime(lastSavedAt);
  if (state === 'idle') {
    if (!lastSavedAt) {
      return <span className="text-[12px] italic text-ink-faint">—</span>;
    }
    return (
      <span className="inline-flex items-center gap-1.5 text-[12.5px] text-ink-muted">
        <span className="text-success" aria-hidden>
          <svg
            width="12"
            height="12"
            viewBox="0 0 12 12"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M2.5 6.5l2.5 2.5 4.5-5" />
          </svg>
        </span>
        <span>
          U ruajt <span className="text-ink-faint">{relative}</span>
        </span>
      </span>
    );
  }
  if (state === 'dirty') {
    return (
      <span className="inline-flex items-center gap-1.5 text-[12.5px] text-ink-muted">
        <span
          className="h-[7px] w-[7px] animate-pulse rounded-full bg-accent-500"
          aria-hidden
        />
        <span>Ndryshime të paruajtura</span>
      </span>
    );
  }
  if (state === 'saving') {
    return (
      <span className="inline-flex items-center gap-1.5 text-[12.5px] text-ink-muted">
        <span
          className="inline-block h-3 w-3 animate-spin rounded-full border-[1.5px] border-teal-200 border-t-primary"
          aria-hidden
        />
        <span>Duke ruajtur...</span>
      </span>
    );
  }
  if (state === 'saved-flash') {
    return (
      <span className="inline-flex items-center gap-1.5 text-[12.5px] text-success">
        <svg
          width="12"
          height="12"
          viewBox="0 0 12 12"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="M2.5 6.5l2.5 2.5 4.5-5" />
        </svg>
        <span>U ruajt</span>
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-warning-soft bg-warning-bg px-2.5 py-1 text-[12px] font-medium text-warning">
      <svg
        width="14"
        height="14"
        viewBox="0 0 14 14"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <path d="M7 2.5l5.5 9.5h-11z" />
        <path d="M7 6.5v2.5M7 10.6v.01" />
      </svg>
      Ruajtja dështoi
      <button
        type="button"
        onClick={onRetry}
        className="ml-1 rounded-full bg-warning px-2.5 py-0.5 text-[11.5px] font-semibold text-white hover:opacity-90"
      >
        Provo përsëri
      </button>
    </span>
  );
}

// =========================================================================
// Smaller helpers
// =========================================================================

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}): ReactElement {
  return (
    <div className="border-b border-line px-5 py-4 last:border-b-0">
      <h4 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-muted">
        {title}
      </h4>
      {children}
    </div>
  );
}

interface FieldRowProps {
  label: string;
  optional?: boolean;
  children: React.ReactNode;
}

function FieldRow({ label, optional, children }: FieldRowProps): ReactElement {
  return (
    <div className="mb-3 grid grid-cols-1 items-start gap-2 last:mb-0 sm:grid-cols-[140px_1fr] sm:gap-4">
      <label className="pt-2 text-[12px] font-medium text-ink-muted">
        {label}
        {optional ? (
          <span className="ml-1 text-[11px] font-normal text-ink-faint">
            opsionale
          </span>
        ) : null}
      </label>
      <div>{children}</div>
    </div>
  );
}

function Textarea({
  mono,
  className,
  ...rest
}: React.TextareaHTMLAttributes<HTMLTextAreaElement> & {
  mono?: boolean;
}): ReactElement {
  return (
    <textarea
      {...rest}
      className={cn(
        'w-full rounded-md border border-line-strong bg-surface-elevated px-3 py-2.5 text-[13px] leading-snug text-ink outline-none transition focus:border-primary focus:shadow-focus',
        mono && 'font-mono text-[12.5px] leading-relaxed',
        className,
      )}
    />
  );
}

interface VitalProps {
  label: string;
  unit: string;
  value: string;
  onChange: (e: ChangeEvent<HTMLInputElement>) => void;
  onBlur: (e: FocusEvent<HTMLInputElement>) => void;
  error?: string;
  id: string;
  inputMode?: 'decimal' | 'numeric';
}

function Vital({
  label,
  unit,
  value,
  onChange,
  onBlur,
  error,
  id,
  inputMode = 'decimal',
}: VitalProps): ReactElement {
  return (
    <div className="flex flex-col gap-1">
      <label
        htmlFor={id}
        className="text-[10.5px] font-medium uppercase tracking-[0.05em] text-ink-muted"
      >
        {label}
      </label>
      <div
        className={cn(
          'flex items-center rounded-md border border-line-strong bg-surface-elevated px-3 transition focus-within:border-primary focus-within:shadow-focus',
          error && 'border-warning focus-within:border-warning',
        )}
      >
        <input
          id={id}
          type="text"
          inputMode={inputMode}
          autoComplete="off"
          value={value}
          onChange={onChange}
          onBlur={onBlur}
          className="w-full min-w-0 border-none bg-transparent py-2 font-display text-[16px] font-semibold tabular-nums outline-none"
        />
        <span className="ml-1 shrink-0 text-[12px] font-medium text-ink-faint">
          {unit}
        </span>
      </div>
      {error ? (
        <span className="text-[11px] text-warning" role="alert">
          {error}
        </span>
      ) : null}
    </div>
  );
}

interface FoodCheckProps {
  label: string;
  checked: boolean;
  onChange: (e: ChangeEvent<HTMLInputElement>) => void;
  onBlur: (e: FocusEvent<HTMLInputElement>) => void;
}

function FoodCheck({ label, checked, onChange, onBlur }: FoodCheckProps): ReactElement {
  return (
    <label
      className={cn(
        'inline-flex cursor-pointer items-center gap-2 rounded-md border bg-surface-elevated px-3.5 py-1.5 text-[13px] transition',
        checked
          ? 'border-primary bg-primary-soft text-teal-800 font-medium'
          : 'border-line-strong text-ink hover:border-line',
      )}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={onChange}
        onBlur={onBlur}
        className="h-3.5 w-3.5 accent-primary"
      />
      {label}
    </label>
  );
}

function FormSkeleton(): ReactElement {
  return (
    <section className="rounded-lg border border-line bg-surface-elevated px-5 py-8 text-center text-[12px] text-ink-faint">
      Duke ngarkuar...
    </section>
  );
}

// =========================================================================
// Date helpers (kept inline so the form is self-contained)
// =========================================================================

function formatDate(iso: string): string {
  const [y, m, d] = iso.split('-');
  if (!y || !m || !d) return iso;
  return `${d}.${m}.${y}`;
}

function formatDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const fmt = new Intl.DateTimeFormat('sq-AL', {
    timeZone: 'Europe/Belgrade',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = fmt.formatToParts(date);
  const get = (t: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === t)?.value ?? '';
  return `${get('day')}.${get('month')}.${get('year')} ${get('hour')}:${get('minute')}`;
}

// Updates every 30s so the "U ruajt 2 min më parë" line stays current
// without re-rendering the entire form.
function useRelativeTime(iso: string | null): string {
  const compute = useCallback((): string => {
    if (!iso) return '';
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '';
    const delta = Math.round((Date.now() - date.getTime()) / 1000);
    if (delta < 5) return 'tani';
    if (delta < 60) return `${delta} sek më parë`;
    if (delta < 3600) {
      const m = Math.round(delta / 60);
      return `${m} min më parë`;
    }
    if (delta < 86_400) {
      const h = Math.round(delta / 3600);
      return `${h} orë më parë`;
    }
    const d = Math.round(delta / 86_400);
    return `${d} ditë më parë`;
  }, [iso]);

  const [label, setLabel] = useState<string>(compute());
  useEffect(() => {
    setLabel(compute());
    if (!iso) return;
    const handle = window.setInterval(() => setLabel(compute()), 30_000);
    return () => window.clearInterval(handle);
  }, [iso, compute]);
  return label;
}
