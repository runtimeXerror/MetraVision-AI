import { MongoMemoryServer } from 'mongodb-memory-server';
import { spawnSync } from 'node:child_process';
import { MongoClient } from 'mongodb';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dbPath = mkdtempSync(join(tmpdir(), 'atlas-stand-in-'));
let server;
try {
  server = await MongoMemoryServer.create({ instance: { dbName: 'metravision', dbPath, launchTimeout: 60_000 } });
  const uri = server.getUri();

  const run = spawnSync('node', ['scripts/migrate-to-atlas.mjs'], {
    env: { ...process.env, MONGODB_URI_ATLAS: uri },
    encoding: 'utf8',
  });
  console.log(run.stdout || run.stderr);

  // Independently confirm what actually landed.
  const c = new MongoClient(uri);
  await c.connect();
  const db = c.db('metravision');
  const users = await db.collection('users').countDocuments();
  const insp = await db.collection('inspections').countDocuments();
  const idx = (await db.collection('inspections').indexes()).length;
  const one = await db.collection('inspections').findOne({}, { projection: { inspectionId: 1 } });
  console.log(`INDEPENDENT CHECK -> users:${users} inspections:${insp} inspectionIndexes:${idx} sample:${one?.inspectionId}`);
  await c.close();
} finally {
  if (server) await server.stop({ doCleanup: true, force: true });
  rmSync(dbPath, { recursive: true, force: true });
}
