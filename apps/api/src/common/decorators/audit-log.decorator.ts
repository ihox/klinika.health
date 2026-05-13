import { SetMetadata } from '@nestjs/common';

export const AUDIT_LOG_METADATA_KEY = 'klinika:audit-log';

export interface AuditLogMetadata {
  action: string;
  resourceType?: string;
}

/**
 * Mark a controller handler so the audit interceptor writes an
 * `audit_log` row after a successful response. The interceptor reads
 * the resource ID from the response body (`id`) or `params.id`, the
 * actor from `RequestContext`, and the change set from a thread-local
 * field-diff buffer (set by the service via `AuditLogService.recordDiff`).
 *
 *   @AuditLog('visit.created')
 *   @AuditLog('auth.login.success', { resourceType: 'session' })
 *
 * For sensitive READS (chart open, vërtetim print) the `changes`
 * column is left NULL — same decorator, the service simply doesn't
 * call `recordDiff`. The decorator's job is to declare intent; the
 * interceptor handles the write.
 */
export const AuditLog = (action: string, options: { resourceType?: string } = {}) =>
  SetMetadata(AUDIT_LOG_METADATA_KEY, { action, resourceType: options.resourceType });
