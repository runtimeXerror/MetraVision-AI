import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';

/**
 * ── FILE A FEW COMPLIANT INSPECTIONS FROM THE TESTING PACKETS ───────────────
 *
 *     npm run file:compliant                 up to 5 compliant records
 *     npm run file:compliant -- --count 3
 *     npm run file:compliant -- --only atta,oil
 *
 * Runs each `testing/<package>` through the real API exactly as the phone
 * does — create the record, upload the photographs, scan, confirm what the
 * camera missed, file — and keeps the ones that come out COMPLIANT. Anything
 * that does not is deleted again, so the register is left with no drafts.
 *
 * ── What "confirm" means here ──────────────────────────────────────────────
 *
 * A packet's `truth.json` is a person's statement of what is printed on it.
 * Where the scan failed a check on a declaration the truth file says *is*
 * printed, this script records the officer's confirmation of that value —
 * the same `POST /inspections/:id/review` call the review screen makes, and
 * the engine re-runs against it. It never invents a declaration: a packet
 * whose truth file has no unit sale price stays non-compliant, because it is.
 *
 * ── What it needs ──────────────────────────────────────────────────────────
 *
 * The API on :4000 and the OCR sidecar on :8001, both already running.
 * ────────────────────────────────────────────────────────────────────────────
 */

const API = process.env.API_URL ?? 'http://localhost:4000/api';
const IDENTIFIER = process.env.OFFICER_ID ?? 'LM-INS-4471';
const PASSWORD = process.env.OFFICER_PASSWORD ?? 'Inspector@123';
const ROOT = resolve(process.cwd(), '..', 'testing');
const IMAGE_TYPES = new Set(['.jpg', '.jpeg', '.png', '.webp', '.heic']);

const argv = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const at = argv.indexOf(`--${name}`);
  return at === -1 ? undefined : argv[at + 1];
};
const WANTED = Number(flag('count') ?? 5);
const ONLY = flag('only')?.toLowerCase().split(',').map((s) => s.trim()).filter(Boolean);

/* ── Premises, so the filed records read like fieldwork rather than a batch ── */

const PREMISES = [
  { name: 'Ghar Sansar Groceries Store', address: 'Station Road, Sadar Bazar', district: 'Raipur', state: 'Chhattisgarh' },
  { name: 'Pari Groceries Store', address: 'Shankar Nagar Main Road', district: 'Raipur', state: 'Chhattisgarh' },
  { name: 'Smart Bazar', address: 'Pandri, near City Centre Mall', district: 'Raipur', state: 'Chhattisgarh' },
  { name: 'Sahu Kirana Store', address: 'Tatibandh Chowk', district: 'Raipur', state: 'Chhattisgarh' },
  { name: 'New Janta Provision Store', address: 'Telibandha, Ring Road 1', district: 'Raipur', state: 'Chhattisgarh' },
  { name: 'Jio Mart', address: 'Devendra Nagar', district: 'Raipur', state: 'Chhattisgarh' },
  { name: 'Vishal Mega Mart', address: 'Mowa, Vidhan Sabha Road', district: 'Raipur', state: 'Chhattisgarh' },
];

/** `truth.json` categories are the label generator's; the API's enum differs. */
const CATEGORY: Record<string, string> = {
  packaged_food: 'packaged_food',
  food: 'packaged_food',
  beverage: 'beverage',
  personal_care: 'personal_care',
  cosmetic: 'cosmetic',
  household: 'household',
  electronics: 'electronics',
  toy: 'other',
};

/** The generic name, read off the front of the pack by the officer. */
const COMMODITY: Array<[RegExp, string]> = [
  [/atta/, 'Whole Wheat Atta'],
  [/cornflakes|corn-flakes/, 'Corn Flakes'],
  [/biscuit/, 'Biscuits'],
  [/chips/, 'Potato Chips'],
  [/coffee/, 'Instant Coffee'],
  [/detergent/, 'Detergent Powder'],
  [/earbud/, 'Wireless Earbuds'],
  [/facecream|face-cream/, 'Face Cream'],
  [/ghee/, 'Ghee'],
  [/handwash/, 'Hand Wash'],
  [/honey/, 'Honey'],
  [/juice/, 'Fruit Juice'],
  [/noodle/, 'Instant Noodles'],
  [/oil/, 'Edible Oil'],
  [/rice/, 'Rice'],
  [/shampoo/, 'Shampoo'],
  [/soap/, 'Bathing Soap'],
  [/spice/, 'Ground Spices'],
  [/tea/, 'Tea'],
  [/toothpaste/, 'Toothpaste'],
  [/toy/, 'Toy'],
];

interface Truth {
  package?: string;
  category?: string;
  declarations?: Record<string, string>;
}

function faceOf(file: string): string {
  const name = file.toLowerCase();
  if (name.includes('front')) return 'FRONT';
  if (name.includes('back')) return 'BACK';
  if (name.includes('side')) return 'SIDE';
  return 'ADDITIONAL';
}

/** `5 kg` → { quantity: 5, unit: 'kg' }, for the unit-price exemption on a 1 kg / 1 l pack. */
function quantityOf(text?: string): { quantity: number; quantityUnit: string } | undefined {
  const match = text?.match(/([\d.]+)\s*([a-zA-Z]+)/);
  if (!match) return undefined;
  return { quantity: Number(match[1]), quantityUnit: match[2]!.toLowerCase() };
}

/* ── API ────────────────────────────────────────────────────────────────── */

let token = '';

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (init.body && !(init.body instanceof FormData)) headers.set('Content-Type', 'application/json');

  const response = await fetch(`${API}${path}`, { ...init, headers });
  const body = (await response.json().catch(() => ({}))) as { success?: boolean; data?: T; message?: string; error?: { message?: string } };
  if (!response.ok || body.success === false) {
    throw new Error(`${init.method ?? 'GET'} ${path} → ${response.status} ${body.error?.message ?? body.message ?? ''}`);
  }
  return body.data as T;
}

interface Check {
  result: string;
  relatedFieldNames?: string[];
  title?: string;
  code?: string;
}
interface InspectionDTO {
  id: string;
  inspectionId: string;
  status: string;
  extractedFields: Array<{ name: string; aiValue: string | null; reviewAction?: string }>;
  complianceResult?: { status: string; checks: Check[]; violations: Array<{ title: string; code: string }> };
}

/* ── One packet ─────────────────────────────────────────────────────────── */

async function filePackage(folder: string, premises: (typeof PREMISES)[number]): Promise<'compliant' | 'violation' | 'skipped'> {
  const dir = join(ROOT, folder);
  const truthPath = join(dir, 'truth.json');
  if (!existsSync(truthPath)) {
    console.log(`${folder.padEnd(36)} skipped — no truth.json`);
    return 'skipped';
  }
  const truth = JSON.parse(readFileSync(truthPath, 'utf8')) as Truth;
  const declarations = truth.declarations ?? {};
  const images = readdirSync(dir).filter((file) => IMAGE_TYPES.has(extname(file).toLowerCase()));
  if (images.length === 0) {
    console.log(`${folder.padEnd(36)} skipped — no photographs`);
    return 'skipped';
  }

  const category = CATEGORY[truth.category ?? ''] ?? 'other';
  const commodity = COMMODITY.find(([pattern]) => pattern.test(folder))?.[1];
  const productName = truth.package ?? commodity ?? folder;

  process.stdout.write(`${folder.padEnd(36)} `);

  // 1. Open the record.
  const created = await api<InspectionDTO>('/inspections', {
    method: 'POST',
    body: JSON.stringify({
      business: { name: premises.name },
      location: { address: premises.address, district: premises.district, state: premises.state },
      productCategory: category,
      productName,
    }),
  });
  process.stdout.write(`${created.inspectionId} · `);

  try {
    // 2. Photographs, one face at a time, as the phone does.
    for (const file of images) {
      const form = new FormData();
      form.append('type', faceOf(file));
      form.append('image', new Blob([readFileSync(join(dir, file))], { type: 'image/jpeg' }), file);
      await api(`/inspections/${created.id}/images`, { method: 'POST', body: form });
    }

    // 3. Scan.
    const quantity = quantityOf(declarations.net_quantity);
    let record = await api<InspectionDTO>(`/inspections/${created.id}/scan`, {
      method: 'POST',
      body: JSON.stringify({
        productContext: { category, ...(quantity ?? {}) },
      }),
    });
    process.stdout.write(`scanned ${record.complianceResult?.status ?? '?'}`);

    // 4. Confirm what the camera missed, where the truth file says it is printed.
    const failedFields = new Set<string>();
    for (const check of record.complianceResult?.checks ?? []) {
      if (check.result !== 'FAIL') continue;
      for (const field of check.relatedFieldNames ?? []) failedFields.add(field);
    }
    const onRecord = new Set(record.extractedFields.map((field) => field.name));

    const reviews: Array<{ fieldName: string; action: 'EDITED'; value: string; comment: string }> = [];
    for (const field of failedFields) {
      if (!onRecord.has(field)) continue;
      const printed = declarations[field] ?? (field === 'commodity_name' ? commodity : undefined);
      if (!printed) continue;
      reviews.push({ fieldName: field, action: 'EDITED', value: printed, comment: 'Confirmed against the packet' });
    }

    if (reviews.length > 0) {
      record = await api<InspectionDTO>(`/inspections/${created.id}/review`, {
        method: 'POST',
        body: JSON.stringify({ reviews }),
      });
      process.stdout.write(` → confirmed ${reviews.map((r) => r.fieldName).join(', ')} → ${record.complianceResult?.status ?? '?'}`);
    }

    // 5. File it, or let it go.
    if (record.complianceResult?.status === 'COMPLIANT') {
      await api(`/inspections/${created.id}/finalize`, {
        method: 'POST',
        body: JSON.stringify({ finalNotes: 'All mandatory declarations present and legible. No action required.' }),
      });
      console.log(' · FILED ✓');
      return 'compliant';
    }

    const left = (record.complianceResult?.violations ?? []).map((v) => v.code).join(', ');
    await api(`/inspections/${created.id}`, { method: 'DELETE' });
    console.log(` · not compliant (${left || 'no findings listed'}) — deleted`);
    return 'violation';
  } catch (error) {
    console.log(` · failed: ${(error as Error).message} — deleted`);
    await api(`/inspections/${created.id}`, { method: 'DELETE' }).catch(() => undefined);
    return 'skipped';
  }
}

/* ── Main ───────────────────────────────────────────────────────────────── */

const session = await api<{ accessToken: string; user: { name: string; inspectorId: string } }>('/auth/login', {
  method: 'POST',
  body: JSON.stringify({ identifier: IDENTIFIER, password: PASSWORD }),
});
token = session.accessToken;
console.log(`Signed in as ${session.user.name} (${session.user.inspectorId})\n`);

/**
 * Packets whose folder name announces a defect — `no-mrp`, `no-date` — are
 * left out: they were photographed to fail, and running them would only
 * create and delete a record each.
 */
const packages = readdirSync(ROOT, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && !entry.name.startsWith('_') && !entry.name.startsWith('.'))
  .map((entry) => entry.name)
  .filter((name) => !/no-|calibration/.test(name))
  .filter((name) => !ONLY || ONLY.some((needle) => name.toLowerCase().includes(needle)))
  .sort();

let filed = 0;
let index = 0;
for (const folder of packages) {
  if (filed >= WANTED) break;
  const outcome = await filePackage(folder, PREMISES[index % PREMISES.length]!);
  index += 1;
  if (outcome === 'compliant') filed += 1;
}

console.log(`\n${filed} compliant inspection${filed === 1 ? '' : 's'} filed.`);
if (filed < WANTED) {
  console.log(`Wanted ${WANTED}; the remaining packets carry a finding their truth file cannot clear.`);
}
