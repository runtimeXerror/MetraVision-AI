# Database

MongoDB via Mongoose. Four collections.

```
users ──< inspections
              ├─ images[]           (embedded)
              ├─ extractedFields[]  (embedded)
              ├─ aiAnalysis         (embedded)
              └─ complianceResult   (embedded)
                    ├─ checks[]
                    └─ violations[]

counters          (atomic reference sequences)
refreshtokens     (issued sessions, hashed)
```

## Why the inspection is one document

Images, fields, analysis and compliance are **embedded**, not referenced. An
inspection is always read as a whole — the detail screen and the report both
need every part — so embedding turns what would be five queries into one. The
document stays small because images are stored as URLs, never as binary; a
25-field inspection with eight images is a few kilobytes against MongoDB's 16 MB
limit.

The parts that are *not* embedded are the ones with a different lifecycle:
refresh tokens expire independently, and counters are written by every create.

---

## `users`

| Field | Type | Notes |
| --- | --- | --- |
| `_id` | ObjectId | |
| `inspectorId` | string | **unique**, uppercase, e.g. `LM-INS-4471` |
| `name` | string | |
| `email` | string | **unique**, lowercased |
| `passwordHash` | string | bcrypt, 10 rounds. `select: false` |
| `role` | enum | `INSPECTOR` · `SUPERVISOR` · `ADMIN` |
| `status` | enum | `ACTIVE` · `SUSPENDED` · `INVITED` |
| `department` | string | |
| `phone`, `zone`, `district`, `state` | string | Optional |
| `avatarColor` | string | Hex, for the monogram |
| `lastLoginAt` | Date | |
| `tokenVersion` | number | Bumped to invalidate every outstanding token |
| `createdAt`, `updatedAt` | Date | |

**`passwordHash` carries `select: false`.** It is absent from every query result
unless a caller writes `.select('+passwordHash')` — which makes leaking it the
exception a reviewer can grep for, rather than the default. `toDTO()` never
includes it.

**`tokenVersion`** is embedded in every access token. Incrementing it on the
user record invalidates all issued tokens at once, without a revocation list —
used on password change and forced sign-out.

### Indexes

| Index | Purpose |
| --- | --- |
| `inspectorId` (unique) | Login by badge number |
| `email` (unique) | Login by email; prevents duplicate accounts |
| `{ role, status }` | Roster filtering |

---

## `inspections`

| Field | Type | Notes |
| --- | --- | --- |
| `_id` | ObjectId | |
| `inspectionId` | string | **unique**, `INS-2026-00001` |
| `inspector` | ObjectId → `users` | |
| `business.name` | string | Required |
| `business.ownerName`, `business.contact` | string | Optional |
| `location.address` | string | Required |
| `location.district`, `location.state` | string | Optional |
| `productCategory` | enum | `packaged_food` · `beverage` · `cosmetic` · `household` · `apparel` · `electronics` · `medical_device` · `other` |
| `productName` | string | |
| `images[]` | subdoc | See below |
| `extractedFields[]` | subdoc | See below |
| `aiAnalysis` | subdoc | Absent until analysed |
| `complianceResult` | subdoc | Absent until analysed |
| `notes` | string | Recorded at intake |
| `finalNotes` | string | Recorded at finalize |
| `status` | enum | `DRAFT` · `PROCESSING` · `REVIEW_REQUIRED` · `COMPLIANT` · `VIOLATION_DETECTED` · `FINALIZED` |
| `lastReviewedAt`, `finalizedAt` | Date | |
| `createdAt`, `updatedAt` | Date | |

`status` folds workflow position and verdict into one enum, as specified.
`complianceResult.status` holds the verdict **independently**, so a `FINALIZED`
record has not lost what it was finalized as.

### `images[]`

| Field | Type | Notes |
| --- | --- | --- |
| `imageId` | string | `img_<hex>` |
| `type` | enum | `FRONT` · `BACK` · `SIDE` · `ADDITIONAL` |
| `storageKey` | string | Provider key; empty for seeded records |
| `url` | string | Resolvable path; empty for seeded records |
| `mimeType`, `sizeBytes` | | |
| `width`, `height` | number | Optional |
| `createdAt` | Date | |

`storageKey` and `url` deliberately allow `''` — seeded demo records carry image
slots with no bytes behind them, and Mongoose treats an empty string as missing,
so these cannot be `required`.

### `extractedFields[]`

| Field | Type | Notes |
| --- | --- | --- |
| `name` | string | Machine key, e.g. `net_quantity` |
| `label` | string | Display name |
| `aiValue` | string \| null | **What the engine read. Never overwritten.** `null` = nothing found |
| `confidence` | number | 0–1 |
| `bbox` | `[x1,y1,x2,y2]` | Pixels, relative to `aiAnalysis.bboxSpace` |
| `sourceImageId` | string | Which image it came from |
| `required` | boolean | Whether the rule set demands it |
| `humanVerifiedValue` | string \| null | The inspector's determination |
| `humanVerifiedBy` | ObjectId → `users` | |
| `humanVerifiedAt` | Date | |
| `reviewAction` | enum | `ACCEPTED` · `EDITED` · `MARKED_UNAVAILABLE` |
| `reviewComment` | string | |

**The separation of `aiValue` and `humanVerifiedValue` is the single most
important decision in this schema.** Overwriting one with the other would
destroy the evidence trail an enforcement record needs, and the labelled data
Phase 3 needs to evaluate a real OCR model. Both are carried into the report.

Note `aiValue: null` is meaningful — it records that the engine examined the
label and found nothing, which is different from a field never examined.

### `aiAnalysis`

| Field | Notes |
| --- | --- |
| `engine` | `MOCK` · `PADDLE_OCR` · `TESSERACT` · `VLM` · `MANUAL` |
| `engineVersion` | e.g. `mock-2.0.0` |
| `categoryValue`, `categoryConfidence` | Inferred category |
| `origin` | `DOMESTIC` · `IMPORTED` |
| `meanConfidence`, `processingMs` | |
| `imageIds[]` | Which images were analysed |
| `analysedAt` | |
| `warnings[]` | Non-blocking advisories |
| `bboxSpaceWidth`, `bboxSpaceHeight` | The frame `bbox` values are in |

`engine` is persisted on every record so historical inspections stay auditable
once the real pipeline goes live — a supervisor can tell which analyses were
produced by the scripted engine.

### `complianceResult`

| Field | Notes |
| --- | --- |
| `status` | `COMPLIANT` · `VIOLATION_DETECTED` · `REVIEW_REQUIRED` |
| `score` | 0–100 |
| `checks[]` | One per required declaration: code, title, ruleReference, result, severity, category, expected, observed, message, relatedFieldNames |
| `violations[]` | Failed checks with a recommendation and evidence box |
| `warnings[]` | |
| `ruleSetId`, `ruleSetLabel` | Which rule set was resolved |
| `evaluatedAt` | |

### `scan`

The OCR -> extraction -> rule-engine record, written by `POST /inspections/scan`
and `POST /inspections/:id/scan`. Stored as `Mixed`.

```js
scan: {
  ocr: {
    provider: 'google-vision',
    providerVersion: 'vision-v1/DOCUMENT_TEXT_DETECTION',
    rawText: '…',            // the full text, so a re-extraction never needs the images
    lineCount: 32,
    characterCount: 640,
    confidenceAvailable: true,
    regions: [ /* located lines, capped at 400 */ ],
    processingMs: 1180,
    imageIds: ['img_…'],
  },
  extraction: {
    engine: 'rule-based-extractor', engineVersion: '1.0.0', processingMs: 15,
    fields: { /* the rule set's own field names */ },
    informational: { /* recorded, never part of a legal check */ },
    contextSignals: [], unclaimedLines: [], warnings: [],
  },
  legal: {
    status: 'VIOLATION_DETECTED',
    inspectionDate: '2026-09-02',   // the date the rules were resolved against
    summary: {}, checks: [], applicableRules: [], warnings: [],
    issues: [], issueSummary: {}, thresholds: {},
    ruleSetVersion: 'LM-PC-2026-05-29',
    ruleSetChecksum: 'a056644e1964e00e',
    engineVersion: 'lm-rule-engine/1.0.0',
    evaluatedAt: Date, durationMs: 130,
  },
  report: { reportId: 'RPT-…', generatedAt: Date, reportVersion: 'lm-scan-report/1.0.0' },
  captureCompleteness: 0.95,
  contextApplied: [], contextOverridden: [],
  timings: {}, scannedAt: Date,
}
```

**Why `Mixed`.** These shapes are owned by the compliance module and the scan
services. Re-declaring a compliance check in Mongoose would give the project two
definitions of one thing, and the older of the two would silently strip whatever
the newer had added — which for an audit record is the one failure mode that
matters. The root schema carries `minimize: false` so a `summary` whose counts
are all legitimately zero survives the write instead of being deleted as an
empty object.

**Why it sits beside `complianceResult` rather than replacing it.**
`complianceResult` is a lossy three-state projection of `scan.legal`, kept for
the screens and aggregations that predate the rule engine. Nothing reads it to
make a decision; where the two disagree, `scan.legal` is right.

**Why `inspectionDate` is stored separately from `evaluatedAt`.** They are
different dates and only one of them is legally meaningful. `evaluatedAt` is
when the software ran; `inspectionDate` is the day whose law the package was
judged against, and a report regenerated a year later has to state that one.

**Why `rawText` is kept whole while `regions` is capped.** A re-extraction needs
the text; the located boxes are for the evidence overlay, and a dense label
across four images can produce several hundred. Capping at 400 keeps the
document well clear of the 16 MB limit without losing what a re-run needs.

**Size.** Images are stored as URLs, never as binary — the same reason the
inspection is one document at all.

### Indexes

| Index | Serves |
| --- | --- |
| `inspectionId` (unique) | Lookup by reference; prevents duplicates |
| `{ inspector: 1, createdAt: -1 }` | **The History screen's default query** — an inspector's own records, newest first — from the index alone |
| `{ status: 1, createdAt: -1 }` | Status filter |
| `{ createdAt: -1 }` | Date filters and the unscoped supervisor list |
| `productCategory` | Category filter |
| `business.name` | Business lookups and future analytics |
| `complianceResult.status` | Verdict aggregation for the dashboard |
| text: `inspectionId`, `business.name`, `productName`, `location.address` | Weighted full-text search |

> The list endpoint currently uses a case-insensitive regex `$or` rather than the
> text index, because an inspector typing half a reference number expects a
> partial match and `$text` only matches whole tokens. The text index is in
> place for the Phase 3 dashboard, where relevance ranking across a much larger
> corpus is the better trade.

---

## `counters`

| Field | Type |
| --- | --- |
| `_id` | string — e.g. `inspection:2026` |
| `value` | number |

Reference numbers are drawn with an atomic `findOneAndUpdate` + `$inc`, not a
`countDocuments()`. Two inspectors creating a record in the same second would
otherwise read the same count and mint the same reference.

---

## `refreshtokens`

| Field | Type | Notes |
| --- | --- | --- |
| `user` | ObjectId → `users` | Indexed |
| `tokenHash` | string | **unique** — SHA-256 of the token |
| `expiresAt` | Date | TTL index, `expireAfterSeconds: 0` |
| `revokedAt` | Date | Set on rotation or logout |
| `userAgent` | string | |

Only a hash is stored, so a stolen database dump yields no usable sessions.
MongoDB reaps expired rows itself via the TTL index rather than leaving them to
accumulate.

---

## `rules`

The rule repository, added for the web dashboard's rule pages.

| Field | Notes |
| --- | --- |
| `ruleId` | Human reference, unique, e.g. `LM-PKG-6-1-C-NET-QUANTITY` |
| `field`, `fieldLabel` | The extracted-field key this rule governs |
| `title`, `requirement` | What the provision demands, in plain language |
| `validationType` | `PRESENCE` · `FORMAT` · `NUMERIC_RANGE` · `ENUM` · `MIN_FONT_SIZE` · `CROSS_FIELD` |
| `parameters` | Free-form, e.g. a format pattern or permitted units |
| `ruleReference`, `source` | The provision and the instrument it is drawn from |
| `severity` | How grave a breach is — the same grading the compliance service applies |
| `version`, `effectiveFrom`, `effectiveTo` | The window this text is in force for |
| `status` | `ACTIVE` · `DRAFT` · `RETIRED` |
| `appliesToCategories` | Empty means every category |
| `history[]` | Append-only list of superseded versions |

```
ruleSchema.index({ status: 1, category: 1 });
ruleSchema.index({ field: 1 });
ruleSchema.index({ effectiveFrom: -1 });
```

### Why history lives on the rule

An amendment does not overwrite. The outgoing text is closed off with an
`effectiveTo` and pushed onto `history`; `version` increments. Editing in place
would leave every past inspection appearing to have been judged against wording
that did not exist at the time — and an enforcement record that cannot show
which text applied to it is not evidence.

History is embedded rather than given its own collection because a rule's
versions are never queried independently of the rule, and a separate table
invites a version row that outlives its parent.

### Why there is no `violations` collection

A violation is a finding on an inspection's compliance result. Giving it a
collection would create two records that can disagree about what was found, and
a finding detached from the inspection that produced it means nothing. The
dashboard's violation pages are an `$unwind` over the embedded findings,
projected into flat rows keyed `<inspection reference>:<finding code>` — stable
and addressable without storing anything new.

### Why there is no `products` collection

This system inspects *packages presented at a premises*. The same commodity
inspected at two shops is two pieces of evidence, not one product record with a
shared state — and a product master would need a catalogue authority the
department does not have here. The products page is an aggregation over
inspection history, grouped on the commodity name and category recorded at
inspection time.

---

## Seed data

`npm run seed` (persistent DB) or automatically on boot when the database is
empty and `AUTO_SEED=true`.

**5 users** — 3 inspectors, 1 supervisor, 1 admin.

| Inspector ID | Name | Role | Password |
| --- | --- | --- | --- |
| `LM-INS-4471` | Ravi Sharma | INSPECTOR | `Inspector@123` |
| `LM-INS-3308` | Ananya Iyer | INSPECTOR | `Inspector@123` |
| `LM-INS-5192` | Imran Qureshi | INSPECTOR | `Inspector@123` |
| `LM-SUP-1204` | Meera Nair | SUPERVISOR | `Supervisor@123` |
| `LM-ADM-0001` | System Administrator | ADMIN | `Admin@1234` |

**22 inspections** spread across the three inspectors, Pune / Bengaluru /
Nagpur, over the last two weeks, covering every verdict and several categories:

| Scenario | Verdict | Severity of findings |
| --- | --- | --- |
| Fully compliant packaged food | `COMPLIANT` | — |
| Missing consumer care + FSSAI licence | `VIOLATION_DETECTED` | Major |
| Unpriced repack — no MRP, no net quantity | `VIOLATION_DETECTED` | **Critical** |
| Imported electronics, no country of origin | `VIOLATION_DETECTED` | Major |
| Worn cosmetic label, low-confidence reads | `REVIEW_REQUIRED` | — |

Records marked `leaveOpen` stay at their verdict status rather than
`FINALIZED`, so the mobile History screen has pending work and the console's
violation register has a genuine open/resolved split rather than a uniformly
closed backlog.

### Why the mix is what it is

The seed exists to make every dashboard view meaningful, so it is deliberately
spread across the dimensions the console filters and charts on: three
inspectors, three districts, five categories, a fortnight of dates, both case
states, and both severity grades. A dataset where every finding is the same
severity and every case is closed produces charts with one bar — technically
correct and analytically useless.

The `unpriced` scenario exists for exactly this reason. It is the canonical
Legal Metrology offence — goods offered for sale with no declared price or
quantity — and it is the only scenario that omits a **critical** declaration.
It is deliberately kept out of the mobile app's demo rotation, so the documented
four-case walkthrough there is unchanged; the seed reaches it by forcing the
scenario directly.

### Label images

Seeded inspections carry **synthetic label images**, written to
`uploads/seed/<imageId>.svg` at seed time and served from `/uploads`.

Each is rendered in the same 800×1000 coordinate space the mock analyser reports
its bounding boxes in, with every declaration drawn at the box the analyser
claims to have read it from. The dashboard's evidence overlay therefore lands on
text that is genuinely there — and a missing declaration is visibly absent,
which is what makes the finding checkable rather than something a supervisor has
to take on trust.

They are watermarked `SIMULATED LABEL · NOT A PHOTOGRAPH`. Uploads from the
mobile app remain restricted to raster formats by an allowlist and a magic-byte
check, so SVG can only ever originate from this seed; `/uploads` is additionally
served with `Content-Security-Policy: default-src 'none'; sandbox` and
`X-Content-Type-Options: nosniff`.

**The rule catalogue** is seeded alongside, projected from
`services/ruleSets.ts` — the same table the compliance service evaluates
against, so the repository and the findings cannot disagree about what is
required or how serious a breach is.

`AUTO_SEED` only ever runs against an **empty** database — it checks for any
existing user first and returns without writing if one is found.
