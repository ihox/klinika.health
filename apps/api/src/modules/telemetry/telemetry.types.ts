/**
 * Wire format for tenant → platform heartbeats.
 *
 * **No PHI.** Reviewers and tests assert this contract holds: every
 * field here is metadata about the host or queue state, never patient
 * data. The freeform `payload` is reserved for future metric extension
 * but must be vetted for PHI before adding anything to it — see the
 * `telemetry-payload-no-phi.spec.ts` test that scans the constructed
 * object for any of the redaction field names.
 */
export interface HeartbeatPayload {
  tenantId: string;
  version: string;
  emittedAt: string;
  appHealthy: boolean;
  dbHealthy: boolean;
  orthancHealthy: boolean;
  cpuPercent: number;
  ramPercent: number;
  diskPercent: number;
  lastBackupAt: string | null;
  activeSessions: number;
  queueDepth: number;
  errorRate5xx: number;
}
