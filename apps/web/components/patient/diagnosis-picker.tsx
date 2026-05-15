'use client';

import {
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  horizontalListSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  type KeyboardEvent,
  type ReactElement,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';

import { type Icd10ResultDto, icd10Client } from '@/lib/icd10-client';
import type { VisitDiagnosisDto } from '@/lib/visit-client';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * The dropdown renders up to this many results inline. The server-side
 * search caps at 50 (see icd10.dto.ts) but the UI only paints 20 — the
 * doctor refines `q` instead of scrolling.
 */
const DROPDOWN_LIMIT = 20;
const SEARCH_DEBOUNCE_MS = 150;

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface Props {
  /** Ordered chip list. Index 0 is primary. */
  value: VisitDiagnosisDto[];
  onChange: (next: VisitDiagnosisDto[]) => void;
  /**
   * Mirrors the form-wide blur flush. The wrapper passes its
   * `onBlur(_e: FocusEvent<HTMLElement>)` handler down, so the
   * picker's `onBlur` accepts an optional FocusEvent argument and
   * forwards it through verbatim.
   */
  onBlur?: (e: React.FocusEvent<HTMLElement>) => void;
  disabled?: boolean;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * ICD-10 multi-select. Chips above, search field below, dropdown of
 * matches when the field has focus. Order matters (first chip is the
 * primary diagnosis) and is mutable via drag-and-drop or keyboard
 * arrow-left/right while a chip is focused.
 *
 * Mirrors design-reference/prototype/chart.html §dxCurrent.
 */
export function DiagnosisPicker({
  value,
  onChange,
  onBlur,
  disabled = false,
}: Props): ReactElement {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [results, setResults] = useState<Icd10ResultDto[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  const selectedCodes = useMemo(
    () => new Set(value.map((d) => d.code)),
    [value],
  );

  // Debounce the query so we don't fire on every keystroke.
  useEffect(() => {
    const handle = window.setTimeout(() => {
      setDebouncedQuery(query.trim());
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(handle);
  }, [query]);

  // Fetch results when the debounced query changes (or when the field
  // first gets focus with an empty query — surfaces the doctor's top
  // recently-used codes).
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const { results } = await icd10Client.search(
          debouncedQuery,
          DROPDOWN_LIMIT,
        );
        if (!cancelled) {
          // Filter out codes already on the chip list so the doctor
          // doesn't get a duplicate.
          const filtered = results.filter((r) => !selectedCodes.has(r.code));
          setResults(filtered);
          setActiveIndex(0);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // selectedCodes is recomputed each render; we explicitly use the
    // value here so newly-added chips disappear from the dropdown.
  }, [debouncedQuery, open, selectedCodes]);

  // Re-focus the input when chips change so the doctor can keep typing.
  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
  }, [value.length, open]);

  const addCode = useCallback(
    (result: Icd10ResultDto) => {
      if (selectedCodes.has(result.code)) return;
      const next: VisitDiagnosisDto[] = [
        ...value,
        {
          code: result.code,
          latinDescription: result.latinDescription,
          orderIndex: value.length,
        },
      ];
      onChange(next);
      setQuery('');
      setDebouncedQuery('');
      setActiveIndex(0);
      // Close the dropdown after a selection so the chip-only state is
      // visible. The doctor re-focuses the input (or types) to add
      // another diagnosis; the onFocus handler reopens it then.
      setOpen(false);
    },
    [onChange, selectedCodes, value],
  );

  const removeAt = useCallback(
    (index: number) => {
      const next = value.filter((_, i) => i !== index);
      onChange(reindex(next));
    },
    [onChange, value],
  );

  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (results.length === 0) return;
        setActiveIndex((i) => Math.min(i + 1, results.length - 1));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (results.length === 0) return;
        setActiveIndex((i) => Math.max(i - 1, 0));
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        const candidate = results[activeIndex];
        if (candidate) {
          // Tab still commits the picked option; the form's tab order
          // will move on naturally because we don't preventDefault on
          // Tab unless something is selected.
          e.preventDefault();
          addCode(candidate);
        }
        return;
      }
      if (e.key === 'Backspace' && query.length === 0 && value.length > 0) {
        e.preventDefault();
        removeAt(value.length - 1);
        return;
      }
      if (e.key === 'Escape') {
        setOpen(false);
        return;
      }
    },
    [activeIndex, addCode, query.length, removeAt, results, value.length],
  );

  // -------------------------------------------------------------------------
  // Drag-to-reorder (dnd-kit)
  // -------------------------------------------------------------------------

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const onDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;
      const oldIndex = value.findIndex((d) => d.code === active.id);
      const newIndex = value.findIndex((d) => d.code === over.id);
      if (oldIndex < 0 || newIndex < 0) return;
      onChange(reindex(arrayMove(value, oldIndex, newIndex)));
    },
    [onChange, value],
  );

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <div className="relative" onBlur={onBlur}>
      <div
        className={cn(
          'flex flex-wrap items-center gap-1.5 rounded-md border bg-surface-elevated px-2.5 py-2 transition focus-within:border-primary focus-within:shadow-focus',
          disabled ? 'border-line bg-surface-subtle' : 'border-line-strong',
        )}
        data-testid="diagnosis-picker"
      >
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={onDragEnd}
        >
          <SortableContext
            items={value.map((d) => d.code)}
            strategy={horizontalListSortingStrategy}
          >
            {value.map((d, idx) => (
              <DiagnosisChip
                key={d.code}
                diagnosis={d}
                primary={idx === 0}
                onRemove={() => removeAt(idx)}
                disabled={disabled}
              />
            ))}
          </SortableContext>
        </DndContext>
        <input
          id={inputId}
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          disabled={disabled}
          placeholder={
            value.length === 0
              ? 'Kërko ICD-10 (kod ose përshkrim)...'
              : 'Shto diagnozë...'
          }
          role="combobox"
          aria-label="Kërko ICD-10"
          aria-expanded={open}
          aria-controls={`${inputId}-dropdown`}
          aria-autocomplete="list"
          autoComplete="off"
          className="flex-1 min-w-[160px] border-none bg-transparent px-1 py-1 text-[13px] outline-none placeholder:text-ink-faint"
        />
      </div>

      {open && (query.length > 0 || results.length > 0) ? (
        <div
          id={`${inputId}-dropdown`}
          role="listbox"
          aria-label="Rezultatet e kërkimit ICD-10"
          className="absolute z-30 mt-1.5 max-h-[320px] w-full overflow-auto rounded-md border border-line-strong bg-surface-elevated shadow-md"
        >
          <div className="flex justify-between border-b border-line-soft bg-surface-subtle px-3.5 py-1.5 text-[11px] font-medium uppercase tracking-[0.05em] text-ink-faint">
            <span>
              {query.length > 0
                ? `ICD-10 · përputhje për "${query}"`
                : 'ICD-10 · përdorur së fundmi'}
            </span>
            <span>↑↓ për të lëvizur · Enter për të zgjedhur</span>
          </div>
          {loading && results.length === 0 ? (
            <div className="px-3.5 py-3 text-[12px] italic text-ink-faint">
              Duke kërkuar...
            </div>
          ) : results.length === 0 ? (
            <div className="px-3.5 py-3 text-[12px] italic text-ink-faint">
              Asnjë përputhje. Provoni një kod ose përshkrim tjetër.
            </div>
          ) : (
            results.map((r, idx) => (
              <button
                key={r.code}
                type="button"
                role="option"
                aria-selected={idx === activeIndex}
                onMouseEnter={() => setActiveIndex(idx)}
                onMouseDown={(e) => {
                  // mouseDown so the click registers before the input's blur
                  // closes the dropdown.
                  e.preventDefault();
                  addCode(r);
                }}
                className={cn(
                  'grid w-full grid-cols-[64px_1fr_auto] items-center gap-3.5 border-b border-line-soft px-3.5 py-2 text-left last:border-b-0',
                  idx === activeIndex
                    ? 'bg-primary-soft'
                    : 'hover:bg-primary-soft/50',
                )}
                data-testid={`diagnosis-option-${r.code}`}
              >
                <span className="font-mono text-[11.5px] font-semibold text-teal-700">
                  {r.code}
                </span>
                <span className="text-[13px] text-ink">
                  {r.latinDescription}
                </span>
                {r.useCount > 0 ? (
                  <span
                    className={cn(
                      'rounded px-1.5 py-0.5 text-[10px]',
                      idx === activeIndex
                        ? 'bg-surface-elevated text-ink-muted'
                        : 'bg-surface-subtle text-ink-faint',
                    )}
                    title={r.frequentlyUsed ? 'Përdorur shpesh nga ju' : undefined}
                  >
                    {r.useCount}×
                  </span>
                ) : (
                  <span />
                )}
              </button>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Chip (sortable)
// ---------------------------------------------------------------------------

interface ChipProps {
  diagnosis: VisitDiagnosisDto;
  primary: boolean;
  onRemove: () => void;
  disabled: boolean;
}

function DiagnosisChip({
  diagnosis,
  primary,
  onRemove,
  disabled,
}: ChipProps): ReactElement {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: diagnosis.code, disabled });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : undefined,
  };

  return (
    <span
      ref={setNodeRef}
      style={style}
      data-testid={`diagnosis-chip-${diagnosis.code}`}
      data-primary={primary ? 'true' : 'false'}
      className={cn(
        'inline-flex select-none items-center gap-1.5 rounded-md border px-2 py-1 text-[12.5px]',
        primary
          ? 'border-primary bg-primary text-white'
          : 'border-teal-200 bg-teal-50 text-teal-800',
      )}
    >
      <span
        {...attributes}
        {...listeners}
        className={cn(
          'cursor-grab font-mono text-[11px] font-semibold tracking-[0.02em]',
          primary
            ? 'rounded bg-teal-800 px-1 py-0.5 text-teal-100'
            : 'text-teal-700',
        )}
        title="Tërhiqeni për të ndryshuar renditjen"
      >
        {diagnosis.code}
      </span>
      <span className="leading-tight">{diagnosis.latinDescription}</span>
      <button
        type="button"
        onClick={onRemove}
        disabled={disabled}
        aria-label={`Hiq diagnozën ${diagnosis.code}`}
        className={cn(
          'grid h-4 w-4 place-items-center rounded text-[12px] leading-none',
          primary
            ? 'text-teal-100 hover:bg-teal-800'
            : 'text-teal-700 hover:bg-teal-100',
        )}
      >
        ×
      </button>
    </span>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Reset `orderIndex` to match the array position after a mutation. */
export function reindex(
  list: VisitDiagnosisDto[],
): VisitDiagnosisDto[] {
  return list.map((d, i) => ({ ...d, orderIndex: i }));
}
