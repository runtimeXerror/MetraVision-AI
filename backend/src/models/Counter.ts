import { Schema, model } from 'mongoose';

/**
 * Atomic sequence counters.
 *
 * Backs `INS-2026-00001` reference numbers. A separate collection rather than a
 * `countDocuments()` because two inspectors creating a record in the same
 * second would otherwise read the same count and mint a duplicate reference.
 */
export interface CounterAttrs {
  _id: string;
  value: number;
}

const counterSchema = new Schema<CounterAttrs>(
  {
    _id: { type: String, required: true },
    value: { type: Number, default: 0 },
  },
  { versionKey: false },
);

export const Counter = model<CounterAttrs>('Counter', counterSchema);
