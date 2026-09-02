import type { ComplianceEvaluationRequest, ExtractedField, ProductContext } from '../../types/Evidence';

/**
 * ── SYNTHETIC FIXTURES ──────────────────────────────────────────────────────
 *
 * These are **not** examples of compliant or non-compliant labelling, and they
 * must not be read as legal guidance. They exist to exercise engine mechanics —
 * date selection, version selection, exception selection, confidence handling —
 * and the values in them are chosen to make a particular code path fire, not
 * because a real package looks like this.
 *
 * Where a fixture does mirror a real legal situation (the pan masala carve-out,
 * the 2026/2027 country-of-origin pair) it is because those are the situations
 * the engine most needs to get right, and the dates and provisions are taken
 * from the verified corpus rather than invented.
 * ────────────────────────────────────────────────────────────────────────────
 */

/** A well-declared package: everything present, everything read confidently. */
export function compliantFields(): Record<string, ExtractedField> {
  return {
    manufacturer: {
      value: 'Nutrivale Foods Pvt Ltd, Plot 44, MIDC Bhosari, Pune, Maharashtra 411026',
      confidence: 0.96,
      status: 'FOUND',
      evidence: [{ imageId: 'img-back-001', bbox: [40, 120, 520, 190], space: { width: 1024, height: 768 } }],
    },
    commodity_name: { value: 'Roasted Almonds', confidence: 0.97, status: 'FOUND' },
    net_quantity: { value: '500 g', unit: 'g', confidence: 0.95, status: 'FOUND' },
    manufacturing_date: { value: '03/2026', confidence: 0.93, status: 'FOUND' },
    mrp: { value: 'MRP Rs. 499.00 (incl. of all taxes)', confidence: 0.96, status: 'FOUND' },
    consumer_care: { value: 'Consumer Care: care@nutrivale.example, 1800-000-000', confidence: 0.94, status: 'FOUND' },
    unit_sale_price: { value: 'Rs. 99.80 per 100 g', confidence: 0.9, status: 'FOUND' },
    best_before: { value: '09/2026', confidence: 0.92, status: 'FOUND' },
  };
}

/** A package photographed thoroughly, in good light. Absences here mean something. */
export const STRONG_EVIDENCE: ComplianceEvaluationRequest['evidence'] = {
  imageIds: ['img-front-001', 'img-back-001', 'img-side-001'],
  captureCompleteness: 0.95,
  imageQuality: 0.91,
  facesCaptured: ['FRONT', 'BACK', 'SIDE'],
  extractionEngine: 'fixture',
  extractionEngineVersion: '0.0.0-test',
};

/** One blurred photograph of the front. Absences here mean nothing. */
export const WEAK_EVIDENCE: ComplianceEvaluationRequest['evidence'] = {
  imageIds: ['img-front-001'],
  captureCompleteness: 0.35,
  imageQuality: 0.4,
  facesCaptured: ['FRONT'],
  extractionEngine: 'fixture',
  extractionEngineVersion: '0.0.0-test',
};

export const PACKAGED_FOOD: ProductContext = {
  category: 'packaged_food',
  packageType: 'RETAIL',
  isImported: false,
  isEcommerce: false,
  quantity: 500,
  quantityUnit: 'g',
};

export function request(overrides: Partial<ComplianceEvaluationRequest> = {}): ComplianceEvaluationRequest {
  return {
    inspectionId: 'INS-TEST-0001',
    inspectionDate: '2026-09-01',
    productContext: PACKAGED_FOOD,
    fields: compliantFields(),
    evidence: STRONG_EVIDENCE,
    ...overrides,
  };
}

/** A 5 g sachet — the shape the rule 26(a) exemption turns on. */
export function smallSachet(overrides: Partial<ProductContext> = {}): ProductContext {
  return {
    category: 'other',
    packageType: 'RETAIL',
    quantity: 5,
    quantityUnit: 'g',
    ...overrides,
  };
}

/** An imported product sold through an e-commerce marketplace. */
export function importedEcommerce(overrides: Partial<ProductContext> = {}): ProductContext {
  return {
    category: 'household',
    packageType: 'RETAIL',
    isImported: true,
    countryOfOrigin: 'Vietnam',
    isEcommerce: true,
    ecommerceModel: 'INVENTORY',
    quantity: 250,
    quantityUnit: 'ml',
    ...overrides,
  };
}

/** A packaged medical device — the 2025 cross-regulation case. */
export function medicalDevice(overrides: Partial<ProductContext> = {}): ProductContext {
  return {
    category: 'medical_device',
    packageType: 'RETAIL',
    isMedicalDevice: true,
    quantity: 1,
    quantityUnit: 'N',
    ...overrides,
  };
}
