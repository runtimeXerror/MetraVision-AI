export {
  contextSignalsFrom,
  extractInformation,
  extractionService,
  InformationExtractionService,
  EXTRACTION_ENGINE,
  EXTRACTION_ENGINE_VERSION,
} from './InformationExtractionService';
export type {
  ContextSignal,
  ExtractedFieldRecord,
  ExtractionResult,
  LLMAssistance,
} from './InformationExtractionService';
export {
  canonicalUnit,
  firstAmount,
  normaliseLine,
  normaliseText,
  repairDigits,
  stripLabel,
  unifyCurrency,
} from './normalise';
export { ENGINE_FIELDS, FIELD_SPECS, INFORMATIONAL_FIELDS, quantityValue } from './patterns';
export type { ExtractionMethod, FieldSpec } from './patterns';
