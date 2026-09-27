import { LETTERHEAD } from '../../constants/identity';
import { APP_META } from '../../constants/labels';
import { formatDateTime } from '../../utils/format';

import { emblemDataUri, letterheadDataUri } from './brandImages';

/**
 * ── DOCUMENT CHROME ─────────────────────────────────────────────────────────
 * The printed document: a government letterhead, rendered to PDF on the device.
 *
 * Built from the *report payload*, never from a screenshot of the screen. That
 * distinction is the whole point: a document that may be served on a dealer has
 * to be reproducible from the record, and a capture of whatever the inspector's
 * phone happened to be showing is not.
 *
 * Black on white, with the emblem drawn as inline vector. Both choices are
 * practical rather than stylistic — a filled colour panel costs an inspector a
 * cartridge every time a copy is printed at a district office, and an inline
 * mark is the only kind that survives an iOS print WebView, which will not load
 * a local asset.
 * ────────────────────────────────────────────────────────────────────────────
 */

/** A4 at 72 PPI, which is what `expo-print` measures its page in. */
export const A4 = { width: 595, height: 842 } as const;

/** Escapes text for HTML. Every interpolated value goes through this. */
export function esc(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** `—` for anything absent, so a blank cell is never mistaken for a zero. */
export function orDash(value?: string | number | null): string {
  if (value === null || value === undefined || value === '') return '—';
  return esc(value);
}

export interface DocumentMeta {
  /** Document type, e.g. "Inspection Report". */
  title: string;
  /** Reference numbers printed under the title, in order. */
  references: Array<{ label: string; value: string }>;
  /** One line describing what the document covers. */
  scope: string;
  generatedBy: string;
  generatedAt: string;
}

/**
 * The print stylesheet.
 *
 * The Devanagari stack is explicit: the ministry's name is half in Hindi, and a
 * generic sans falls back to empty boxes for it on both platforms.
 */
const STYLES = `
  /*
   * Page geometry.
   *
   * @page is honoured by the Android print stack; the iOS print formatter
   * largely ignores it, which is why the repeating thead/tfoot frame below
   * carries the same job. Both are present so the document is bounded on both
   * platforms rather than on whichever one was tested last.
   */
  @page { margin: 12mm 11mm 14mm; }

  * { box-sizing: border-box; }
  body {
    margin: 0;
    /*
     * The tail of this stack is not decoration. Two characters in this document
     * are outside the Latin range a default sans covers: the rupee sign in
     * every price, and the ministry's name in Devanagari. A stack that ends at
     * Arial renders both as empty boxes, and a report that prints the MRP as
     * a tofu square is not a document about prices. The Devanagari and Noto
     * faces are named last so they are reached only for the glyphs the faces
     * ahead of them do not carry.
     */
    font-family: -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial,
                 "Noto Sans", "Noto Sans Devanagari", "Nirmala UI",
                 "Kohinoor Devanagari", sans-serif;
    font-size: 10.5px;
    line-height: 1.5;
    color: #1A1A1A;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  /*
   * Padding on the *first* page only, which is where the letterhead sits.
   * Pages after it are spaced by the repeating frame — putting the inset here
   * alone was the original defect: page one breathed, and every page after it
   * ran text to the last millimetre of the sheet and resumed at the first
   * millimetre of the next.
   */
  /*
   * ── INSET ONCE, NOT TWICE ──────────────────────────────────────────────
   *
   * @page already sets an 11 mm side margin — about 31 pt on a 595 pt sheet —
   * and this added 26 pt of padding inside it. Together they took 114 pt off
   * the usable width, nearly a fifth of the page, and gave it to nothing. The
   * page margin is the one that has to stay, because it is what a printer can
   * actually reach; this becomes a hairline of breathing room rather than a
   * second margin.
   */
  .page { padding: 14px 6px 0; }

  /*
   * The repeating frame.
   *
   * thead and tfoot are re-drawn on every printed page by every engine that
   * paginates HTML, so this is what actually guarantees a top and bottom margin
   * on page two onward, and what puts the document's identity at the foot of
   * each sheet — a loose page of an enforcement report has to be traceable to
   * the inspection it came from.
   */
  /*
   * A border of none, explicitly, and it is not redundant.
   *
   * The data tables below take a hairline box so their columns read as a grid.
   * That rule is written against the bare table selector, and this — the
   * full-page layout frame that carries the letterhead, the body and the footer
   * spacer — is also a table. So it inherited the box, and every sheet of the
   * report came out with a rectangle drawn around the whole page.
   *
   * The frame is scaffolding for pagination, not a thing anyone should see.
   */
  table.frame { width: 100%; border-collapse: collapse; border: none; }
  table.frame > thead > tr > td,
  table.frame > tfoot > tr > td,
  table.frame > tbody > tr > td { padding: 0; }
  table.frame > thead > tr > td { height: 8px; }
  table.frame > tbody > tr > td { vertical-align: top; }

  /*
   * The tfoot is now an empty spacer, not the footer itself.
   *
   * It exists only to reserve the strip at the foot of every page that the
   * pinned footer paints into, so body text can never run underneath it. It
   * carries no content because a tfoot flows immediately after the content on
   * the final page — which is what put the footer halfway up a short last page
   * instead of at the bottom of the sheet.
   */
  /* Reserves exactly the footer's own height plus a little air, so the body
     stops just above it rather than well short of it. */
  table.frame > tfoot > tr > td { height: 22px; }

  /*
   * The footer itself, pinned to the bottom of every sheet.
   *
   * A fixed-position element is painted once per page by every engine that
   * paginates HTML, at the same offset on each — which is exactly a running
   * footer, and the only mechanism that puts one at the bottom of a page the
   * content did not fill. The tfoot spacer above keeps the two from colliding.
   */
  /*
   * ── THE RUNNING FOOTER ─────────────────────────────────────────────────
   *
   * No rule above it. It had one, and against the page's own bottom edge that
   * read as two lines a few points apart with nothing between them — a border
   * drawn to separate the footer from a body that had already ended.
   *
   * Seven-point grey at the foot of the sheet is unmistakably a footer without
   * being fenced off, so the line goes and the band closes up: a fixed height
   * with the text centred in it, rather than padding above the text and
   * whatever was left below.
   *
   * Inset to match the page padding, so the three items line up with the columns of the
   * table above them instead of starting somewhere of their own.
   */
  .runfoot {
    position: fixed;
    left: 6px;
    right: 6px;
    bottom: 0;
    height: 18px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    font-size: 7px;
    color: #6B6B6B;
  }
  .hi {
    font-family: "Noto Sans Devanagari", "Nirmala UI", "Devanagari Sangam MN",
                 "Kohinoor Devanagari", sans-serif;
  }

  /* Letterhead: the issuing department on the left, the government it belongs
     to on the right — the arrangement a departmental letterhead actually uses,
     with the seal leading and the parent body cited beside it. */
  .lh { display: flex; align-items: flex-start; justify-content: space-between; gap: 24px; }
  .lh-left { flex: 0 1 auto; }
  .lh-right { flex: 0 0 auto; text-align: right; padding-top: 2px; }
  .idblock { display: flex; align-items: center; gap: 11px; }
  .idblock .seal { height: 56px; width: auto; display: block; }
  .dept-hi { font-size: 10px; font-weight: 600; line-height: 1.35; }
  .dept-en-small { font-size: 9.5px; letter-spacing: 0.4px; line-height: 1.3; }
  .dept-en { font-size: 14px; font-weight: 700; letter-spacing: 0.2px; line-height: 1.2; }
  .lockup { display: block; height: 58px; width: auto; }
  .lh-right .gov-hi { font-size: 11px; font-weight: 600; }
  .lh-right .gov { font-size: 10.5px; font-weight: 700; letter-spacing: 0.3px; }
  .lh-right .min { font-size: 7.5px; color: #444444; margin-top: 3px; max-width: 230px; margin-left: auto; }
  .lh-right .division { font-size: 7.5px; color: #767676; margin-top: 3px; }
  .rule { border-top: 2px solid #1A1A1A; margin-top: 10px; }
  .rule.thin { border-top: 1px solid #1A1A1A; margin-top: 2px; }

  .doctitle {
    text-align: center; margin-top: 14px;
    font-size: 13px; font-weight: 700; letter-spacing: 1.4px; text-transform: uppercase;
  }
  .refs {
    display: flex; justify-content: center; flex-wrap: wrap; gap: 6px 26px;
    margin-top: 8px; padding: 7px 0;
    border-top: 1px solid #D4D4D4; border-bottom: 1px solid #D4D4D4;
  }
  .refs .k { font-size: 7.5px; letter-spacing: 0.6px; text-transform: uppercase; color: #666666; }
  .refs .v { font-family: "SFMono-Regular", Consolas, monospace; font-size: 10px; font-weight: 700; }
  .scope { margin-top: 9px; color: #444444; }

  /* Sections */
  /*
   * ── ONE COLOUR, AND WHERE IT IS SPENT ─────────────────────────────────
   *
   * The document was black on white, for a reason that still holds: a filled
   * colour panel costs a district office a cartridge every time a copy is run
   * off. That argument is about *area*, though, and it was being applied to
   * everything — so a fourteen-page report had no visual structure at all and
   * a reader looking for the findings had to read the headings to find them.
   *
   * The departmental navy is spent only on strokes and small type: section
   * headings, the rule under them, and the column heads. Nothing is filled.
   * A page of this prints for the same ink as before, and the sections are
   * findable at arm's length — which is how a report on a desk is actually
   * read.
   *
   * It is the same navy the app uses on screen, so the report an officer shows
   * a dealer and the PDF that is filed are recognisably one document.
   */
  h2 {
    font-size: 9.5px; font-weight: 700; letter-spacing: 1px; text-transform: uppercase;
    margin: 14px 0 6px; padding-bottom: 3px;
    color: #0A2A5C; border-bottom: 1px solid #0A2A5C;
  }
  p { margin: 0 0 6px; }
  .muted { color: #444444; }
  .faint { color: #767676; }
  .mono { font-family: "SFMono-Regular", Consolas, monospace; }

  /*
   * ── RULED BOTH WAYS ───────────────────────────────────────────────────
   *
   * Horizontal rules alone leave a five-column table as five columns held
   * apart by whitespace, and the moment one cell wraps to three lines the
   * reader loses which value belongs to which column. That is not cosmetic on
   * a document where the columns are the declaration, its value and whether it
   * complies.
   *
   * Hairlines, not borders: 0.5px in a light grey, so the grid organises the
   * page without becoming the loudest thing on it. The outer edge is a shade
   * darker to close the block.
   */
  table:not(.frame) { width: 100%; border-collapse: collapse; border: 0.75px solid #C8C8C8; }
  table:not(.frame) th, table:not(.frame) td {
    text-align: left; padding: 4px 7px; vertical-align: top;
    border-bottom: 0.5px solid #E0E0E0; border-right: 0.5px solid #E0E0E0;
  }
  table:not(.frame) th:last-child, table:not(.frame) td:last-child { border-right: none; }
  th {
    font-size: 7.5px; letter-spacing: 0.6px; text-transform: uppercase;
    color: #0A2A5C; font-weight: 700; border-bottom: 1px solid #0A2A5C;
  }
  td.num, th.num { text-align: right; white-space: nowrap; }
  /* The provision column. Narrow and unwrapped, because "6(1)(da)" broken
     across two lines stops being a citation a reader can look up. */
  td.rule, th.rule { white-space: nowrap; width: 1%; font-size: 9px; }
  tr.total td { font-weight: 700; border-bottom: none; border-top: 1px solid #0A2A5C; }
  table.kv td:first-child { width: 33%; color: #444444; }
  table.kv td:last-child { font-weight: 700; }

  /* Verdict */
  /*
   * ── THE DETERMINATION CARRIES ITS OUTCOME ──────────────────────────────
   *
   * The block was a black rule around black type whatever the finding was, so
   * a clean report and one carrying a violation looked identical until you
   * read them. A determination is the one line of an enforcement document that
   * has to be legible across a desk.
   *
   * The tone is spent on the left edge, the heading and a wash — a few square
   * centimetres, not a filled panel, so the ink argument that keeps the rest
   * of this document monochrome still holds.
   */
  .verdict {
    display: flex; justify-content: space-between; align-items: flex-end; gap: 16px;
    margin-top: 10px; padding: 10px 12px;
    border: 1px solid #C9C9C9; border-left: 3px solid #1A1A1A;
  }
  .verdict .label { font-size: 7.5px; letter-spacing: 0.7px; text-transform: uppercase; color: #666666; }
  .verdict .status { font-size: 15px; font-weight: 700; margin-top: 2px; line-height: 1.3; }
  .verdict .score { font-size: 22px; font-weight: 700; }
  .verdict.ok   { border-left-color: #1B6B4A; background: #F3FAF6; }
  .verdict.bad  { border-left-color: #A61B1B; background: #FDF4F4; }
  .verdict.warn { border-left-color: #8A5A00; background: #FDF8EF; }
  .verdict.ok   .status { color: #1B6B4A; }
  .verdict.bad  .status { color: #A61B1B; }
  .verdict.warn .status { color: #8A5A00; }

  /*
   * ── THE SNAPSHOT, AND WHY NOTHING HERE HAS A HEIGHT ────────────────────
   *
   * Four counts, so a reader knows the shape of the finding before reading a
   * row of the schedule.
   *
   * Every box is sized by its own content. The version of this that came
   * before set a height on the tile and a large font on the numeral inside it,
   * and the numeral was clipped along its baseline on every tile — a report
   * whose headline figures were cut in half. A print engine will not reflow a
   * fixed box to fit what is in it, so the box does not get to be fixed:
   * padding and an explicit line-height do the spacing, and the tile grows to
   * whatever the label and the number need.
   *
   * The label sits above the number and is allowed to wrap to two lines, which
   * is the other half of that defect — "Not applicable" wrapped, pushed the
   * numeral down, and the numeral had nowhere to go.
   */
  .snap { display: flex; gap: 6px; margin-top: 8px; align-items: stretch; }
  .snap > div {
    flex: 1 1 0; min-width: 0;
    padding: 6px 8px 7px;
    border: 1px solid #DCDCDC; border-top-width: 2px;
    text-align: center;
    overflow: visible;
  }
  .snap .k {
    font-size: 6.8px; letter-spacing: 0.5px; text-transform: uppercase;
    color: #555555; line-height: 1.3; min-height: 17px;
  }
  .snap .v {
    font-size: 16px; font-weight: 700; line-height: 1.25; margin-top: 2px;
  }
  .snap .ok   { border-top-color: #1B6B4A; background: #F3FAF6; }
  .snap .bad  { border-top-color: #A61B1B; background: #FDF4F4; }
  .snap .warn { border-top-color: #8A5A00; background: #FDF8EF; }
  .snap .na   { border-top-color: #8A94A6; background: #F5F7FA; }
  .snap .ok   .v { color: #1B6B4A; }
  .snap .bad  .v { color: #A61B1B; }
  .snap .warn .v { color: #8A5A00; }
  .snap .na   .v { color: #5A6472; }

  .tag {
    display: inline-block; padding: 0 6px; border: 1px solid #1A1A1A; border-radius: 2px;
    font-size: 8px; font-weight: 700; letter-spacing: 0.4px; text-transform: uppercase;
    white-space: nowrap;
  }
  .tag.solid { background: #1A1A1A; color: #FFFFFF; }
  .amended { font-size: 8px; color: #666666; margin-top: 2px; }

  /* Figures */
  .kpis { display: flex; flex-wrap: wrap; border-left: 1px solid #E0E0E0; }
  .kpi {
    flex: 1 1 25%; min-width: 100px; padding: 9px 12px;
    border-right: 1px solid #E0E0E0; border-top: 1px solid #E0E0E0; border-bottom: 1px solid #E0E0E0;
  }
  .kpi .k { font-size: 7.5px; letter-spacing: 0.6px; text-transform: uppercase; color: #666666; }
  .kpi .v { font-size: 18px; font-weight: 700; margin-top: 2px; }

  /* Part-to-whole. A 2px gap in the surface separates touching segments —
     never a border, which would add ink that is not data. */
  .share { display: flex; gap: 2px; height: 12px; margin: 4px 0 10px; }
  .share > i { display: block; height: 100%; }
  .share > i:first-child { border-top-left-radius: 6px; border-bottom-left-radius: 6px; }
  .share > i:last-child { border-top-right-radius: 6px; border-bottom-right-radius: 6px; }
  .key { width: 9px; height: 9px; border-radius: 3px; display: inline-block; vertical-align: -1px; }

  /* Columns grow from one baseline and are capped, so a short window draws bars
     rather than blocks. Distributing the leftover is what keeps the series
     spanning the full axis: collected on the right instead, the columns stop
     short of the last date label they are supposed to meet. */
  .cols {
    display: flex; align-items: flex-end; justify-content: space-between;
    gap: 2px; height: 88px;
  }
  .cols > div {
    flex: 1 1 0; max-width: 22px;
    display: flex; flex-direction: column; justify-content: flex-end;
  }
  .cols b { display: block; width: 100%; }
  .axis { border-top: 1px solid #1A1A1A; display: flex; justify-content: space-between; padding-top: 3px; }
  .keys { display: flex; gap: 16px; margin-top: 8px; }
  .keys span { display: inline-flex; align-items: center; gap: 5px; font-size: 8.5px; color: #444444; }
  .keys i { width: 9px; height: 9px; border-radius: 3px; display: inline-block; }

  .bar { height: 7px; border-radius: 4px; background: #EAEAEA; overflow: hidden; margin-top: 4px; }
  .bar > i { display: block; height: 100%; border-radius: 4px; background: #1A1A1A; }

  /* Evidence */
  /*
   * ── THE WHOLE PHOTOGRAPH ───────────────────────────────────────────────
   *
   * object-fit: cover filled a fixed 150x110 box by cropping whatever did not
   * fit, and what did not fit was the edges of the packet. On a report where
   * the photographs *are* the evidence that is not a layout choice — it is the
   * document quietly deciding which part of the evidence the reader sees. A
   * declaration printed near the edge of a panel could be cut off the exhibit
   * that is supposed to prove it was read.
   *
   * object-fit: contain shows all of it. The box is taller because a packet photographed
   * upright is portrait and a 150x110 landscape frame would letterbox it to
   * nothing.
   */
  /*
   * The photographs take the width they are given.
   *
   * Fixed at 170 pt they left two thirds of the row empty on a two-image
   * record — which is most records, since the capture flow asks for a front and
   * a back. Flexing means two images are half a page wide each and four are a
   * quarter, and in every case the evidence is as large as the paper allows.
   * On a document where the photographs are the exhibit, unused width is
   * evidence made smaller for no reason.
   */
  .evidence { display: flex; flex-wrap: wrap; gap: 12px; }
  .evidence figure { margin: 0; flex: 1 1 150px; max-width: 260px; }
  .evidence img {
    width: 100%; height: 200px; object-fit: contain;
    border: 1px solid #C9C9C9; background: #FFFFFF;
  }
  .evidence figcaption { font-size: 8px; color: #444444; margin-top: 3px; }

  /* Findings */
  .finding { padding: 8px 0; border-bottom: 1px solid #E0E0E0; }
  .finding:last-child { border-bottom: none; }
  .finding .head { display: flex; justify-content: space-between; gap: 10px; }
  .finding .title { font-weight: 700; }
  .finding .cite { font-size: 8.5px; margin-top: 3px; font-weight: 600; }

  /* Attestation */
  /* A finding, and the absence of a mandatory declaration, in the one colour a
     reader must not scan past. Used nowhere else in the document. */
  .bad { color: #A61B1B; }
  .review { color: #8A5A00; }
  /* The other half of the pair. "Compliant" was left in body black, which read
     as an unmarked default rather than as a verdict, and made a column of
     results look like a column of findings with gaps in it. */
  .ok { color: #1B6B4A; font-weight: 700; }

  /*
   * The officer's attestation.
   *
   * A bordered block rather than a rule to sign: this half is already signed —
   * the record was filed from an authenticated session at a recorded time — and
   * a blank line under it would ask for a pen where the system already has
   * proof. The Controller's half keeps its rule, because a countersignature is
   * an act this software cannot make.
   */
  /*
   * ── THE SIGNATURE BLOCK ────────────────────────────────────────────────
   *
   * Laid out the way a signed government document is, because that is the form
   * a reader recognises and checks against.
   *
   * The digital signature sits *above* the rule it belongs to, on the signer's
   * own side — not opposite it. It read as a bordered panel on the left facing
   * the Controller's line on the right, which made it look like a second
   * signatory rather than the attestation of the first, and left the officer's
   * own line unsigned.
   *
   * Small, grey, right-aligned, three lines: who signed, which badge, and when
   * to the second with the offset. That is the shape of the certificate text a
   * DSC stamps onto a PDF, and it is deliberately not styled to look like
   * anything more official than it is — the record was filed from an
   * authenticated session, which is a real fact and a weaker one than a
   * cryptographic signature.
   */
  .sign { display: flex; justify-content: space-between; gap: 40px; margin-top: 22px; }
  /* Bottom-aligned, so the two signature rules meet whatever sits above them.
     The left column holds an empty slot for a pen and the right a signature
     box whose height depends on the officer's name and badge number; without
     this the two rules sat at different heights on the page. */
  .sign > div { flex: 1; display: flex; flex-direction: column; justify-content: flex-end; }
  .sign .line { border-top: 1px solid #1A1A1A; padding-top: 4px; font-size: 8.5px; }
  .sign .slot { min-height: 54px; }

  /**
   * ── THE SIGNATURE APPEARANCE ────────────────────────────────────────────
   *
   * Drawn as a box, because that is what a digital signature *is* on every
   * other document an officer handles: PDF readers render one as a bordered
   * stamp, and a reader who has seen a hundred of them recognises the shape
   * before reading a word of it.
   *
   * Set as four lines of loose type against the right margin, it read as a
   * caption — small grey text drifting off the edge of the page, easy to take
   * for a footer and easy to miss. It is the attestation.
   *
   * Centred rather than ranged right for the same reason. A stamp is centred
   * on what it attests; ranged right it looked like the tail of the line
   * above it rather than a block of its own.
   */
  .dsc {
    box-sizing: border-box;
    min-height: 54px;
    margin-bottom: 5px;
    padding: 6px 8px;
    border: 1px solid #8A94A6;
    border-radius: 3px;
    display: flex; flex-direction: column; justify-content: center;
    font-size: 7.5px; line-height: 1.45; color: #444444; text-align: center;
  }
  .dsc .by { color: #1A1A1A; }
  .dsc .name { font-weight: 700; font-size: 8.5px; }

  .foot {
    margin-top: 20px; padding-top: 8px; border-top: 1px solid #1A1A1A;
    font-size: 8px; color: #666666;
  }
  .note {
    margin-top: 12px; padding: 8px 10px; border-left: 2.5px solid #1A1A1A;
    background: #F6F6F6; font-size: 8.5px;
  }
  /*
   * Break control.
   *
   * A finding split down the middle — its citation on one page and the evidence
   * it rests on over the leaf — is the one thing a report of this kind must not
   * do, so the blocks that carry a single fact are kept whole.
   */
  h2, tr, .finding, figure, .verdict, .kpi, .note, .sign, .refs > div,
  .snap, .snap > div {
    page-break-inside: avoid;
    break-inside: avoid;
  }
  /* The counts belong to the determination above them, not to whatever the
     next page starts with. */
  .verdict { page-break-after: avoid; break-after: avoid; }
  /* A heading stranded as the last line of a page belongs to the next one. */
  h2 { page-break-after: avoid; break-after: avoid; }
  /* Never leave one line of a paragraph alone at a page boundary. */
  p, li, td { orphans: 3; widows: 3; }
`;

/** Wraps rendered sections in the letterhead, footer and stylesheet. */
export function documentShell(meta: DocumentMeta, body: string): string {
  const lockup = letterheadDataUri();
  const seal = emblemDataUri();

  // Three cases, ordered. The lockup already contains the department's name, so
  // it stands alone; the seal on its own is set beside the name; and with
  // neither installed the block falls back to type rather than to a stand-in.
  const identity = lockup
    ? `<img class="lockup" src="${lockup}" alt="${esc(LETTERHEAD.departmentEn)}" />`
    : `<div class="idblock">
        ${seal ? `<img class="seal" src="${seal}" alt="State Emblem of India" />` : ''}
        <div>
          <div class="dept-hi hi">${esc(LETTERHEAD.departmentHi)}</div>
          <div class="dept-en-small">Department of</div>
          <div class="dept-en">${esc(
            LETTERHEAD.departmentEn.replace(/^Department of /i, '').toUpperCase(),
          )}</div>
        </div>
      </div>`;

  const letterhead = `
    <div class="lh">
      <div class="lh-left">${identity}</div>
      <div class="lh-right">
        <div class="gov-hi hi">${esc(LETTERHEAD.governmentHi)}</div>
        <div class="gov">${esc(LETTERHEAD.governmentEn.toUpperCase())}</div>
        <div class="min hi">${esc(LETTERHEAD.ministryHi)}</div>
        <div class="min">${esc(LETTERHEAD.ministryEn.toUpperCase())}</div>
        <div class="division">${esc(LETTERHEAD.division)}</div>
      </div>
    </div>
    <div class="rule"></div>
    <div class="rule thin"></div>

    <div class="doctitle">${esc(meta.title)}</div>

    <div class="refs">
      ${meta.references
        .map(
          (reference) => `<div style="text-align:center">
            <div class="k">${esc(reference.label)}</div>
            <div class="v">${esc(reference.value)}</div>
          </div>`,
        )
        .join('')}
      <div style="text-align:center">
        <div class="k">Issued</div>
        <div class="v">${esc(formatDateTime(meta.generatedAt))}</div>
      </div>
    </div>

    <p class="scope">${esc(meta.scope)}</p>
  `;

  /** The document's own reference, for the foot of every sheet. */
  const reference = meta.references[0]?.value ?? meta.title;

  /*
   * ── ONE FOOTER, NOT TWO ────────────────────────────────────────────────
   *
   * The department and the division were printed in a block at the end of the
   * body, and again in the running footer at the bottom of every sheet, and the
   * generation timestamp appeared in both. A reader met the same three facts
   * three times on the last page.
   *
   * The block at the end of the body is gone. Provenance belongs in the running
   * footer, which is where a reader looks for it on a filed document and which
   * appears on every sheet rather than only the last.
   */
  const footer = '';

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${esc(meta.references[0] ? `${meta.title} ${meta.references[0].value}` : meta.title)}</title>
  <style>${STYLES}</style>
</head>
<body>
  <table class="frame">
    <thead><tr><td></td></tr></thead>
    <tfoot><tr><td></td></tr></tfoot>
    <tbody>
      <tr><td>
        <div class="page">
          ${letterhead}
          ${body}
          ${footer}
        </div>
      </td></tr>
    </tbody>
  </table>

  <div class="runfoot">
    <span>${esc(LETTERHEAD.departmentEn)} · ${esc(LETTERHEAD.division)}</span>
    <span>${esc(reference)}</span>
    <span>${esc(APP_META.name)} · ${esc(formatDateTime(meta.generatedAt))}</span>
  </div>
</body>
</html>`;
}

/* ── Reusable sections ────────────────────────────────────────────────────── */

/** Label/value table — the shape most of a report is made of. */
export function keyValueTable(rows: Array<[string, string | number | null | undefined]>): string {
  return `<table class="kv">${rows
    .map(([key, value]) => `<tr><td>${esc(key)}</td><td>${orDash(value)}</td></tr>`)
    .join('')}</table>`;
}

export interface SharePart {
  label: string;
  value: number;
  color: string;
}

/**
 * Part-to-whole bar plus its legend.
 *
 * The table is not decoration: it is the channel that carries which segment is
 * which. Printed in greyscale — which is how a district office prints — the
 * fills collapse and the table beside them is all the reader has.
 */
export function shareBlock(parts: SharePart[]): string {
  const present = parts.filter((part) => part.value > 0);
  const total = parts.reduce((sum, part) => sum + part.value, 0);

  const bar =
    present.length > 0
      ? `<div class="share">${present
          .map((part) => `<i style="flex:${part.value};background:${part.color}"></i>`)
          .join('')}</div>`
      : `<div class="share"><i style="flex:1;background:#EAEAEA"></i></div>`;

  const rows = parts
    .map(
      (part) => `<tr>
        <td><span class="key" style="background:${part.color}"></span>&nbsp;&nbsp;${esc(part.label)}</td>
        <td class="num">${part.value}</td>
        <td class="num">${total > 0 ? `${Math.round((part.value / total) * 100)}%` : '—'}</td>
      </tr>`,
    )
    .join('');

  return `${bar}
    <table>
      <tr><th>Verdict</th><th class="num">Records</th><th class="num">Share</th></tr>
      ${rows}
      <tr class="total"><td>Total</td><td class="num">${total}</td><td class="num">100%</td></tr>
    </table>`;
}

/** Ranked horizontal bars with the value at the tip. */
export function barListBlock(
  rows: Array<{ label: string; sublabel?: string; value: number }>,
  emptyMessage: string,
): string {
  const max = rows.reduce((peak, row) => Math.max(peak, row.value), 0);
  if (rows.length === 0 || max === 0) return `<p class="faint">${esc(emptyMessage)}</p>`;

  return rows
    .map(
      (row) => `<div style="margin-bottom:9px">
        <div style="display:flex;justify-content:space-between;gap:10px">
          <span>${esc(row.label)}</span><b>${row.value}</b>
        </div>
        ${row.sublabel ? `<div class="faint" style="font-size:8px">${esc(row.sublabel)}</div>` : ''}
        <div class="bar"><i style="width:${Math.max((row.value / max) * 100, 2)}%"></i></div>
      </div>`,
    )
    .join('');
}
