/**
 * ── THE AI-INDEPENDENT INPUT CONTRACT ───────────────────────────────────────
 *
 * Everything the rule engine will ever accept, expressed without a single
 * reference to OCR, computer vision, or a model.
 *
 * This is the seam. A future extraction service — whatever it turns out to be —
 * produces one of these; the engine consumes it and knows nothing about how the
 * values were obtained. That is what keeps legal reasoning out of the model and
 * image processing out of the rulebook, and it is why the engine is testable
 * today, with hand-written JSON, against a service that does not exist yet.
 *
 * Two things in here are for the phase after next and are deliberately present
 * now: `measurements` on an evidence reference (font heights, panel areas) and
 * `absenceConfidence` on a field. Fixing their shape before anything implements
 * them means the CV service is written against a contract rather than the
 * contract being retro-fitted around whatever the CV service happened to emit.
 * ────────────────────────────────────────────────────────────────────────────
 */

/** `[x1, y1, x2, y2]`, in the coordinate space named by `EvidenceReference.space`. */
export type EvidenceBBox = [number, number, number, number];

/**
 * Measurements a future computer-vision stage may attach to a piece of
 * evidence. Every one is optional: the engine treats an absent measurement as
 * "not measured", never as "measured and found wanting".
 */
export interface EvidenceMeasurements {
  /** Character height in millimetres, for the Rule 7 Table-I checks. */
  heightMm?: number;
  /** Character width in millimetres, for the Rule 7(3) one-third check. */
  widthMm?: number;
  /** Area of the principal display panel in square centimetres. */
  principalDisplayPanelAreaCm2?: number;
  /** Which face the declaration was found on. */
  panel?: 'PRINCIPAL_DISPLAY_PANEL' | 'BACK' | 'SIDE' | 'OTHER';
  /** 0–1 legibility score from an image-quality stage. */
  legibility?: number;
}

export interface EvidenceReference {
  imageId: string;
  bbox?: EvidenceBBox;
  /** The frame `bbox` is expressed in. Required whenever `bbox` is present. */
  space?: { width: number; height: number };
  /** Verbatim text the extraction stage read at this location. */
  text?: string;
  confidence?: number;
  measurements?: EvidenceMeasurements;
}

export const FIELD_EXTRACTION_STATUSES = [
  /** A value was read. */
  'FOUND',
  /** Looked for and not found. `absenceConfidence` says how sure. */
  'NOT_FOUND',
  /** Located but could not be read — a value may well be there. */
  'UNREADABLE',
  /** Confirmed by a person. Outranks any model confidence. */
  'HUMAN_VERIFIED',
  /** A person recorded that the declaration is genuinely absent. */
  'HUMAN_MARKED_ABSENT',
] as const;
export type FieldExtractionStatus = (typeof FIELD_EXTRACTION_STATUSES)[number];

export interface ExtractedField {
  /** What was read. `null` for every status other than FOUND/HUMAN_VERIFIED. */
  value: string | number | null;
  /** 0–1. The reader's confidence in `value`, where it reported one. Informational. */
  confidence?: number;
  status?: FieldExtractionStatus;
  /**
   * 0–1 confidence that the declaration is genuinely *not on the package*.
   * Recorded for the audit trail; the decision no longer turns on it.
   */
  absenceConfidence?: number;
  /** Unit, where the extraction stage separated it from the number. */
  unit?: string;
  evidence?: EvidenceReference[];
}

/**
 * What the package *is*, as far as the rules care.
 *
 * Every flag here corresponds to a condition that some provision actually turns
 * on. Nothing is here speculatively; adding a field means a rule needed it.
 */
export interface ProductContext {
  /** Free-form category key, e.g. `packaged_food`. */
  category?: string;
  /** The commodity as named on the package, for Second/Fourth Schedule work. */
  commodityType?: string;
  packageType?: 'RETAIL' | 'WHOLESALE' | 'MULTI_PIECE' | 'COMBINATION' | 'GROUP' | 'INSTITUTIONAL';

  isImported?: boolean;
  countryOfOrigin?: string;
  isMedicalDevice?: boolean;
  isElectronicProduct?: boolean;
  isFoodArticle?: boolean;
  isPanMasala?: boolean;
  isTobaccoProduct?: boolean;
  isGarmentOrHosiery?: boolean;
  isAlcoholicBeverage?: boolean;
  isGeneticallyModifiedFood?: boolean;
  isCosmeticOrToiletry?: boolean;
  isAgriculturalFarmProduce?: boolean;
  isFastFoodByRestaurant?: boolean;
  isDrugFormulation?: boolean;

  isEcommerce?: boolean;
  ecommerceModel?: 'MARKETPLACE' | 'INVENTORY' | 'NONE';
  isPromotionalGroup?: boolean;
  isIndustrialConsumer?: boolean;
  isInstitutionalConsumer?: boolean;
  /** Sold loose or open at the point of sale, where the consumer can inspect it. */
  isSoldLoose?: boolean;

  /** Net quantity as a number, in `quantityUnit`. */
  quantity?: number;
  quantityUnit?: string;
  /** Set for cement, fertiliser and farm produce, which have a 50 kg threshold. */
  isBaggedBulkCommodity?: boolean;
}

/** How much of the package the capture stage actually saw. */
export interface EvidenceContext {
  imageIds?: string[];
  /**
   * 0–1. How completely the package was captured, from the faces photographed.
   * Printed on the report so a reader knows how much of the package was seen;
   * it does not change any check's outcome.
   */
  captureCompleteness?: number;
  /** 0–1 mean image quality from a future image-quality stage. */
  imageQuality?: number;
  /** Which faces were captured. */
  facesCaptured?: string[];
  /** Name and version of whatever produced the fields. Recorded, never trusted. */
  extractionEngine?: string;
  extractionEngineVersion?: string;
}

/** The request the engine evaluates. */
export interface ComplianceEvaluationRequest {
  inspectionId?: string;
  /** ISO date. Every rule and exception is resolved against this and nothing else. */
  inspectionDate: string;
  productContext: ProductContext;
  /** Keyed by field name, e.g. `mrp`, `net_quantity`. */
  fields: Record<string, ExtractedField>;
  evidence?: EvidenceContext;
  options?: {
    /** Include rules that are not yet in force, marked as such. Never evaluated. */
    includeFutureRules?: boolean;
  };
}
