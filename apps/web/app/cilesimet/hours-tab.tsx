'use client';

import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ApiError } from '@/lib/api';
import {
  clinicClient,
  type ClinicSettings,
  DAY_LABELS,
  DAY_ORDER,
  type DayKey,
  type HoursConfig,
  type HoursDay,
} from '@/lib/clinic-client';
import { InfoTip, PaneHeader, SectionCard } from './section-card';

interface Props {
  settings: ClinicSettings;
  onChange: (next: ClinicSettings) => void;
  onToast: (msg: string, tone?: 'success' | 'error') => void;
}

const TIME_OPTIONS: string[] = [];
for (let h = 6; h <= 22; h += 1) {
  for (const m of [0, 30]) {
    TIME_OPTIONS.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
  }
}

export function HoursTab({ settings, onChange, onToast }: Props) {
  const [hours, setHours] = useState<HoursConfig>(() => structuredClone(settings.hours));
  const [walkinDuration, setWalkinDuration] = useState<number>(
    settings.general.walkinDurationMinutes,
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setHours(structuredClone(settings.hours));
  }, [settings.hours]);

  useEffect(() => {
    setWalkinDuration(settings.general.walkinDurationMinutes);
  }, [settings.general.walkinDurationMinutes]);

  function setWalkin(raw: string): void {
    // Number input may emit '' when the field is cleared mid-edit. Treat
    // it as a sentinel by keeping the previous value rather than NaN.
    const parsed = Number.parseInt(raw, 10);
    if (Number.isFinite(parsed)) {
      setWalkinDuration(parsed);
    }
  }

  function resetDurations(): void {
    setHours((h) => ({
      ...h,
      durations: [...settings.hours.durations],
      defaultDuration: settings.hours.defaultDuration,
    }));
    setWalkinDuration(settings.general.walkinDurationMinutes);
  }

  function setDay(day: DayKey, value: HoursDay): void {
    setHours((h) => ({ ...h, days: { ...h.days, [day]: value } }));
  }

  function setOpen(day: DayKey, open: boolean): void {
    if (open) {
      const current = hours.days[day];
      const start = current.open ? current.start : '09:00';
      const end = current.open ? current.end : '17:00';
      setDay(day, { open: true, start, end });
    } else {
      setDay(day, { open: false });
    }
  }

  function applyMondayToAll(): void {
    const mon = hours.days.mon;
    if (!mon.open) {
      onToast('E hëna është mbyllur — nuk ka çfarë të kopjosh.', 'error');
      return;
    }
    setHours((h) => {
      const next = { ...h, days: { ...h.days } };
      for (const day of DAY_ORDER) {
        if (day === 'sun' || day === 'mon') continue;
        if (next.days[day].open) {
          next.days[day] = { open: true, start: mon.start, end: mon.end };
        }
      }
      return next;
    });
    onToast('Orari i së hënës u aplikua për ditët e hapura.');
  }

  function toggleDuration(d: number): void {
    setHours((h) => {
      const has = h.durations.includes(d);
      const durations = has ? h.durations.filter((x) => x !== d) : [...h.durations, d].sort((a, b) => a - b);
      if (durations.length === 0) return h;
      let defaultDuration = h.defaultDuration;
      if (!durations.includes(defaultDuration)) defaultDuration = durations[0]!;
      return { ...h, durations, defaultDuration };
    });
  }

  async function addCustomDuration(): Promise<void> {
    const raw = window.prompt('Sa minuta? (1–120)', '12');
    if (!raw) return;
    const n = Math.trunc(Number(raw));
    if (!Number.isFinite(n) || n < 1 || n > 120) {
      onToast('Vendos një vlerë midis 1 dhe 120.', 'error');
      return;
    }
    setHours((h) => {
      if (h.durations.includes(n)) return h;
      const durations = [...h.durations, n].sort((a, b) => a - b);
      return { ...h, durations };
    });
  }

  async function persistChanges(): Promise<ClinicSettings> {
    let next = settings;
    if (!shallowEqualJson(hours, settings.hours)) {
      next = await clinicClient.updateHours(hours);
      onChange(next);
    }
    if (walkinDuration !== settings.general.walkinDurationMinutes) {
      next = await clinicClient.updateGeneral({
        name: next.general.name,
        shortName: next.general.shortName,
        address: next.general.address,
        city: next.general.city,
        phones: next.general.phones,
        email: next.general.email,
        walkinDurationMinutes: walkinDuration,
      });
      onChange(next);
    }
    return next;
  }

  async function save(): Promise<void> {
    setSaving(true);
    setError(null);
    try {
      const next = await persistChanges();
      onToast(`Orari u ruajt · ${openDayCount(next.hours)} ditë të hapura.`);
    } catch (err: unknown) {
      const message = err instanceof ApiError ? err.message : 'Ruajtja dështoi.';
      setError(message);
      onToast(message, 'error');
    } finally {
      setSaving(false);
    }
  }

  async function saveDurations(): Promise<void> {
    setSaving(true);
    setError(null);
    try {
      await persistChanges();
      onToast('Cilësimet u ruajtën.');
    } catch (err: unknown) {
      const message = err instanceof ApiError ? err.message : 'Ruajtja dështoi.';
      setError(message);
      onToast(message, 'error');
    } finally {
      setSaving(false);
    }
  }

  const today = todayDayKey();

  return (
    <>
      <PaneHeader
        title="Orari dhe terminet"
        description="Orari i punës për çdo ditë dhe kohëzgjatjet që mund të caktohen. Drejton kalendarin e recepsionit."
      />

      <SectionCard
        title="Orari i punës"
        description="Një interval i vetëm hapje–mbyllje për çdo ditë të hapur."
      >
        <div className="flex flex-col">
          {DAY_ORDER.map((day) => {
            const d = hours.days[day];
            const isToday = day === today;
            const isOpen = d.open;
            return (
              <div
                key={day}
                data-testid={`day-${day}`}
                className="grid grid-cols-[140px_130px_1fr] gap-4 py-3 border-b border-stone-100 last:border-0 items-center"
              >
                <div className="text-[14px] font-medium text-stone-900 flex items-center gap-2">
                  {DAY_LABELS[day]}
                  {isToday ? (
                    <span className="font-mono uppercase text-[9.5px] tracking-[0.05em] text-teal-800 bg-teal-50 border border-teal-200 px-1.5 py-px rounded-full">
                      Sot
                    </span>
                  ) : null}
                  {!isOpen ? (
                    <span className="font-mono uppercase text-[9.5px] tracking-[0.05em] text-stone-400 bg-stone-50 border border-stone-200 px-1.5 py-px rounded-full">
                      Mbyllur
                    </span>
                  ) : null}
                </div>
                <select
                  className={`w-full text-[13px] font-medium rounded-md border border-stone-300 px-3 py-1.5 ${
                    isOpen ? 'bg-white text-stone-800' : 'bg-stone-50 text-stone-500'
                  }`}
                  value={isOpen ? 'open' : 'closed'}
                  onChange={(e) => setOpen(day, e.target.value === 'open')}
                  data-testid={`day-state-${day}`}
                >
                  <option value="open">Hapur</option>
                  <option value="closed">Mbyllur</option>
                </select>
                <div>
                  {isOpen ? (
                    <div className="flex items-center gap-2">
                      <select
                        className="w-[84px] py-1.5 px-2 text-[13px] font-mono text-center rounded-md border border-stone-300"
                        value={d.start}
                        onChange={(e) => setDay(day, { ...d, start: e.target.value })}
                        data-testid={`day-start-${day}`}
                      >
                        {timeOptionsIncluding(d.start).map((t) => (
                          <option key={t} value={t}>
                            {t}
                          </option>
                        ))}
                      </select>
                      <span className="text-stone-400 font-mono text-[13px]">—</span>
                      <select
                        className="w-[84px] py-1.5 px-2 text-[13px] font-mono text-center rounded-md border border-stone-300"
                        value={d.end}
                        onChange={(e) => setDay(day, { ...d, end: e.target.value })}
                        data-testid={`day-end-${day}`}
                      >
                        {timeOptionsIncluding(d.end).map((t) => (
                          <option key={t} value={t}>
                            {t}
                          </option>
                        ))}
                      </select>
                      {d.start >= d.end ? (
                        <span className="ml-2 text-[11.5px] text-amber-700">
                          Mbyllja duhet pas hapjes
                        </span>
                      ) : null}
                    </div>
                  ) : (
                    <div className="text-stone-500 text-[13px] italic">
                      {day === 'sun'
                        ? 'Klinika nuk pranon termine të dielën.'
                        : 'Mbyllur.'}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <div className="mt-5 flex items-center justify-between gap-3.5 flex-wrap">
          <button
            type="button"
            onClick={applyMondayToAll}
            className="text-[13px] text-teal-700 font-medium border border-teal-300 hover:bg-teal-50 rounded-md px-3 py-1.5"
            data-testid="apply-monday"
          >
            Apliko orarin e së hënës për të gjitha ditët
          </button>
          <div className="flex gap-2">
            <Button
              variant="ghost"
              onClick={() => setHours(structuredClone(settings.hours))}
              disabled={saving}
            >
              Anulo
            </Button>
            <Button onClick={save} disabled={saving} data-testid="hours-save">
              {saving ? 'Po ruhet…' : 'Ruaj orarin'}
            </Button>
          </div>
        </div>
        {error ? (
          <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 text-amber-900 text-[12.5px] px-3 py-2">
            {error}
          </div>
        ) : null}
      </SectionCard>

      <SectionCard
        title="Kohëzgjatja e termineve"
        description="Zgjidh kohëzgjatjet që ofrohen për të caktuar terminet. Të paktën një është e nevojshme."
      >
        <div className="grid grid-cols-3 gap-2">
          {[10, 15, 20, 30, 45, 60, ...hours.durations.filter((d) => ![10, 15, 20, 30, 45, 60].includes(d))]
            .filter((v, i, arr) => arr.indexOf(v) === i)
            .map((d) => {
              const selected = hours.durations.includes(d);
              const isDefault = hours.defaultDuration === d;
              return (
                <label
                  key={d}
                  className={`flex items-center gap-2.5 px-3.5 py-2.5 rounded-md border cursor-pointer transition-colors ${
                    selected
                      ? 'border-teal-500 bg-teal-50'
                      : 'border-stone-300 bg-white hover:border-stone-400'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={selected}
                    onChange={() => toggleDuration(d)}
                    className="accent-teal-600"
                    data-testid={`dur-${d}`}
                  />
                  <span className="font-display text-[15px] font-semibold tabular-nums text-stone-900">
                    {d}
                    <span className="ml-0.5 font-sans text-[12px] text-stone-500 font-medium">min</span>
                  </span>
                  {isDefault ? (
                    <span className="ml-auto font-mono uppercase text-[9.5px] tracking-[0.05em] text-teal-800 bg-teal-100 border border-teal-200 px-1.5 py-px rounded">
                      Parazgjedhur
                    </span>
                  ) : null}
                </label>
              );
            })}
        </div>

        <div className="mt-3">
          <button
            type="button"
            className="text-[12.5px] text-teal-700 border border-dashed border-teal-300 rounded-md px-3 py-1.5 hover:bg-teal-50 font-medium"
            onClick={addCustomDuration}
          >
            + Shto kohëzgjatje
          </button>
        </div>

        <div className="mt-4 pt-4 border-t border-stone-100 flex items-center gap-3">
          <span className="text-[13px] text-stone-500 font-medium">Kohëzgjatja e parazgjedhur</span>
          <select
            className="rounded-md border border-stone-300 px-3 py-1.5 text-[13px] font-mono tabular-nums"
            value={hours.defaultDuration}
            onChange={(e) =>
              setHours((h) => ({ ...h, defaultDuration: Number(e.target.value) }))
            }
            data-testid="default-duration"
          >
            {hours.durations.map((d) => (
              <option key={d} value={d}>
                {d} minuta
              </option>
            ))}
          </select>
          <span className="text-[12px] text-stone-400">— shfaqet e zgjedhur në dialogun e caktimit.</span>
        </div>

        <div className="mt-4 pt-4 border-t border-stone-100">
          <div className="flex items-center gap-3">
            <label
              htmlFor="walkinDuration"
              className="text-[13px] text-stone-500 font-medium"
            >
              Kohëzgjatja e termineve pa termin (minuta)
            </label>
            <Input
              id="walkinDuration"
              type="number"
              min={5}
              max={60}
              step={5}
              value={walkinDuration}
              onChange={(e) => setWalkin(e.target.value)}
              className="w-[72px]"
              data-testid="walkin-duration"
            />
          </div>
          <div className="mt-1.5 text-[12px] text-stone-400">
            Sa minuta ndahen midis dy pacientëve pa termin që vijnë në të njëjtën kohë.
          </div>
        </div>

        <div className="mt-4">
          <InfoTip>
            Rezolucioni i kalendarit ndjek kohëzgjatjen më të shkurtër të zgjedhur. Me 10 min të
            zgjedhura, kalendari shfaq një ndarje çdo 10 minuta.
          </InfoTip>
        </div>

        <div className="mt-5 pt-4 border-t border-stone-100 flex justify-end gap-2">
          <Button variant="ghost" onClick={resetDurations} disabled={saving}>
            Anulo
          </Button>
          <Button
            onClick={saveDurations}
            disabled={saving}
            data-testid="durations-save"
          >
            {saving ? 'Po ruhet…' : 'Ruaj'}
          </Button>
        </div>
      </SectionCard>
    </>
  );
}

function timeOptionsIncluding(value: string): string[] {
  if (TIME_OPTIONS.includes(value)) return TIME_OPTIONS;
  return [...TIME_OPTIONS, value].sort();
}

function openDayCount(h: HoursConfig): number {
  return DAY_ORDER.filter((d) => h.days[d].open).length;
}

function shallowEqualJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function todayDayKey(): DayKey | null {
  if (typeof window === 'undefined') return null;
  const dow = new Date().getDay(); // 0=Sun
  const map: DayKey[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  return map[dow] ?? null;
}
