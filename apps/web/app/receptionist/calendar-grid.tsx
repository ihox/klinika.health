'use client';

import type { ReactElement } from 'react';

import { cn } from '@/lib/utils';
import {
  type AppointmentDto,
  colorIndicatorForLastVisit,
  dayLabelShort,
  formatDob,
  type LastVisitColor,
  minutesToTime,
  timeToMinutes,
  toLocalParts,
} from '@/lib/appointment-client';
import type { HoursConfig } from '@/lib/clinic-client';

// Layout constants. 120px per hour = 2px per minute. The grid keeps a
// continuous open band per day (no in-day "Mbyllur" splits in v1) so a
// column's pixel height = (close − open) * 2.
const PX_PER_MIN = 2;

export interface DayColumn {
  date: string; // yyyy-mm-dd
  weekday: 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';
  open: boolean;
  startTime: string; // HH:MM
  endTime: string; // HH:MM
}

export interface CalendarGridProps {
  todayIso: string;
  now: Date;
  hours: HoursConfig;
  columns: DayColumn[];
  appointments: AppointmentDto[];
  onSlotClick: (params: { date: string; time: string }) => void;
  onAppointmentClick: (
    appointment: AppointmentDto,
    anchor: { x: number; y: number },
  ) => void;
}

const STATUS_LABEL: Record<AppointmentDto['status'], string> = {
  scheduled: 'Planifikuar',
  completed: 'Kryer',
  no_show: 'Mungesë',
  cancelled: 'Anuluar',
};

export function CalendarGrid({
  todayIso,
  now,
  hours,
  columns,
  appointments,
  onSlotClick,
  onAppointmentClick,
}: CalendarGridProps): ReactElement {
  // The widest open band determines the grid height so columns line up
  // even when one day closes earlier than another. We always anchor at
  // the earliest `start` across columns and extend to the latest `end`.
  const openCols = columns.filter((c) => c.open);
  const gridStartMin =
    openCols.length === 0
      ? timeToMinutes(hours.days.mon.open ? hours.days.mon.start : '10:00')
      : openCols.reduce(
          (min, c) => Math.min(min, timeToMinutes(c.startTime)),
          Number.POSITIVE_INFINITY,
        );
  const gridEndMin =
    openCols.length === 0
      ? gridStartMin + 8 * 60
      : openCols.reduce((max, c) => Math.max(max, timeToMinutes(c.endTime)), 0);
  const totalMinutes = gridEndMin - gridStartMin;
  const gridHeightPx = totalMinutes * PX_PER_MIN;

  const hourLabels: number[] = [];
  for (let m = Math.ceil(gridStartMin / 60) * 60; m <= gridEndMin; m += 60) {
    hourLabels.push(m);
  }

  // Group appointments by their local day for fast per-column rendering.
  const byDay = new Map<string, AppointmentDto[]>();
  for (const a of appointments) {
    const day = toLocalParts(new Date(a.scheduledFor)).date;
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day)!.push(a);
  }

  return (
    <div
      className="grid border-t border-line"
      style={{
        gridTemplateColumns: `56px repeat(${columns.length}, minmax(0, 1fr))`,
      }}
    >
      {/* Header row */}
      <div className="bg-surface-subtle border-r border-line" />
      {columns.map((col) => {
        const isToday = col.date === todayIso;
        const [, m, d] = col.date.split('-');
        return (
          <div
            key={`head-${col.date}`}
            className={cn(
              'bg-surface-subtle border-r border-line last:border-r-0 px-3 py-2.5',
            )}
          >
            <div
              className={cn(
                'text-[11px] uppercase tracking-[0.08em] font-medium',
                isToday ? 'text-primary-dark' : 'text-ink-muted',
              )}
            >
              {dayLabelShort(col.weekday)}
              {isToday ? ' · sot' : ''}
            </div>
            <div
              className={cn(
                'font-display text-[18px] font-semibold mt-0.5 tabular-nums',
                isToday ? 'text-primary-dark' : 'text-ink',
              )}
            >
              {Number(d)}
              {Number(d) === 1 ? <span className="text-[10px] text-ink-faint font-normal ml-1">{m}</span> : null}
            </div>
          </div>
        );
      })}

      {/* Body row */}
      <div className="relative border-r border-line" style={{ height: gridHeightPx }}>
        {hourLabels.map((m, idx) => (
          <div
            key={m}
            className="absolute right-0 left-0"
            style={{ top: (m - gridStartMin) * PX_PER_MIN }}
          >
            <span
              className={cn(
                'absolute right-2 text-[11px] text-ink-faint tabular-nums bg-surface-elevated px-1',
                idx === 0 ? 'top-1' : '-top-[7px]',
              )}
            >
              {minutesToTime(m)}
            </span>
          </div>
        ))}
      </div>

      {columns.map((col) => {
        const dayAppts = byDay.get(col.date) ?? [];
        const isToday = col.date === todayIso;
        const colStartMin = col.open ? timeToMinutes(col.startTime) : gridStartMin;
        const colEndMin = col.open ? timeToMinutes(col.endTime) : gridStartMin;
        const closedTopOffset = (colStartMin - gridStartMin) * PX_PER_MIN;
        const closedBandTop = colEndMin - gridStartMin;
        return (
          <DayColumnBody
            key={col.date}
            col={col}
            todayIso={todayIso}
            isToday={isToday}
            now={now}
            gridStartMin={gridStartMin}
            gridHeightPx={gridHeightPx}
            colStartOffsetPx={closedTopOffset}
            colEndOffsetPx={closedBandTop * PX_PER_MIN}
            appointments={dayAppts}
            onSlotClick={onSlotClick}
            onAppointmentClick={onAppointmentClick}
          />
        );
      })}
    </div>
  );
}

interface DayColumnBodyProps {
  col: DayColumn;
  todayIso: string;
  isToday: boolean;
  now: Date;
  gridStartMin: number;
  gridHeightPx: number;
  colStartOffsetPx: number;
  colEndOffsetPx: number;
  appointments: AppointmentDto[];
  onSlotClick: CalendarGridProps['onSlotClick'];
  onAppointmentClick: CalendarGridProps['onAppointmentClick'];
}

function DayColumnBody({
  col,
  isToday,
  now,
  gridStartMin,
  gridHeightPx,
  colStartOffsetPx,
  colEndOffsetPx,
  appointments,
  onSlotClick,
  onAppointmentClick,
}: DayColumnBodyProps): ReactElement {
  const handleClick = (event: React.MouseEvent<HTMLDivElement>): void => {
    if (!col.open) return;
    if ((event.target as HTMLElement).closest('[data-appt]')) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const y = event.clientY - rect.top;
    const minFromStart = Math.max(0, Math.round(y / PX_PER_MIN / 10) * 10);
    const colStart = timeToMinutes(col.startTime);
    const colEnd = timeToMinutes(col.endTime);
    const targetMin = (gridStartMin + minFromStart);
    if (targetMin < colStart || targetMin + 10 > colEnd) return;
    onSlotClick({ date: col.date, time: minutesToTime(targetMin) });
  };

  const nowLineTop = (() => {
    if (!isToday) return null;
    const parts = toLocalParts(now);
    if (parts.date !== col.date) return null;
    const min = timeToMinutes(parts.time);
    const top = (min - gridStartMin) * PX_PER_MIN;
    if (top < 0 || top > gridHeightPx) return null;
    return { top, label: parts.time };
  })();

  return (
    <div
      className={cn(
        'relative border-r border-line last:border-r-0 cursor-pointer',
        !col.open && 'cursor-not-allowed bg-surface-subtle',
        isToday && col.open && 'bg-teal-50/30',
      )}
      style={{
        height: gridHeightPx,
        backgroundImage: col.open
          ? `repeating-linear-gradient(to bottom, transparent 0, transparent 19px, var(--border-soft, #f0efec) 19px, var(--border-soft, #f0efec) 20px), repeating-linear-gradient(to bottom, transparent 0, transparent 118px, var(--border-strong, #d6d3d1) 118px, var(--border-strong, #d6d3d1) 120px)`
          : 'repeating-linear-gradient(135deg, transparent 0, transparent 6px, rgba(0,0,0,0.025) 6px, rgba(0,0,0,0.025) 7px)',
      }}
      onClick={handleClick}
      role="grid"
      aria-label={col.open ? `Kolonë termin për ${col.date}` : `Klinika e mbyllur ${col.date}`}
    >
      {/* Closed pre-open band (if column opens later than the grid start) */}
      {col.open && colStartOffsetPx > 0 ? (
        <div
          className="absolute left-0 right-0 flex items-center justify-center gap-1.5 border-y border-dashed border-line-strong bg-surface-subtle text-[10.5px] uppercase tracking-[0.08em] text-ink-faint"
          style={{ top: 0, height: colStartOffsetPx }}
        >
          Mbyllur
        </div>
      ) : null}
      {/* Closed post-close band (if column closes earlier than grid end) */}
      {col.open && colEndOffsetPx < gridHeightPx ? (
        <div
          className="absolute left-0 right-0 flex items-center justify-center gap-1.5 border-y border-dashed border-line-strong bg-surface-subtle text-[10.5px] uppercase tracking-[0.08em] text-ink-faint"
          style={{ top: colEndOffsetPx, bottom: 0 }}
        >
          Mbyllur
        </div>
      ) : null}
      {!col.open ? (
        <div className="absolute inset-0 flex items-center justify-center text-[11px] uppercase tracking-[0.08em] text-ink-faint">
          Mbyllur
        </div>
      ) : null}

      {appointments.map((a) => (
        <AppointmentCard
          key={a.id}
          appointment={a}
          gridStartMin={gridStartMin}
          onClick={(ev) =>
            onAppointmentClick(a, { x: ev.clientX, y: ev.clientY })
          }
        />
      ))}

      {nowLineTop ? (
        <div
          className="absolute -left-[2px] right-0 h-[2px] bg-primary z-10 pointer-events-none"
          style={{ top: nowLineTop.top }}
          aria-hidden="true"
        >
          <span className="absolute -left-1 -top-1 w-2.5 h-2.5 bg-primary rounded-full ring-2 ring-surface-elevated" />
          <span className="absolute -left-[56px] -top-2 text-[10px] font-semibold text-primary bg-surface-elevated px-1 rounded tabular-nums">
            {nowLineTop.label}
          </span>
        </div>
      ) : null}
    </div>
  );
}

interface AppointmentCardProps {
  appointment: AppointmentDto;
  gridStartMin: number;
  onClick: (event: React.MouseEvent) => void;
}

function AppointmentCard({
  appointment,
  gridStartMin,
  onClick,
}: AppointmentCardProps): ReactElement {
  const start = new Date(appointment.scheduledFor);
  const localParts = toLocalParts(start);
  const startMin = timeToMinutes(localParts.time);
  const top = (startMin - gridStartMin) * PX_PER_MIN;
  const height = appointment.durationMinutes * PX_PER_MIN;
  const color = colorIndicatorForLastVisit(appointment.lastVisitAt);

  const isCompleted = appointment.status === 'completed';
  const isNoShow = appointment.status === 'no_show';
  const isCancelled = appointment.status === 'cancelled';
  const isNew = appointment.isNewPatient;

  return (
    <button
      type="button"
      data-appt={appointment.id}
      data-status={appointment.status}
      onClick={(e) => {
        e.stopPropagation();
        onClick(e);
      }}
      title={`${appointment.patient.firstName} ${appointment.patient.lastName} · ${formatDob(appointment.patient.dateOfBirth)} · ${STATUS_LABEL[appointment.status]}`}
      className={cn(
        'absolute left-1.5 right-1.5 px-2 py-0.5 rounded text-left border bg-surface-elevated border-teal-200 border-l-[3px] border-l-primary shadow-xs transition hover:-translate-y-px hover:shadow-sm z-[3] flex items-center gap-1.5 overflow-hidden',
        isCompleted &&
          'bg-success-bg/50 border-success-soft border-l-success opacity-90',
        isNoShow && 'border border-dashed border-danger-soft border-l-danger opacity-70',
        isCancelled && 'opacity-50',
        isNew && !isCompleted && !isNoShow && 'border-l-accent-500 border-warning-soft',
      )}
      style={{ top, height: Math.max(20, height) }}
      aria-label={`${appointment.patient.firstName} ${appointment.patient.lastName}, ${localParts.time}, ${STATUS_LABEL[appointment.status]}`}
    >
      <span className="flex-1 min-w-0 text-[11.5px] font-semibold text-ink-strong truncate leading-[1.15]">
        <span
          className={cn(
            isCompleted && 'text-success',
            isNoShow && 'text-danger line-through decoration-1',
            isCancelled && 'line-through text-ink-faint',
          )}
        >
          {appointment.patient.firstName} {appointment.patient.lastName}
        </span>
      </span>
      <span className="flex-none flex items-center gap-1 text-[10.5px] text-ink-muted tabular-nums">
        {isCompleted ? (
          <span aria-hidden className="text-success font-bold">✓</span>
        ) : null}
        {isNoShow ? (
          <span
            className="text-[9px] font-bold uppercase rounded bg-danger-bg text-danger px-1"
            aria-hidden
          >
            MS
          </span>
        ) : null}
        <ColorChip color={color} />
        <span className="hidden sm:inline">{localParts.time}</span>
      </span>
    </button>
  );
}

export function ColorChip({ color }: { color: LastVisitColor }): ReactElement | null {
  if (!color) return null;
  const colorStyles: Record<NonNullable<LastVisitColor>, string> = {
    green: 'bg-success',
    yellow: 'bg-warning',
    red: 'bg-danger',
  };
  const label: Record<NonNullable<LastVisitColor>, string> = {
    green: 'Vizita e fundit më shumë se 30 ditë',
    yellow: 'Vizita e fundit 7–30 ditë',
    red: 'Vizita e fundit brenda 7 ditëve',
  };
  return (
    <span
      aria-label={label[color]}
      title={label[color]}
      className={cn('inline-block w-2 h-2 rounded-full', colorStyles[color])}
    />
  );
}
