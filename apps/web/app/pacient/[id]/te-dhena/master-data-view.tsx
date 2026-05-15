'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState, type ReactElement } from 'react';

import { ClinicTopNav } from '@/components/clinic-top-nav';
import { EmptyState } from '@/components/empty-state';
import { ApiError } from '@/lib/api';
import { chartPath, isPatientComplete } from '@/lib/patient';
import { patientClient, type PatientFullDto } from '@/lib/patient-client';
import { useMe } from '@/lib/use-me';

import { PatientFullForm } from '@/app/doctor/pacientet/patient-full-form';

interface Props {
  patientId: string;
}

/**
 * Doctor master-data page — the "Të dhënat e pacientit" form sitting
 * under each patient's chart route.
 *
 * Entry-points:
 *   * `navigateToPatient(id)` lands here when the patient is missing
 *     any of the four required fields (firstName, lastName,
 *     dateOfBirth, sex). The chart view redirects here on the same
 *     condition, so a doctor who tries to deep-link past the gate
 *     ends up on this form anyway.
 *   * "Të dhënat e pacientit" link in the chart's master strip — used
 *     by the doctor to edit master data on an already-complete
 *     patient (phone, allergies, etc.) without leaving the chart for
 *     long.
 *
 * On save: if the patient transitions from incomplete → complete
 * (via `PatientFullForm`'s `onCompleted` callback), navigate to the
 * chart. Subsequent saves on the same mount don't re-fire navigation
 * so the doctor can edit additional fields after the transition.
 */
export function MasterDataView({ patientId }: Props): ReactElement {
  const router = useRouter();
  const { me } = useMe();
  const [patient, setPatient] = useState<PatientFullDto | null>(null);
  const [error, setError] = useState<'forbidden' | 'not-found' | 'unknown' | null>(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    setPatient(null);
    (async () => {
      try {
        const res = await patientClient.getOne(patientId);
        if (!cancelled) setPatient(res.patient);
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

  const handleSaved = useCallback((p: PatientFullDto) => {
    setPatient(p);
  }, []);

  const handleCompleted = useCallback(
    (p: PatientFullDto) => {
      // Patient just transitioned to complete — auto-route to the
      // chart. `router.replace` so the back button takes the doctor
      // to wherever they came from (the dashboard, the patient list)
      // rather than bouncing back to the form they just submitted.
      router.replace(chartPath(p.id));
    },
    [router],
  );

  if (error === 'forbidden') return <ForbiddenView />;
  if (error === 'not-found') return <NotFoundView />;
  if (error === 'unknown') return <UnknownErrorView />;

  return (
    <main className="min-h-screen bg-surface pb-12">
      <ClinicTopNav me={me} />

      <div className="mx-auto max-w-page px-page-x pt-6">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h1 className="font-display text-[22px] font-semibold text-ink-strong">
            Të dhënat e pacientit
          </h1>
          <ChartLink patient={patient} patientId={patientId} />
        </div>

        <section className="rounded-lg border border-line bg-surface-elevated">
          {patient ? (
            <PatientFullForm
              key={patient.id}
              mode="edit"
              patient={patient}
              onSaved={handleSaved}
              onCancel={() => router.back()}
              onCompleted={handleCompleted}
            />
          ) : (
            <div className="flex h-[400px] items-center justify-center text-[13px] text-ink-muted">
              Po ngarkohet…
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

function ChartLink({
  patient,
  patientId,
}: {
  patient: PatientFullDto | null;
  patientId: string;
}): ReactElement {
  // Use the local form's truth for "complete enough" rather than the
  // server flag — the doctor may have edited fields that haven't yet
  // hit the server. The server flag updates on the next save.
  const ready = patient ? isPatientComplete(patient) : false;
  if (!ready) {
    return (
      <span
        aria-disabled
        className="cursor-not-allowed text-[13px] text-ink-faint"
        title="Plotëso 4 fushat e detyrueshme për të hapur kartelën"
      >
        Te kartela →
      </span>
    );
  }
  return (
    <Link
      href={chartPath(patientId)}
      className="text-[13px] font-medium text-primary hover:underline"
    >
      Te kartela →
    </Link>
  );
}

function ForbiddenView(): ReactElement {
  return (
    <main className="grid min-h-screen place-items-center bg-surface px-6 py-10">
      <EmptyState
        tall
        tone="amber"
        code="Gabim 403"
        title="Ju nuk keni qasje në këtë seksion"
        subtitle="Të dhënat e pacientit janë të dukshme vetëm për mjekun."
        icon={<LockIcon />}
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

function NotFoundView(): ReactElement {
  return (
    <main className="grid min-h-screen place-items-center bg-surface px-6 py-10">
      <EmptyState
        tall
        code="Gabim 404"
        title="Pacienti nuk u gjet"
        subtitle="Linku mund të jetë i vjetëruar."
        icon={<SearchIcon />}
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

function UnknownErrorView(): ReactElement {
  return (
    <main className="grid min-h-screen place-items-center bg-surface px-6 py-10">
      <EmptyState
        tall
        tone="amber"
        title="Diçka shkoi keq"
        subtitle="Provoni përsëri pasi lidhja kthehet."
        icon={<WarningIcon />}
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

function LockIcon(): ReactElement {
  return (
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
  );
}

function SearchIcon(): ReactElement {
  return (
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
  );
}

function WarningIcon(): ReactElement {
  return (
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
  );
}
