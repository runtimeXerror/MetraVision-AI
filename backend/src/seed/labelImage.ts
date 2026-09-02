import type { BBox, ProductCategory } from '../types/domain';

/**
 * Synthetic package labels for seeded inspections.
 *
 * Seeded records used to carry no image at all, which was honest but left the
 * dashboard's evidence panel with nothing to draw on — and the evidence panel
 * is the thing that lets a supervisor check a finding rather than take it on
 * trust.
 *
 * So each seeded inspection gets a *rendered* label: an SVG in the same 800×1000
 * coordinate space the mock analyser reports its bounding boxes in, with every
 * declaration drawn at the box the analyser claims to have read it from. The
 * overlay therefore lines up with real text, and demonstrates the actual
 * mechanism rather than a decorative rectangle.
 *
 * These are deliberately drawn to look like what they are — a schematic, not a
 * photograph. Nothing here should be mistakable for evidence of a real package.
 */

export interface LabelField {
  name: string;
  label: string;
  value: string | null;
  bbox: BBox;
}

const SPACE = { width: 800, height: 1000 };

/** Face-specific tint, so FRONT and BACK are visibly different captures. */
const FACE_TINT: Record<string, string> = {
  FRONT: '#f8fafc',
  BACK: '#f5f5f4',
  SIDE: '#f8f7f4',
  ADDITIONAL: '#f7f8fa',
};

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Breaks a long declaration across the width of its own bounding box. */
function wrap(text: string, maxChars: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length > maxChars && current) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }

  if (current) lines.push(current);
  return lines.slice(0, 2);
}

/**
 * Renders one package face.
 *
 * `fields` are the declarations the analyser located. A field with a null value
 * is simply *not drawn* — which is what makes the missing-declaration findings
 * verifiable: the inspector looks at the label and there is genuinely nothing
 * there.
 */
export function renderLabelSvg(input: {
  productName: string;
  category: ProductCategory;
  face: string;
  fields: LabelField[];
}): string {
  const tint = FACE_TINT[input.face] ?? '#f8fafc';

  const drawn = input.fields.filter(
    (field) =>
      field.value !== null &&
      field.value.trim() !== '' &&
      field.bbox[2] - field.bbox[0] > 0 &&
      field.bbox[3] - field.bbox[1] > 0,
  );

  const blocks = drawn
    .map((field) => {
      const [x1, y1, x2, y2] = field.bbox;
      const width = x2 - x1;
      const height = y2 - y1;

      // Size the type to the box the analyser reported, within legible bounds.
      const valueSize = Math.max(15, Math.min(30, Math.round(height * 0.42)));
      const maxChars = Math.max(10, Math.floor(width / (valueSize * 0.52)));
      const lines = wrap(field.value as string, maxChars);

      const label = escapeXml(field.label.toUpperCase());
      const rendered = lines
        .map(
          (line, index) =>
            `<tspan x="${x1 + 4}" dy="${index === 0 ? 0 : valueSize + 2}">${escapeXml(line)}</tspan>`,
        )
        .join('');

      return `
    <g>
      <text x="${x1 + 4}" y="${y1 + 14}" font-family="Segoe UI, Helvetica, Arial, sans-serif"
            font-size="10" letter-spacing="0.8" fill="#94a3b8">${label}</text>
      <text x="${x1 + 4}" y="${y1 + 14 + valueSize + 4}" font-family="Segoe UI, Helvetica, Arial, sans-serif"
            font-size="${valueSize}" font-weight="600" fill="#0f172a">${rendered}</text>
    </g>`;
    })
    .join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SPACE.width} ${SPACE.height}" width="${SPACE.width}" height="${SPACE.height}">
  <rect width="${SPACE.width}" height="${SPACE.height}" fill="${tint}"/>
  <rect x="16" y="16" width="${SPACE.width - 32}" height="${SPACE.height - 32}" rx="18"
        fill="#ffffff" stroke="#cbd5e1" stroke-width="2"/>

  <!-- Marked as a schematic so it cannot be mistaken for a photograph. -->
  <text x="${SPACE.width / 2}" y="${SPACE.height - 40}" text-anchor="middle"
        font-family="Segoe UI, Helvetica, Arial, sans-serif" font-size="15" fill="#cbd5e1">
    SIMULATED LABEL · ${escapeXml(input.face)} FACE · NOT A PHOTOGRAPH
  </text>

  <text x="40" y="72" font-family="Segoe UI, Helvetica, Arial, sans-serif"
        font-size="26" font-weight="700" fill="#1e293b">${escapeXml(input.productName)}</text>
  <line x1="40" y1="90" x2="${SPACE.width - 40}" y2="90" stroke="#e2e8f0" stroke-width="2"/>
${blocks}
</svg>`;
}
