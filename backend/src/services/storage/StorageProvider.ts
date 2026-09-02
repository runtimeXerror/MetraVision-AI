/**
 * Storage abstraction.
 *
 * Controllers depend on this interface, never on a concrete provider. Swapping
 * local disk for S3, Cloudinary or GCS in a later phase means adding one class
 * and changing `STORAGE_PROVIDER` — no route, controller or model changes.
 */

export interface StoredObject {
  /** Provider-specific key. Opaque to callers; persisted so deletes can find it. */
  key: string;
  /** Publicly resolvable URL for the stored object. */
  url: string;
  sizeBytes: number;
  mimeType: string;
}

export interface PutObjectInput {
  buffer: Buffer;
  originalName: string;
  mimeType: string;
  /** Logical grouping, e.g. `inspections/<inspectionId>`. */
  prefix: string;
}

export interface StorageProvider {
  readonly name: string;
  put(input: PutObjectInput): Promise<StoredObject>;
  /**
   * Reads an object back.
   *
   * Needed so an inspection can be re-scanned from the photographs already on
   * record — a new OCR provider, a corrected product context, or simply a
   * retry after an outage — without asking an inspector who has left the shop
   * to photograph the package again.
   */
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
  /** Resolves a stored key to a URL. Signed URLs would be generated here. */
  urlFor(key: string): string;
}
