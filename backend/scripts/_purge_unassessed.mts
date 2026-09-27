import { rm } from 'node:fs/promises';
import { join } from 'node:path';

import mongoose from 'mongoose';

// One-off: remove the records that never reached a verdict — abandoned drafts
// with no photographs and one scan stuck in PROCESSING.
await mongoose.connect('mongodb://127.0.0.1:27017', { dbName: 'sih26034', serverSelectionTimeoutMS: 5000 });
const col = mongoose.connection.db!.collection('inspections');

const targets = await col
  .find({ complianceResult: { $exists: false } }, { projection: { inspectionId: 1, status: 1, 'business.name': 1 } })
  .toArray();

for (const r of targets) {
  await rm(join(process.cwd(), 'uploads', 'inspections', r.inspectionId), { recursive: true, force: true });
  console.log('removing', r.inspectionId, r.status, r.business?.name);
}

const { deletedCount } = await col.deleteMany({ _id: { $in: targets.map((r) => r._id) } });
console.log('deleted', deletedCount);
console.log('remaining', await col.countDocuments());

await mongoose.disconnect();
