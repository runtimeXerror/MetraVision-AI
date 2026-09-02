import { env } from '../config/env';
import { logger } from '../config/logger';
import type {
  AiAnalysisDTO,
  BBox,
  ExtractedFieldDTO,
  PackageOrigin,
  ProductCategory,
} from '../types/domain';
import { ApiError } from '../utils/ApiError';

import { resolveRuleSet } from './ruleSets';

/**
 * ── THE ANALYSIS ABSTRACTION ────────────────────────────────────────────────
 *
 * The one place that knows how a product analysis is produced. Controllers call
 * `analyseInspection()` and receive fields plus an engine record; they have no
 * idea whether it came from a scripted scenario or a GPU.
 *
 *   Phase 2 (now):  analyseInspection() → MockAnalysisProvider   [no inference]
 *   Phase 3:        analyseInspection() → HttpAnalysisProvider
 *                                            → Python/FastAPI AI service
 *                                                  → OCR / CV / VLM
 *
 * Switching is `ANALYSIS_PROVIDER=http` and nothing else. No controller, model
 * or mobile screen changes — which is the entire point of the indirection.
 * ────────────────────────────────────────────────────────────────────────────
 */

export interface AnalysisInput {
  inspectionId: string;
  images: Array<{ imageId: string; type: string; url: string }>;
  /** Optional hint from the inspector; the engine still classifies itself. */
  categoryHint?: ProductCategory;
}

export interface AnalysisOutput {
  fields: ExtractedFieldDTO[];
  analysis: Omit<AiAnalysisDTO, 'imageIds' | 'analysedAt'>;
}

export interface AnalysisProvider {
  readonly name: string;
  analyse(input: AnalysisInput): Promise<AnalysisOutput>;
}

/* ── Scripted scenarios ───────────────────────────────────────────────────── */

type ScenarioId = 'compliant' | 'violation' | 'low_confidence' | 'multi_image' | 'unpriced';

interface ScriptedField {
  name: string;
  value: string | null;
  confidence: number;
  bbox: BBox;
}

interface Scenario {
  id: ScenarioId;
  productName: string;
  category: ProductCategory;
  categoryConfidence: number;
  origin: PackageOrigin;
  fields: ScriptedField[];
  warnings: string[];
}

const COMPLIANT: Scenario = {
  id: 'compliant',
  productName: 'Aashirvaad Select Atta 5 kg',
  category: 'packaged_food',
  categoryConfidence: 0.97,
  origin: 'DOMESTIC',
  fields: [
    { name: 'manufacturer', value: 'ITC Limited, Foods Division, Bengaluru - 560001', confidence: 0.96, bbox: [64, 120, 640, 190] },
    { name: 'commodity_name', value: 'Whole Wheat Atta', confidence: 0.98, bbox: [64, 232, 440, 288] },
    { name: 'net_quantity', value: '5 kg', confidence: 0.99, bbox: [520, 232, 730, 288] },
    { name: 'manufacturing_date', value: '06/2026', confidence: 0.94, bbox: [64, 348, 350, 400] },
    { name: 'mrp', value: '₹315.00', confidence: 0.98, bbox: [470, 348, 740, 412] },
    { name: 'consumer_care', value: 'care@itc.in · 1800-425-4444', confidence: 0.92, bbox: [64, 480, 730, 544] },
    { name: 'best_before', value: '12/2026', confidence: 0.95, bbox: [64, 596, 350, 648] },
    { name: 'veg_nonveg_mark', value: 'Vegetarian', confidence: 0.99, bbox: [680, 120, 764, 172] },
    { name: 'fssai_licence', value: '10012021000123', confidence: 0.93, bbox: [64, 690, 460, 742] },
  ],
  warnings: [],
};

const VIOLATION: Scenario = {
  id: 'violation',
  productName: 'Crispy Bite Namkeen 200 g',
  category: 'packaged_food',
  categoryConfidence: 0.91,
  origin: 'DOMESTIC',
  fields: [
    { name: 'manufacturer', value: 'Shree Snacks Pvt Ltd, Indore', confidence: 0.88, bbox: [64, 136, 600, 200] },
    { name: 'commodity_name', value: 'Mixture Namkeen', confidence: 0.94, bbox: [64, 248, 420, 304] },
    { name: 'net_quantity', value: '200 g', confidence: 0.96, bbox: [510, 248, 730, 304] },
    { name: 'manufacturing_date', value: '03/2026', confidence: 0.9, bbox: [64, 364, 336, 416] },
    // Printed without the mandatory tax-inclusive wording.
    { name: 'mrp', value: '₹45', confidence: 0.93, bbox: [470, 364, 710, 428] },
    // Absent from the label entirely.
    { name: 'consumer_care', value: null, confidence: 0, bbox: [0, 0, 0, 0] },
    { name: 'best_before', value: '09/2026', confidence: 0.89, bbox: [64, 480, 336, 532] },
    { name: 'veg_nonveg_mark', value: 'Vegetarian', confidence: 0.97, bbox: [700, 136, 784, 188] },
    { name: 'fssai_licence', value: null, confidence: 0, bbox: [0, 0, 0, 0] },
  ],
  warnings: ['Net quantity declaration appears smaller than the minimum height for this package size.'],
};

const LOW_CONFIDENCE: Scenario = {
  id: 'low_confidence',
  productName: 'Herbal Glow Face Cream 50 g',
  category: 'cosmetic',
  categoryConfidence: 0.74,
  origin: 'DOMESTIC',
  fields: [
    { name: 'manufacturer', value: 'Herbal Glow Cosmetics, Haridwar', confidence: 0.81, bbox: [80, 152, 592, 216] },
    { name: 'commodity_name', value: 'Face Cream', confidence: 0.86, bbox: [80, 264, 416, 320] },
    // Smudged — the classic case that must reach a human.
    { name: 'net_quantity', value: '5O g', confidence: 0.52, bbox: [488, 264, 680, 320] },
    { name: 'manufacturing_date', value: '01/2026', confidence: 0.61, bbox: [80, 376, 320, 428] },
    { name: 'mrp', value: '₹l99.00', confidence: 0.48, bbox: [456, 376, 700, 440] },
    { name: 'consumer_care', value: 'support@herbalglow.in', confidence: 0.79, bbox: [80, 488, 664, 544] },
    { name: 'batch_number', value: 'HG-2026-0', confidence: 0.44, bbox: [80, 600, 368, 652] },
    { name: 'expiry_date', value: '01/2029', confidence: 0.72, bbox: [440, 600, 712, 652] },
  ],
  warnings: [
    'Overall text sharpness is low — several declarations were read with reduced confidence.',
    'Glare detected across the lower third of the label.',
  ],
};

const MULTI_IMAGE: Scenario = {
  id: 'multi_image',
  productName: 'SoundCore Wireless Earbuds',
  category: 'electronics',
  categoryConfidence: 0.93,
  origin: 'IMPORTED',
  fields: [
    { name: 'manufacturer', value: 'Anker Innovations Ltd. · Imported by Tech Retail India Pvt Ltd, Gurugram', confidence: 0.9, bbox: [48, 96, 720, 176] },
    { name: 'commodity_name', value: 'Wireless Earbuds', confidence: 0.95, bbox: [48, 224, 448, 280] },
    { name: 'net_quantity', value: '1 N', confidence: 0.91, bbox: [512, 224, 688, 280] },
    { name: 'manufacturing_date', value: '05/2026', confidence: 0.88, bbox: [48, 336, 320, 388] },
    { name: 'mrp', value: '₹2,499.00', confidence: 0.96, bbox: [440, 336, 720, 400] },
    { name: 'consumer_care', value: 'support.in@anker.com · 1800-000-1234', confidence: 0.87, bbox: [48, 448, 720, 512] },
    // Imported goods must declare this — it is absent.
    { name: 'country_of_origin', value: null, confidence: 0, bbox: [0, 0, 0, 0] },
  ],
  warnings: ['Declarations were combined from three package faces.'],
};

/**
 * An unpriced, unquantified package.
 *
 * The canonical Legal Metrology offence: goods offered for sale with no
 * declared retail price or net quantity, so a buyer cannot know what they are
 * paying or what they are getting. Graded CRITICAL by `severityFor`, which is
 * what makes it distinct from the other violation scenario.
 *
 * Deliberately **not** in `ROTATION`: the mobile app's documented walkthrough
 * is three rotating cases plus the multi-image one, and quietly adding a fifth
 * would change a demo script that is already written down. It is reachable only
 * when a caller forces it, which is what the seed does.
 */
const UNPRICED: Scenario = {
  id: 'unpriced',
  productName: 'Loose Pack Chilli Powder 500 g',
  category: 'packaged_food',
  categoryConfidence: 0.89,
  origin: 'DOMESTIC',
  fields: [
    { name: 'manufacturer', value: 'Annapurna Masala Udyog, Nashik', confidence: 0.85, bbox: [64, 128, 604, 192] },
    { name: 'commodity_name', value: 'Red Chilli Powder', confidence: 0.93, bbox: [64, 240, 432, 296] },
    // No declared quantity anywhere on the package.
    { name: 'net_quantity', value: null, confidence: 0, bbox: [0, 0, 0, 0] },
    { name: 'manufacturing_date', value: '07/2026', confidence: 0.87, bbox: [64, 356, 340, 408] },
    // Nor a retail price.
    { name: 'mrp', value: null, confidence: 0, bbox: [0, 0, 0, 0] },
    { name: 'consumer_care', value: 'annapurnamasala@gmail.com', confidence: 0.83, bbox: [64, 472, 660, 528] },
    { name: 'best_before', value: '07/2027', confidence: 0.86, bbox: [64, 588, 340, 640] },
    { name: 'veg_nonveg_mark', value: 'Vegetarian', confidence: 0.96, bbox: [688, 128, 772, 180] },
    { name: 'fssai_licence', value: '11223344556677', confidence: 0.81, bbox: [64, 700, 468, 752] },
  ],
  warnings: ['Neither a retail sale price nor a net quantity declaration was located on any face.'],
};

/** The coordinate frame the scripted bounding boxes are drawn in. */
export const MOCK_BBOX_SPACE = { width: 800, height: 1000 } as const;

const ROTATION: Scenario[] = [COMPLIANT, VIOLATION, LOW_CONFIDENCE];
const ALL_SCENARIOS: Scenario[] = [...ROTATION, MULTI_IMAGE, UNPRICED];

/**
 * Rotating cursor so successive demo analyses show different outcomes rather
 * than the same verdict every time. Three or more images always route to the
 * multi-image case, which is the one that reads several package faces.
 */
let cursor = 0;

function pickScenario(imageCount: number, forced?: ScenarioId): Scenario {
  if (forced) return ALL_SCENARIOS.find((s) => s.id === forced) ?? COMPLIANT;
  if (imageCount >= 3) return MULTI_IMAGE;

  const scenario = ROTATION[cursor % ROTATION.length] ?? COMPLIANT;
  cursor += 1;
  return scenario;
}

/** Resets the rotation — used by the seed script and by tests. */
export function resetScenarioRotation(): void {
  cursor = 0;
}

export function scenarioIds(): ScenarioId[] {
  return ALL_SCENARIOS.map((scenario) => scenario.id);
}

/* ── Mock provider ────────────────────────────────────────────────────────── */

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Scripted analysis.
 *
 * IMPORTANT: performs no OCR, computer vision or inference of any kind. It
 * produces a realistic, internally consistent result from fixed scenarios so
 * the full inspection workflow — including the low-confidence review path —
 * can be demonstrated and tested before the AI service exists.
 */
export class MockAnalysisProvider implements AnalysisProvider {
  readonly name = 'mock';

  constructor(private readonly forced?: ScenarioId) {}

  async analyse(input: AnalysisInput): Promise<AnalysisOutput> {
    const startedAt = Date.now();

    // Deliberate latency so the mobile "Analysing" state is visible in a demo.
    if (env.MOCK_ANALYSIS_DELAY_MS > 0) await delay(env.MOCK_ANALYSIS_DELAY_MS);

    const scenario = pickScenario(input.images.length, this.forced);
    const ruleSet = resolveRuleSet(input.categoryHint ?? scenario.category);
    const scripted = new Map(scenario.fields.map((field) => [field.name, field]));

    // Attribute each field to an image, cycling so a multi-image capture shows
    // declarations sourced from different faces of the package.
    const imageIdAt = (index: number): string | undefined =>
      input.images.length > 0 ? input.images[index % input.images.length]?.imageId : undefined;

    const fields: ExtractedFieldDTO[] = ruleSet.fields.map((requirement, index) => {
      const match = scripted.get(requirement.name);
      const found = match != null && match.value !== null;

      return {
        name: requirement.name,
        label: requirement.label,
        aiValue: match?.value ?? null,
        confidence: match?.confidence ?? 0,
        bbox: found ? match.bbox : undefined,
        sourceImageId: found ? imageIdAt(index) : undefined,
        required: requirement.required,
        humanVerifiedValue: undefined,
      };
    });

    // Keep any scripted field the rule set does not list, so evidence is never
    // silently dropped (e.g. country of origin on a domestic rule set).
    for (const field of scenario.fields) {
      if (fields.some((existing) => existing.name === field.name)) continue;
      fields.push({
        name: field.name,
        label: humanize(field.name),
        aiValue: field.value,
        confidence: field.confidence,
        bbox: field.value !== null ? field.bbox : undefined,
        sourceImageId: field.value !== null ? imageIdAt(fields.length) : undefined,
        required: true,
      });
    }

    const read = fields.filter((field) => field.aiValue !== null);
    const meanConfidence =
      read.length > 0 ? read.reduce((sum, field) => sum + field.confidence, 0) / read.length : 0;

    return {
      fields,
      analysis: {
        engine: 'MOCK',
        engineVersion: 'mock-2.0.0',
        category: { value: scenario.category, confidence: scenario.categoryConfidence },
        origin: scenario.origin,
        meanConfidence,
        processingMs: Date.now() - startedAt,
        warnings: scenario.warnings,
        // The frame the scripted boxes above were laid out in.
        bboxSpace: MOCK_BBOX_SPACE,
      },
    };
  }
}

/* ── HTTP provider (Phase 3) ──────────────────────────────────────────────── */

/**
 * Calls the Python AI service.
 *
 * Written and wired now so Phase 3 is a configuration change rather than new
 * plumbing. It is unreachable while `ANALYSIS_PROVIDER=mock`.
 */
export class HttpAnalysisProvider implements AnalysisProvider {
  readonly name = 'http';

  async analyse(input: AnalysisInput): Promise<AnalysisOutput> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), env.AI_SERVICE_TIMEOUT_MS);

    try {
      const response = await fetch(`${env.AI_SERVICE_URL}/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw ApiError.serviceUnavailable(
          `The analysis service returned ${response.status}.`,
          'ANALYSIS_FAILED',
        );
      }

      return (await response.json()) as AnalysisOutput;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      logger.error({ err: error }, 'AI service call failed');
      throw ApiError.serviceUnavailable(
        'The analysis service is unavailable. Try again shortly.',
        'ANALYSIS_FAILED',
      );
    } finally {
      clearTimeout(timeout);
    }
  }
}

function humanize(name: string): string {
  return name
    .split('_')
    .map((part) => (part ? part[0]!.toUpperCase() + part.slice(1) : part))
    .join(' ');
}

/* ── Resolution ───────────────────────────────────────────────────────────── */

function createProvider(): AnalysisProvider {
  return env.ANALYSIS_PROVIDER === 'http' ? new HttpAnalysisProvider() : new MockAnalysisProvider();
}

export const analysisProvider: AnalysisProvider = createProvider();

/** The function controllers call. Provider choice is invisible to them. */
export async function analyseInspection(input: AnalysisInput): Promise<AnalysisOutput> {
  if (input.images.length === 0) {
    throw ApiError.badRequest(
      'Upload at least one product image before running the analysis.',
      'NO_IMAGES',
    );
  }

  return analysisProvider.analyse(input);
}

/** Lets the seed script produce a specific scenario deterministically. */
export function mockProviderFor(scenario: ScenarioId): AnalysisProvider {
  return new MockAnalysisProvider(scenario);
}

export type { ScenarioId };
