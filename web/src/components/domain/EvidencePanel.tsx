import { ImageOff, Maximize2, X } from 'lucide-react';
import { useEffect, useState } from 'react';

import { Badge } from '@/components/ui/primitives';
import type { BBox, BBoxSpace, ProductImage } from '@/types/api';
import { cn } from '@/utils/cn';
import { humanise } from '@/utils/format';

/**
 * Evidence display.
 *
 * The point of this component is that a finding can be *checked*. A supervisor
 * being asked to endorse "MRP not declared" has to be able to see the face of
 * the package the model looked at and where on it the model looked — otherwise
 * they are endorsing the model, not the evidence.
 *
 * Boxes arrive in the analyser's coordinate space (`bboxSpace`) and are drawn
 * as percentages, so they stay correct at any rendered size.
 */

function boxStyle(bbox: BBox, space: BBoxSpace): React.CSSProperties {
  const [x1, y1, x2, y2] = bbox;
  return {
    left: `${(x1 / space.width) * 100}%`,
    top: `${(y1 / space.height) * 100}%`,
    width: `${((x2 - x1) / space.width) * 100}%`,
    height: `${((y2 - y1) / space.height) * 100}%`,
  };
}

/** A bbox of all zeros means "not found", not "found at the origin". */
function isDrawable(bbox?: BBox): bbox is BBox {
  return Boolean(bbox && bbox.length === 4 && (bbox[2] - bbox[0] > 0) && (bbox[3] - bbox[1] > 0));
}

export interface EvidenceMark {
  label: string;
  bbox?: BBox;
  sourceImageId?: string;
  tone?: 'brand' | 'violation' | 'review';
}

/**
 * One image with any evidence regions drawn over it.
 */
export function EvidenceImage({
  image,
  marks = [],
  space,
  className,
  onExpand,
}: {
  image: ProductImage;
  marks?: EvidenceMark[];
  space: BBoxSpace;
  className?: string;
  onExpand?: () => void;
}) {
  const [failed, setFailed] = useState(false);

  const relevant = marks.filter(
    (mark) =>
      isDrawable(mark.bbox) && (!mark.sourceImageId || mark.sourceImageId === image.imageId),
  );

  return (
    <figure
      className={cn(
        'group relative overflow-hidden rounded-lg border border-line bg-surface-sunken',
        className,
      )}
    >
      {failed ? (
        <div className="flex aspect-[4/5] flex-col items-center justify-center gap-2 text-ink-faint">
          <ImageOff className="h-6 w-6" strokeWidth={1.75} aria-hidden />
          <p className="px-4 text-center text-xs">Image unavailable</p>
        </div>
      ) : (
        <>
          <img
            src={image.url}
            alt={`${humanise(image.type)} face of the inspected package`}
            loading="lazy"
            onError={() => setFailed(true)}
            className="aspect-[4/5] w-full object-cover"
          />

          {relevant.map((mark, index) => (
            <span
              key={`${mark.label}-${index}`}
              className={cn(
                'pointer-events-none absolute rounded-sm border-2 shadow-[0_0_0_9999px_rgba(0,0,0,0.02)]',
                mark.tone === 'violation'
                  ? 'border-violation'
                  : mark.tone === 'review'
                    ? 'border-review'
                    : 'border-brand',
              )}
              style={boxStyle(mark.bbox as BBox, space)}
            >
              <span
                className={cn(
                  'absolute -top-[1.15rem] left-0 whitespace-nowrap rounded px-1 py-0.5 text-[0.5625rem] font-semibold uppercase tracking-wide text-white',
                  mark.tone === 'violation'
                    ? 'bg-violation'
                    : mark.tone === 'review'
                      ? 'bg-review'
                      : 'bg-brand',
                )}
              >
                {mark.label}
              </span>
            </span>
          ))}
        </>
      )}

      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-2 p-2">
        <Badge tone="neutral" className="bg-surface/90 backdrop-blur">
          {humanise(image.type)}
        </Badge>
        {onExpand && !failed ? (
          <button
            type="button"
            onClick={onExpand}
            className="pointer-events-auto grid h-7 w-7 place-items-center rounded-md bg-surface/90 text-ink-muted opacity-0 backdrop-blur transition-opacity hover:text-ink focus-visible:opacity-100 group-hover:opacity-100"
            aria-label="Enlarge image"
          >
            <Maximize2 className="h-3.5 w-3.5" strokeWidth={2} />
          </button>
        ) : null}
      </div>
    </figure>
  );
}

/**
 * The image gallery for an inspection, with a lightbox.
 */
export function EvidenceGallery({
  images,
  marks = [],
  space,
  columns = 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-4',
}: {
  images: ProductImage[];
  marks?: EvidenceMark[];
  space: BBoxSpace;
  columns?: string;
}) {
  const [expanded, setExpanded] = useState<ProductImage | null>(null);

  if (images.length === 0) {
    return (
      <p className="px-5 py-8 text-center text-sm text-ink-muted">
        No images were captured for this inspection.
      </p>
    );
  }

  return (
    <>
      <div className={cn('grid gap-3', columns)}>
        {images.map((image) => (
          <EvidenceImage
            key={image.imageId}
            image={image}
            marks={marks}
            space={space}
            onExpand={() => setExpanded(image)}
          />
        ))}
      </div>

      {expanded ? (
        <Lightbox image={expanded} marks={marks} space={space} onClose={() => setExpanded(null)} />
      ) : null}
    </>
  );
}

function Lightbox({
  image,
  marks,
  space,
  onClose,
}: {
  image: ProductImage;
  marks: EvidenceMark[];
  space: BBoxSpace;
  onClose: () => void;
}) {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKeyDown);
    // The page behind must not scroll while the overlay is up.
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previous;
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-4 sm:p-8"
      role="dialog"
      aria-modal="true"
      aria-label="Enlarged evidence image"
    >
      <button
        type="button"
        className="absolute inset-0 cursor-zoom-out"
        onClick={onClose}
        aria-label="Close"
        tabIndex={-1}
      />

      <div className="relative max-h-full w-full max-w-3xl overflow-hidden rounded-card bg-surface shadow-pop">
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <div>
            <p className="text-sm font-semibold text-ink">{humanise(image.type)} face</p>
            <p className="font-mono text-2xs text-ink-muted">{image.imageId}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="grid h-8 w-8 place-items-center rounded-lg text-ink-muted hover:bg-surface-sunken hover:text-ink"
            aria-label="Close"
          >
            <X className="h-4 w-4" strokeWidth={2} />
          </button>
        </div>

        <div className="max-h-[70vh] overflow-auto scroll-slim p-4">
          <EvidenceImage image={image} marks={marks} space={space} className="mx-auto max-w-lg" />
        </div>
      </div>
    </div>
  );
}
