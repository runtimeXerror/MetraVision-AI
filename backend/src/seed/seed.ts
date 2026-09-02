import { createHash } from 'node:crypto';

import mongoose from 'mongoose';

import { logger } from '../config/logger';
import { Counter } from '../models/Counter';
import { Inspection } from '../models/Inspection';
import { RefreshToken } from '../models/RefreshToken';
import { User, type UserDocument } from '../models/User';
import { mockProviderFor, resetScenarioRotation, type ScenarioId } from '../services/analysisService';
import { evaluateCompliance } from '../services/complianceService';
import type { InspectionStatus, ProductCategory, UserRole } from '../types/domain';
import { generateId, nextInspectionReference } from '../utils/referenceId';

import { invalidateCorpusCache } from '../compliance/ruleEngineService';
import { seedLegalCorpus } from '../compliance/seed';

import { clearSeedLabels, writeSeedLabel } from './seedImages';
import { seedRules } from './seedRules';

/**
 * Demo data.
 *
 * Runs automatically on boot when the database is empty (`AUTO_SEED`), which is
 * what makes the in-memory fallback usable — a separate seed process would own
 * a different ephemeral database than the server.
 */

/* ── Users ────────────────────────────────────────────────────────────────── */

interface SeedUser {
  inspectorId: string;
  name: string;
  email: string;
  role: UserRole;
  password: string;
  zone?: string;
  district?: string;
  state?: string;
  phone?: string;
  avatarColor: string;
}

/**
 * A stable ObjectId for a seeded document.
 *
 * The demo runs on an ephemeral in-process MongoDB, which is re-seeded from
 * scratch every time the server restarts. With Mongo minting the ids, each
 * restart gave the same demo accounts brand-new ones — so an access token from
 * before the restart still verified (the signing secret is fixed in `.env`) but
 * named a user that no longer existed. Every open tab got
 * `ACCOUNT_NOT_FOUND` on its next request and was thrown back to the sign-in
 * screen, which reads as "the backend is broken" rather than "the database was
 * replaced underneath you".
 *
 * Deriving the id from a stable key instead makes a restart reproduce the same
 * accounts, so a session survives one. Hash-derived rather than hand-written so
 * adding an account cannot silently collide with an existing id.
 */
function stableObjectId(key: string): mongoose.Types.ObjectId {
  return new mongoose.Types.ObjectId(createHash('sha1').update(key).digest('hex').slice(0, 24));
}

export const SEED_USERS: SeedUser[] = [
  {
    inspectorId: 'LM-INS-4471',
    name: 'Ravi Sharma',
    email: 'ravi.sharma@legalmetrology.gov.in',
    role: 'INSPECTOR',
    password: 'Inspector@123',
    zone: 'Zone III',
    district: 'Pune',
    state: 'Maharashtra',
    phone: '+91 98200 41122',
    avatarColor: '#1D6FE0',
  },
  {
    inspectorId: 'LM-INS-3308',
    name: 'Ananya Iyer',
    email: 'ananya.iyer@legalmetrology.gov.in',
    role: 'INSPECTOR',
    password: 'Inspector@123',
    zone: 'Zone I',
    district: 'Bengaluru Urban',
    state: 'Karnataka',
    phone: '+91 98450 77310',
    avatarColor: '#0F7A4D',
  },
  {
    inspectorId: 'LM-INS-5192',
    name: 'Imran Qureshi',
    email: 'imran.qureshi@legalmetrology.gov.in',
    role: 'INSPECTOR',
    password: 'Inspector@123',
    zone: 'Zone II',
    district: 'Nagpur',
    state: 'Maharashtra',
    phone: '+91 99700 21845',
    avatarColor: '#B26B00',
  },
  {
    inspectorId: 'LM-SUP-1204',
    name: 'Meera Nair',
    email: 'meera.nair@legalmetrology.gov.in',
    role: 'SUPERVISOR',
    password: 'Supervisor@123',
    zone: 'West Region',
    district: 'Pune',
    state: 'Maharashtra',
    avatarColor: '#0B63A5',
  },
  {
    inspectorId: 'LM-ADM-0001',
    name: 'System Administrator',
    email: 'admin@legalmetrology.gov.in',
    role: 'ADMIN',
    password: 'Admin@1234',
    state: 'Maharashtra',
    avatarColor: '#C0281F',
  },
];

/* ── Inspections ──────────────────────────────────────────────────────────── */

interface SeedInspection {
  scenario: ScenarioId;
  business: string;
  address: string;
  district: string;
  state: string;
  category: ProductCategory;
  imageCount: number;
  daysAgo: number;
  inspectorIndex: 0 | 1 | 2;
  /** Records left mid-workflow rather than filed. */
  leaveOpen?: boolean;
  notes?: string;
}

const SEED_INSPECTIONS: SeedInspection[] = [
  { scenario: 'compliant', business: 'Sai Provision Stores', address: 'Market Yard, Pune', district: 'Pune', state: 'Maharashtra', category: 'packaged_food', imageCount: 2, daysAgo: 0, inspectorIndex: 0, notes: 'Routine market surveillance. Stock rotation adequate.' },
  { scenario: 'violation', business: 'ABC Foods', address: 'MG Road, Pune', district: 'Pune', state: 'Maharashtra', category: 'packaged_food', imageCount: 2, daysAgo: 0, inspectorIndex: 0, leaveOpen: true, notes: 'Consumer complaint follow-up. Sample retained. Notice pending issue.' },
  { scenario: 'low_confidence', business: 'Glow Cosmetics Retail', address: 'FC Road, Pune', district: 'Pune', state: 'Maharashtra', category: 'cosmetic', imageCount: 1, daysAgo: 1, inspectorIndex: 0, leaveOpen: true, notes: 'Label heavily worn. Second capture attempted under shade.' },
  { scenario: 'multi_image', business: 'TechMart Electronics', address: 'Aundh, Pune', district: 'Pune', state: 'Maharashtra', category: 'electronics', imageCount: 3, daysAgo: 2, inspectorIndex: 0, leaveOpen: true, notes: 'Imported consignment. Country of origin not visible on any face. Importer contacted.' },
  { scenario: 'compliant', business: 'Deccan Supermarket', address: 'Deccan Gymkhana, Pune', district: 'Pune', state: 'Maharashtra', category: 'packaged_food', imageCount: 2, daysAgo: 3, inspectorIndex: 0 },
  { scenario: 'unpriced', business: 'Krishna Kirana Bhandar', address: 'Hadapsar, Pune', district: 'Pune', state: 'Maharashtra', category: 'packaged_food', imageCount: 1, daysAgo: 4, inspectorIndex: 0, leaveOpen: true, notes: 'Repeat premises. Loose repacks offered without price or quantity. Previous notice issued in June 2026.' },
  { scenario: 'compliant', business: 'Green Valley Organics', address: 'Baner, Pune', district: 'Pune', state: 'Maharashtra', category: 'packaged_food', imageCount: 2, daysAgo: 5, inspectorIndex: 0 },
  { scenario: 'low_confidence', business: 'Shree Beauty Mart', address: 'Kothrud, Pune', district: 'Pune', state: 'Maharashtra', category: 'cosmetic', imageCount: 2, daysAgo: 6, inspectorIndex: 0, leaveOpen: true },
  { scenario: 'compliant', business: 'MG Beverages Depot', address: 'Camp, Pune', district: 'Pune', state: 'Maharashtra', category: 'beverage', imageCount: 2, daysAgo: 7, inspectorIndex: 0 },
  { scenario: 'multi_image', business: 'Digital Bazaar', address: 'JM Road, Pune', district: 'Pune', state: 'Maharashtra', category: 'electronics', imageCount: 4, daysAgo: 8, inspectorIndex: 0 },

  { scenario: 'compliant', business: 'Nandini Fresh Foods', address: 'Jayanagar, Bengaluru', district: 'Bengaluru Urban', state: 'Karnataka', category: 'packaged_food', imageCount: 2, daysAgo: 1, inspectorIndex: 1 },
  { scenario: 'violation', business: 'Metro Cash Corner', address: 'Indiranagar, Bengaluru', district: 'Bengaluru Urban', state: 'Karnataka', category: 'packaged_food', imageCount: 2, daysAgo: 2, inspectorIndex: 1, leaveOpen: true, notes: 'Two SKUs found without consumer care details. Awaiting supervisor sign-off.' },
  { scenario: 'low_confidence', business: 'Herbal Essence Store', address: 'Koramangala, Bengaluru', district: 'Bengaluru Urban', state: 'Karnataka', category: 'cosmetic', imageCount: 1, daysAgo: 4, inspectorIndex: 1, leaveOpen: true },
  { scenario: 'compliant', business: 'Cauvery Household Goods', address: 'Malleshwaram, Bengaluru', district: 'Bengaluru Urban', state: 'Karnataka', category: 'household', imageCount: 2, daysAgo: 6, inspectorIndex: 1 },
  { scenario: 'multi_image', business: 'Gadget Hub', address: 'Whitefield, Bengaluru', district: 'Bengaluru Urban', state: 'Karnataka', category: 'electronics', imageCount: 3, daysAgo: 9, inspectorIndex: 1 },
  { scenario: 'unpriced', business: 'Sunrise Traders', address: 'Rajajinagar, Bengaluru', district: 'Bengaluru Urban', state: 'Karnataka', category: 'packaged_food', imageCount: 1, daysAgo: 11, inspectorIndex: 1, notes: 'Repacked spices sold without declarations.' },
  { scenario: 'compliant', business: 'Lakshmi Stores', address: 'Basavanagudi, Bengaluru', district: 'Bengaluru Urban', state: 'Karnataka', category: 'packaged_food', imageCount: 2, daysAgo: 13, inspectorIndex: 1 },

  { scenario: 'compliant', business: 'Orange City Mart', address: 'Sitabuldi, Nagpur', district: 'Nagpur', state: 'Maharashtra', category: 'packaged_food', imageCount: 2, daysAgo: 2, inspectorIndex: 2 },
  { scenario: 'unpriced', business: 'Vidarbha Provisions', address: 'Dharampeth, Nagpur', district: 'Nagpur', state: 'Maharashtra', category: 'packaged_food', imageCount: 2, daysAgo: 5, inspectorIndex: 2, notes: 'MRP sticker removed; no price legible on the pack. Photographed as evidence.' },
  { scenario: 'low_confidence', business: 'Nagpur Cosmetics House', address: 'Sadar, Nagpur', district: 'Nagpur', state: 'Maharashtra', category: 'cosmetic', imageCount: 1, daysAgo: 8, inspectorIndex: 2, leaveOpen: true },
  { scenario: 'multi_image', business: 'ElectroWorld', address: 'Wardha Road, Nagpur', district: 'Nagpur', state: 'Maharashtra', category: 'electronics', imageCount: 3, daysAgo: 12, inspectorIndex: 2 },
  { scenario: 'compliant', business: 'Apparel Junction', address: 'Itwari, Nagpur', district: 'Nagpur', state: 'Maharashtra', category: 'apparel', imageCount: 2, daysAgo: 15, inspectorIndex: 2 },
];

const PRODUCT_NAMES: Record<ScenarioId, string> = {
  compliant: 'Aashirvaad Select Atta 5 kg',
  violation: 'Crispy Bite Namkeen 200 g',
  low_confidence: 'Herbal Glow Face Cream 50 g',
  multi_image: 'SoundCore Wireless Earbuds',
  unpriced: 'Loose Pack Chilli Powder 500 g',
};

function dateDaysAgo(days: number, hourSeed: number): Date {
  const date = new Date();
  date.setDate(date.getDate() - days);
  date.setHours(9 + (hourSeed % 8), (hourSeed * 17) % 60, 0, 0);
  return date;
}

export interface SeedResult {
  seeded: boolean;
  users: number;
  inspections: number;
  rules: number;
  /** Phase 4A — the versioned legal corpus behind the rule engine. */
  legalCorpus: { amendments: number; ruleVersions: number; exceptions: number; sourceConflicts: number };
}

/**
 * Projects the legal corpus into MongoDB and drops the engine's cache.
 *
 * Runs on every seed path, including the `onlyIfEmpty` short-circuit: the
 * corpus arrived after the first deployments, so a database seeded before it
 * has none of it, and the engine would silently fall back to the built-in copy
 * while the dashboard showed an empty rulebook.
 */
async function seedCorpus(reset: boolean): Promise<SeedResult['legalCorpus']> {
  const result = await seedLegalCorpus({ reset });
  invalidateCorpusCache();
  return result;
}

/**
 * Populates the database.
 *
 * @param onlyIfEmpty  Skip when any user already exists. Guards the auto-seed
 *                     on boot so a populated database is never overwritten.
 * @param reset        Drop existing data first. Used by `npm run seed`.
 */
export async function seedDatabase(
  options: { onlyIfEmpty?: boolean; reset?: boolean } = {},
): Promise<SeedResult> {
  const { onlyIfEmpty = false, reset = false } = options;

  if (onlyIfEmpty) {
    // `countDocuments`, not `estimatedDocumentCount`. The estimate is read
    // from collection metadata, and WiredTiger leaves that metadata stale after
    // an unclean shutdown — every collection reports zero while still holding
    // its documents. The seeder then concluded the database was empty, re-ran
    // the full seed, and hit a duplicate `_id` on the first user, because the
    // seeded ids are hash-derived and therefore identical every run. That
    // crashed the boot; `tsx watch` restarted it; it crashed again. A real
    // count costs one query on a tiny collection, once, at startup.
    const existing = await User.countDocuments();
    if (existing > 0) {
      // The rule repository landed after the first deployments, so a database
      // seeded before it exists still needs its rules.
      const rules = await seedRules();
      const legalCorpus = await seedCorpus(false);
      return { seeded: false, users: 0, inspections: 0, rules, legalCorpus };
    }
  }

  if (reset) {
    await clearSeedLabels();
    await Promise.all([
      User.deleteMany({}),
      Inspection.deleteMany({}),
      Counter.deleteMany({}),
      RefreshToken.deleteMany({}),
    ]);
  }

  // Seeded scenarios are forced, so the rotation stays at its starting point
  // for the first live analysis a demo runs.
  resetScenarioRotation();

  const users: UserDocument[] = [];
  for (const seed of SEED_USERS) {
    const user = await User.create({
      _id: stableObjectId(`user:${seed.inspectorId}`),
      inspectorId: seed.inspectorId,
      name: seed.name,
      email: seed.email,
      passwordHash: await User.hashPassword(seed.password),
      role: seed.role,
      status: 'ACTIVE',
      department: 'Department of Legal Metrology',
      phone: seed.phone,
      zone: seed.zone,
      district: seed.district,
      state: seed.state,
      avatarColor: seed.avatarColor,
      tokenVersion: 0,
    });
    users.push(user);
  }

  const inspectors = users.filter((user) => user.role === 'INSPECTOR');

  // Oldest first, so reference numbers ascend with time the way a real counter
  // would have produced them.
  const ordered = [...SEED_INSPECTIONS].sort((a, b) => b.daysAgo - a.daysAgo);

  let inspectionCount = 0;

  for (const [index, seed] of ordered.entries()) {
    const inspector = inspectors[seed.inspectorIndex] ?? inspectors[0];
    if (!inspector) break;

    const createdAt = dateDaysAgo(seed.daysAgo, index);

    const faces = Array.from(
      { length: seed.imageCount },
      (_, imageIndex) =>
        (['FRONT', 'BACK', 'SIDE', 'ADDITIONAL'] as const)[imageIndex] ?? 'ADDITIONAL',
    );

    const imageIds = faces.map(() => generateId('img'));

    // Analyse first: the rendered label is drawn *from* the analyser's own
    // output, so the boxes it reports land on text that is actually there.
    const provider = mockProviderFor(seed.scenario);
    const result = await provider.analyse({
      inspectionId: 'seed',
      images: faces.map((face, faceIndex) => ({
        imageId: imageIds[faceIndex] as string,
        type: face,
        url: '',
      })),
      categoryHint: seed.category,
    });

    const images = await Promise.all(
      faces.map(async (face, faceIndex) => {
        const imageId = imageIds[faceIndex] as string;

        const stored = await writeSeedLabel({
          imageId,
          face,
          productName: PRODUCT_NAMES[seed.scenario],
          category: seed.category,
          fields: result.fields.map((field) => ({
            name: field.name,
            label: field.label,
            value: field.aiValue,
            bbox: field.bbox ?? [0, 0, 0, 0],
          })),
        });

        return {
          imageId,
          type: face,
          storageKey: stored.key,
          url: stored.url,
          mimeType: 'image/svg+xml',
          sizeBytes: stored.sizeBytes,
          width: 800,
          height: 1000,
          createdAt,
        };
      }),
    );

    const compliance = evaluateCompliance({ fields: result.fields, category: seed.category });

    const status: InspectionStatus = seed.leaveOpen ? compliance.status : 'FINALIZED';

    await Inspection.create({
      inspectionId: await nextInspectionReference(createdAt),
      inspector: inspector._id,
      business: { name: seed.business },
      location: { address: seed.address, district: seed.district, state: seed.state },
      productCategory: seed.category,
      productName: PRODUCT_NAMES[seed.scenario],
      images,
      extractedFields: result.fields.map((field) => ({
        name: field.name,
        label: field.label,
        aiValue: field.aiValue,
        confidence: field.confidence,
        bbox: field.bbox ? [...field.bbox] : undefined,
        sourceImageId: field.sourceImageId,
        required: field.required,
      })),
      aiAnalysis: {
        engine: result.analysis.engine,
        engineVersion: result.analysis.engineVersion,
        categoryValue: result.analysis.category.value,
        categoryConfidence: result.analysis.category.confidence,
        origin: result.analysis.origin,
        meanConfidence: result.analysis.meanConfidence,
        processingMs: result.analysis.processingMs,
        imageIds: images.map((image) => image.imageId),
        analysedAt: createdAt,
        warnings: result.analysis.warnings,
        bboxSpaceWidth: result.analysis.bboxSpace.width,
        bboxSpaceHeight: result.analysis.bboxSpace.height,
      },
      complianceResult: { ...compliance, evaluatedAt: createdAt },
      notes: seed.notes,
      finalNotes: seed.leaveOpen ? undefined : seed.notes,
      status,
      finalizedAt: seed.leaveOpen ? undefined : createdAt,
      createdAt,
      updatedAt: createdAt,
    });

    inspectionCount += 1;
  }

  resetScenarioRotation();

  const rules = await seedRules({ reset });
  const legalCorpus = await seedCorpus(reset);

  return { seeded: true, users: users.length, inspections: inspectionCount, rules, legalCorpus };
}

/** CLI entry: `npm run seed`. Always resets. */
async function main(): Promise<void> {
  const { connectDatabase, disconnectDatabase, isEphemeralDatabase } = await import('../config/db');

  await connectDatabase();

  if (isEphemeralDatabase()) {
    logger.error('No MONGODB_URI is set, so this would seed a throwaway in-memory database.');
    logger.error('Set MONGODB_URI, or just run `npm run dev` — it seeds itself on boot.');
    await disconnectDatabase();
    process.exit(1);
  }

  const result = await seedDatabase({ reset: true });
  logger.info(`Seeded ${result.users} users and ${result.inspections} inspections.`);
  logger.info(
    `Legal corpus: ${result.legalCorpus.amendments} amendments, ${result.legalCorpus.ruleVersions} rule versions, ` +
      `${result.legalCorpus.exceptions} exceptions, ${result.legalCorpus.sourceConflicts} recorded source conflicts.`,
  );
  logger.info('Demo login — LM-INS-4471 / Inspector@123');

  await disconnectDatabase();
  process.exit(0);
}

if (require.main === module) {
  main().catch((error) => {
    logger.fatal({ err: error }, 'Seeding failed');
    process.exit(1);
  });
}
