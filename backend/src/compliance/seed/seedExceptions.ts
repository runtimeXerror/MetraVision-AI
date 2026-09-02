import { RuleException } from '../../models/RuleException';
import { RULE_EXCEPTIONS } from '../data/exceptions';

/**
 * Projects the exemptions into MongoDB.
 *
 * Keyed on `(exceptionId, effectiveFrom)` — the same pair the collection's
 * unique index uses — because an exception id names four different texts of
 * rule 26(a), and overwriting them into one row would lose the history that
 * makes the pan masala and tobacco carve-outs datable.
 */
export async function seedExceptions(options: { reset?: boolean } = {}): Promise<number> {
  if (options.reset) await RuleException.deleteMany({});

  const operations = RULE_EXCEPTIONS.map((exception) => ({
    updateOne: {
      filter: { exceptionId: exception.exceptionId, effectiveFrom: exception.effectiveFrom },
      update: { $set: exception },
      upsert: true,
    },
  }));

  if (operations.length > 0) await RuleException.bulkWrite(operations, { ordered: false });
  return RULE_EXCEPTIONS.length;
}
