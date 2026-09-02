import mongoose from 'mongoose';
import { afterAll, afterEach, beforeAll, inject } from 'vitest';

/**
 * Test harness.
 *
 * Each suite runs against the shared in-memory MongoDB started once in
 * `globalSetup.ts`, and every collection is cleared between tests — so a test
 * can never pass because of state another test happened to leave behind.
 *
 * The server is deliberately not started here. Doing that per file is what left
 * a data directory behind for each suite; see `globalSetup.ts`.
 */

beforeAll(async () => {
  await mongoose.connect(inject('mongoUri'), { dbName: 'sih26034-test' });
}, 120_000);

afterEach(async () => {
  const { collections } = mongoose.connection;
  await Promise.all(Object.values(collections).map((collection) => collection.deleteMany({})));
});

afterAll(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.connection.close();
});
