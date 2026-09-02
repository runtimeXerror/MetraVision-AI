import { randomBytes } from 'node:crypto';

import { Counter } from '../models/Counter';

/**
 * Human-facing reference numbers.
 *
 * `INS-2026-00001`. The sequence is drawn from an atomic `findOneAndUpdate`
 * with `$inc` rather than from a `countDocuments()`, because two inspectors
 * creating an inspection in the same second would otherwise both read the same
 * count and mint a duplicate reference.
 */
export async function nextInspectionReference(date = new Date()): Promise<string> {
  const year = date.getFullYear();
  const sequence = await nextSequence(`inspection:${year}`);
  return `INS-${year}-${String(sequence).padStart(5, '0')}`;
}

/** Atomically increments and returns the next value for a named counter. */
export async function nextSequence(key: string): Promise<number> {
  const counter = await Counter.findOneAndUpdate(
    { _id: key },
    { $inc: { value: 1 } },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  ).lean();

  return counter?.value ?? 1;
}

/** Opaque id for images and other embedded documents. */
export function generateId(prefix: string): string {
  return `${prefix}_${randomBytes(8).toString('hex')}`;
}

/** Departmental badge number, e.g. `LM-INS-4471`. */
export function inspectorBadge(role: 'INSPECTOR' | 'SUPERVISOR' | 'ADMIN', sequence: number): string {
  const segment = role === 'ADMIN' ? 'ADM' : role === 'SUPERVISOR' ? 'SUP' : 'INS';
  return `LM-${segment}-${String(sequence).padStart(4, '0')}`;
}
