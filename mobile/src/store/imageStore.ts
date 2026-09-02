import { create } from 'zustand';

import type { ImageQuality, ImageSide, ImageSource, ProductImage, QualityRating } from '../types';
import { generateId } from '../utils/id';

/**
 * Captured images for the inspection in progress.
 *
 * Kept apart from `inspectionStore` because the capture and quality screens
 * re-render on every shutter press, while the details form does not need to.
 */

interface AddImageInput {
  uri: string;
  side: ImageSide;
  source: ImageSource;
  width?: number;
  height?: number;
  fileSize?: number;
}

interface ImageState {
  images: ProductImage[];
  /** Which package face the next capture is tagged with. */
  activeSide: ImageSide;

  /**
   * Local image id → the server id it was uploaded as.
   *
   * The record of what is *already on the inspection*, and the thing that stops
   * a photograph being uploaded twice. Without it, an inspector who reached the
   * analysis step, pressed back, and pressed Continue again uploaded the whole
   * set a second time — so one photograph of the front face appeared on the
   * record three times after three passes, and the report counted three images
   * where the officer had taken one.
   *
   * Cleared per-image on retake and removal, since both mean the bytes on the
   * server are no longer the bytes in hand.
   */
  uploaded: Record<string, string>;

  add: (input: AddImageInput) => ProductImage;
  remove: (id: string) => void;
  /** Replaces an image in place, preserving its slot order — used by Retake. */
  replace: (id: string, input: AddImageInput) => void;
  setActiveSide: (side: ImageSide) => void;
  /** Runs the simulated quality assessment over every image. */
  assessQuality: () => void;
  /** Records an image as uploaded, so it is not sent again. */
  markUploaded: (localId: string, remoteId: string) => void;
  /** Restores images from a saved draft, in their captured order. */
  hydrate: (images: ProductImage[], uploaded?: Record<string, string>) => void;
  reset: () => void;
}

/**
 * Simulated image-quality assessment.
 *
 * No image data is examined. The ratings are derived from the image's slot so
 * they stay stable across re-renders (a randomised score that changed on every
 * render would make the screen flicker and the demo unrepeatable).
 *
 * Phase 2: replace with a blur/exposure check — either on-device or as the
 * first stage of the AI service — and keep this same `ImageQuality` shape.
 */
function assess(image: ProductImage, index: number): ImageQuality {
  // Deterministic per-slot variation so the demo shows a mixed report.
  const glare: QualityRating = index % 3 === 1 ? 'warning' : 'good';
  const sharpness: QualityRating = index % 4 === 3 ? 'warning' : 'good';

  const ratings: QualityRating[] = [sharpness, 'good', 'good', glare];
  const weights: Record<QualityRating, number> = { good: 1, warning: 0.6, poor: 0.2 };
  const overallScore =
    ratings.reduce((sum, rating) => sum + weights[rating], 0) / ratings.length;

  const notes: string[] = [];
  if (glare === 'warning') {
    notes.push('Glare detected on part of the label. Reposition to avoid direct light.');
  }
  if (sharpness === 'warning') {
    notes.push('Edges are slightly soft. Hold steady or move closer to the label.');
  }
  if (notes.length === 0) {
    notes.push('All declarations appear legible in this capture.');
  }

  return {
    sharpness,
    lighting: 'good',
    textVisibility: 'good',
    glare,
    overallScore,
    notes,
  };
}

export const useImageStore = create<ImageState>((set, get) => ({
  images: [],
  activeSide: 'front',
  uploaded: {},

  add(input) {
    const image: ProductImage = {
      id: generateId('img'),
      uri: input.uri,
      side: input.side,
      source: input.source,
      width: input.width,
      height: input.height,
      fileSize: input.fileSize,
      capturedAt: new Date().toISOString(),
    };

    set((state) => ({ images: [...state.images, image] }));
    return image;
  },

  remove(id) {
    set((state) => {
      // Drop the upload record with the image, or its slot would be treated as
      // already sent if a later capture reused the id.
      const { [id]: _removed, ...uploaded } = state.uploaded;
      return { images: state.images.filter((image) => image.id !== id), uploaded };
    });
  },

  replace(id, input) {
    set((state) => ({
      // A retake keeps the local id but changes the bytes behind it, so the
      // previous upload no longer represents this image and it must go again.
      uploaded: Object.fromEntries(
        Object.entries(state.uploaded).filter(([localId]) => localId !== id),
      ),
      images: state.images.map((image) =>
        image.id === id
          ? {
              ...image,
              uri: input.uri,
              source: input.source,
              width: input.width,
              height: input.height,
              fileSize: input.fileSize,
              capturedAt: new Date().toISOString(),
              // A new photograph invalidates the previous assessment.
              quality: undefined,
            }
          : image,
      ),
    }));
  },

  setActiveSide(activeSide) {
    set({ activeSide });
  },

  assessQuality() {
    set({
      images: get().images.map((image, index) => ({ ...image, quality: assess(image, index) })),
    });
  },

  markUploaded(localId, remoteId) {
    set((state) => ({ uploaded: { ...state.uploaded, [localId]: remoteId } }));
  },

  hydrate(images, uploaded) {
    // `activeSide` follows the last image captured, so resuming a capture
    // leaves the shutter pointed at the face the inspector was working on.
    const last = images[images.length - 1];
    // The upload record is restored with the images: a resumed draft whose
    // photographs were already sent must not send them a second time.
    set({ images, uploaded: uploaded ?? {}, activeSide: last?.side ?? 'front' });
  },

  reset() {
    set({ images: [], uploaded: {}, activeSide: 'front' });
  },
}));

/** Worst overall score across the set — drives the quality screen's verdict. */
export function lowestQualityScore(images: ProductImage[]): number {
  const scores = images.map((image) => image.quality?.overallScore ?? 1);
  return scores.length > 0 ? Math.min(...scores) : 1;
}
