/**
 * Identifier generation.
 *
 * Phase 1 mints ids on the device. In Phase 2 the backend becomes the authority
 * for `referenceId` — the client-side value then acts as an idempotency key for
 * the create call, which is exactly what an offline queue needs.
 */

/** Reasonably unique id without pulling in a uuid dependency. */
export function generateId(prefix = 'id'): string {
  const time = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${time}${random}`;
}

/**
 * Human-facing inspection reference: `INS-2026-001`.
 *
 * `sequence` is the count of inspections already recorded this year. The
 * backend will compute this atomically later; locally it is derived from the
 * history store, which is good enough for a single-device demo.
 */
export function generateReferenceId(sequence: number, date: Date = new Date()): string {
  const year = date.getFullYear();
  return `INS-${year}-${`${sequence}`.padStart(3, '0')}`;
}

/** Report reference: `RPT-2026-001`. */
export function generateReportReference(sequence: number, date: Date = new Date()): string {
  const year = date.getFullYear();
  return `RPT-${year}-${`${sequence}`.padStart(3, '0')}`;
}
