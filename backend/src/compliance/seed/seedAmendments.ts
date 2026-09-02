import { Amendment } from '../../models/Amendment';
import { AMENDMENTS } from '../data/amendments';

/**
 * Projects the amendment registry into MongoDB.
 *
 * Idempotent by `notificationNumber`: reseeding updates in place rather than
 * duplicating, so the seeder can run on every boot without the registry
 * growing a second copy of G.S.R. 202(E) each time.
 */
export async function seedAmendments(options: { reset?: boolean } = {}): Promise<number> {
  if (options.reset) await Amendment.deleteMany({});

  const operations = AMENDMENTS.map((amendment) => ({
    updateOne: {
      filter: { notificationNumber: amendment.notificationNumber },
      update: { $set: amendment },
      upsert: true,
    },
  }));

  if (operations.length > 0) await Amendment.bulkWrite(operations, { ordered: false });
  return AMENDMENTS.length;
}
