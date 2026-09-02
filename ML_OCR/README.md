# OCR and information extraction

How a photograph of a package becomes a compliance report, and how to replace
the OCR engine that starts it.

```
IMAGE
  ↓  OCRProvider                     src/services/ocr/
RAW TEXT + LOCATED REGIONS
  ↓  InformationExtractionService    src/services/extraction/
STRUCTURED FIELDS + EVIDENCE
  ↓  ComplianceInputAdapter          src/services/scan/
ComplianceEvaluationRequest
  ↓  the rule engine                 src/compliance/          ← unchanged
ComplianceResult (5 states)
  ↓  issue generation + report       src/services/scan/
MOBILE APP  ·  WEB DASHBOARD
```

Every arrow is a one-way dependency. The rule engine has no idea an image was
involved; the OCR provider has no idea what the Legal Metrology rules say.

---

## The one rule that shapes everything

**"OCR did not find it" is not "the package does not declare it."**

An extraction stage that reports `{ value: null }` has said something about the
photograph, not about the trader. Whether an absent declaration is a violation
depends on how much of the package was actually photographed, and that decision
belongs to the rule engine — see `DecisionEngine.absenceStrength`.

In practice:

| Photographs | Capture score | A missing MRP becomes |
| --- | --- | --- |
| 1 | 0.45 | `REVIEW_REQUIRED` |
| 2 | 0.70 | `VIOLATION_DETECTED` |
| 4+ | 0.95 | `VIOLATION_DETECTED` |

The ladder is `CAPTURE_COMPLETENESS_BY_IMAGE_COUNT`. It is an evidentiary
policy, not law, which is why it is configuration. The engine will not record an
absence as a violation below `minimumCaptureCompleteness` (0.7), so a single
photograph of the front face never can.

The same principle governs confidence. Where the OCR provider reports none, the
field carries none — no default is substituted — and the engine treats a value
of unknown reliability as a question for a person rather than as a finding.

---

## Setup

### 1. Choose a provider

```bash
OCR_PROVIDER=paddle   # PaddleOCR in the local ocr-service/ sidecar. The default.
OCR_PROVIDER=google   # Google Cloud Vision DOCUMENT_TEXT_DETECTION.
OCR_PROVIDER=mock     # deterministic fixtures. No dependencies, no network.
```

`paddle` is the default. It needs the sidecar running, which `npm run dev` at
the repository root handles — it starts the sidecar and the API together and
waits for the model before accepting requests:

```bash
npm run setup:ocr   # once per machine
npm run dev         # sidecar + API
```

[`ocr-service/README.md`](../ocr-service/README.md) covers running it alone.

`mock` is what CI runs on. Everything below the OCR seam — extraction, the rule
engine, issue generation, the report — is fully exercised without a model, a
credential or a network.

### 2. The sidecar, for `paddle`

```bash
OCR_SERVICE_URL=http://localhost:8001
```

No credential — that is most of the point. Keep it on localhost: the service
holds inspection photographs in memory and has no authentication of its own.

`GET /api/inspections/scan/status` reports `ocrServiceReachable`, and names the
command to start the sidecar when it is not.

### 3. Credentials, for `google`

Supply **one** of the two:

```bash
# A Vision-enabled API key. Simplest; wins if both are set.
OCR_API_KEY=AIza...

# Or a service-account JSON file. The provider signs a JWT and exchanges it
# for an access token itself; no google-auth-library needed.
GOOGLE_APPLICATION_CREDENTIALS=/absolute/path/to/service-account.json
```

Enable the Cloud Vision API on the project first
(`gcloud services enable vision.googleapis.com`).

**Neither value is ever sent to the mobile or web client.** Every OCR call is
made from the backend process, which is the whole reason the provider lives
there. `*service-account*.json` and `.env` are gitignored; if a credential is
missing the API answers `OCR_NOT_CONFIGURED` with a setup message rather than
failing as though the service were down.

### 4. Everything else

```bash
OCR_TIMEOUT_MS=20000
OCR_LANGUAGE_HINTS=en,hi        # Indian packages are routinely bilingual
OCR_MOCK_FIXTURE=              # pin the mock to one fixture; empty rotates
MOCK_OCR_DELAY_MS=600          # visible processing time for a demo; 0 in tests
CAPTURE_COMPLETENESS_BY_IMAGE_COUNT=0.45,0.7,0.85,0.95
```

Full list with commentary: `backend/.env.example`. Options belonging to the
model itself — language, second script, which weights — live in
[`ocr-service/README.md`](../ocr-service/README.md), because the backend does
not know they exist.

---

## Why PaddleOCR

Written down so a later phase can re-open the decision rather than inherit it.

- **No per-scan cost and no quota.** A field pilot photographing a few thousand
  packages costs nothing, and a demo cannot be rate-limited into silence at the
  wrong moment.
- **The photographs stay on the machine.** An inspection image is evidence
  about a named trader. Not sending it to a third party is worth having on its
  own, and it is what makes an air-gapped deployment possible at all.
- **It works offline.** An inspector in a market with no signal can still
  complete a scan — the difference between a tool used in the field and one
  used at a desk afterwards.
- **Boxes and confidences on every line.** Both are load-bearing: the rule
  engine's decision policy consumes confidence, and the evidence panel consumes
  the boxes. A provider returning only a string would force us to invent the
  first and do without the second.
- **~2s for a 2 MP label on a CPU**, with no GPU required.

What it costs is a second process that has to be running, and about a gigabyte
of RAM held for the weights. On very curved or foil packaging a large
vision-language model still reads more of the label. That is the trade: slightly
lower recall on hard surfaces, in exchange for geometry, confidence, zero
marginal cost and no third party.

### Google Cloud Vision, still available

`OCR_PROVIDER=google` is kept as the cloud comparison and as a fallback where
the sidecar cannot be deployed. It also returns per-word confidence and bounding
polygons, and reads Devanagari, Tamil, Telugu and Bengali in one pass without a
second engine. It costs per scan and sends label photographs to a third party,
which is why it is no longer the default.

Because the provider is a parameter, the two can be compared on the same
photographs — see *Benchmarking two engines* below.

---

## Replacing the OCR engine

The point of the whole arrangement — and no longer hypothetical. Adding
PaddleOCR was exactly this, and it touched three files:

**1. Write a provider.** One file in `backend/src/services/ocr/`:

```ts
export class PaddleOCRProvider implements OCRProvider {
  readonly name = 'paddleocr';
  get version(): string { /* learned from the sidecar's /health */ }

  isConfigured(): boolean { return true; }        // no credential to forget
  configurationHint(): string | null { return null; }

  async extractText(image: OCRImageInput): Promise<OCRResult> {
    // POST the bytes to the sidecar, map its response onto OCRResult.
  }
}
```

**2. Register it.** One `case` in `backend/src/services/ocr/index.ts`, one value
in the `OCR_PROVIDER` enum in `config/env.ts`.

**3. Set `OCR_PROVIDER=paddle`.**

That was the entire change. No controller, model, screen, adapter or test outside
`services/ocr/` is touched, because nothing outside it imports a provider —
they all depend on the `OCRProvider` interface.

### What a provider owes the rest of the system

- `rawText` — the full text, with the provider's own line breaks.
- `regions` — located lines. `text` verbatim, `boundingBox` as
  `[x1, y1, x2, y2]` in `imageSize` pixels.
- `confidence` — **only when the model actually produces one.** Leave it
  `undefined` otherwise. A fabricated confidence flows into the rule engine's
  decision policy and turns a guess into a finding against a trader.
- `provider` and `providerVersion` — recorded on every inspection, so a verdict
  from last March can be told apart from the same package scanned today.
- Failures as thrown `ApiError`s with an `OCR_*` code — **never** an empty
  result. An empty read is indistinguishable to the engine from a blank package.

Line-level regions, rather than words or paragraphs, are what the extractor
expects: a label declaration *is* a line ("MRP ₹120 (incl. of all taxes)"), and
that is also the unit an inspector taps to see evidence.

### Benchmarking two engines against the same packages

Because the provider is a parameter, a scan can be re-run over the photographs
already on record:

```
POST /api/inspections/:id/scan
```

Change `OCR_PROVIDER`, re-scan, and compare. Every evaluation is kept — the
audit trail supersedes rather than overwrites — so two verdicts on one
inspection are directly comparable, each carrying the OCR provider and the
rule-set checksum it was produced under.

---

## The extraction layer

`backend/src/services/extraction/` — deterministic and inspectable throughout.
No model, no scoring network, nothing that answers differently on Tuesday. An
extraction that cannot be explained cannot support a finding.

| File | What it does |
| --- | --- |
| `normalise.ts` | NFKC folding, rupee spellings, unit canonicalisation, digit repair |
| `patterns.ts` | One table: label forms, unlabelled forms, value extractors |
| `InformationExtractionService.ts` | Claims lines for fields, attaches evidence |

**Fields fed to the rule engine** (the rule set's own names): `mrp`,
`unit_sale_price`, `net_quantity`, `manufacturing_date`, `best_before`,
`manufacturer`, `consumer_care`, `country_of_origin`, `dimensions`,
`commodity_name`, `veg_nonveg_mark`, `gm_declaration`.

**Recorded but never part of a legal check:** `brand`, `product_name`,
`importer`, `packer`, `expiry_date`, `fssai_licence`, `batch_number`,
`ingredients`.

Three things the extractor deliberately does not do:

1. **It knows no law.** It can tell you a line beginning "MRP" carries a price;
   it cannot tell you whether a price was required.
2. **It never asserts absence.** A field it did not find is `NOT_FOUND`, and
   `absenceConfidence` is omitted rather than guessed, so the engine falls back
   to its own capture-completeness policy.
3. **It never invents a confidence.** See above.

### Two details worth knowing

**Whole lines for wording-sensitive rules.** `mrp` is extracted as
`"MRP ₹315.00 (incl. of all taxes)"`, not `"315.00"`, because rule 6(1)(e)
between 2018 and 2024 required the declaration to *say* it is the maximum retail
price. Handing the engine a bare amount would throw away the text the rule is
about.

**Digit repair is never silent.** `repairDigits` fixes OCR confusions inside
numeric runs — `5O g` → `50 g`, `₹l99.00` → `₹199.00` — and reports that it did.
Every repaired value is published at a *lower* confidence than the provider
gave. Lowering confidence can only move a check toward review; it can never
manufacture a violation. The substitution never touches free text, because
applied to an address it turns "Oil" into "0i1".

---

## API

| Endpoint | Purpose |
| --- | --- |
| `POST /api/inspections/scan` | One call: multipart images in, full report out |
| `POST /api/inspections/:id/scan` | Same pipeline over images already on record |
| `GET  /api/inspections/:id/report` | JSON report; `?format=html` for print/PDF |
| `GET  /api/inspections/scan/status` | Which provider is configured, and whether |
| `GET  /api/health` | Includes the OCR and extraction versions in use |

Request and response shapes, error codes and worked examples:
[`docs/api.md`](../docs/api.md).

---

## Testing

```bash
cd backend
npm test                                   # everything, on the mock provider
npx vitest run tests/ocr.extraction.test.ts   # OCR adapter + field extraction
npx vitest run tests/scan.pipeline.test.ts    # adapter → engine → issues → report
npx vitest run tests/scan.api.test.ts         # the endpoint, end to end
```

The mock provider carries five fixtures, written as OCR output rather than as
clean data — label order preserved, and the character confusions a real engine
makes on a smudged package:

| Fixture | What it exercises |
| --- | --- |
| `compliant` | A fully declared domestic food label |
| `missing_declarations` | No price, no consumer care |
| `imported_no_origin` | Imported goods with no country of origin |
| `low_confidence` | Everything present, several reads too weak to act on |
| `blank` | A photograph in which nothing was readable |

Pin one from a request with the `mockFixture` field, or globally with
`OCR_MOCK_FIXTURE`. Pinning is rejected outright when a real provider is
configured — a scan that says it read a package must have read that package.

---

## What this phase does not do

No model training, fine-tuning, benchmarking or checkpoints. That is the
separate ML research phase; the architecture above exists so it can be dropped
in without touching anything else.

Nor does the system take physical measurements. Rules 7(2) and 7(3) — character
height and width — need a measurement no part of this version produces from an
image. Those checks report `MEASUREMENT_NOT_AVAILABLE`, are counted separately
as `pendingCapability`, and are deliberately kept out of the headline verdict:
every package would carry the same count, so letting them decide would make the
verdict a constant.

## What the reports may not claim

A clean scan reads **"NO COMPLIANCE ISSUES DETECTED IN THE CHECKS PERFORMED"**,
never "compliant" and never "100%". The system checks a photograph against the
subset of the Packaged Commodities Rules it implements; it cannot weigh the
package, measure letter heights, see faces nobody photographed, or read a rule
that is not in its corpus. Every report carries its limitations and this
disclaimer:

> The system provides automated compliance screening based on the information
> detected from the submitted package image and the rules implemented in the
> system. Results should be reviewed by an authorized inspector where evidence
> is incomplete or uncertain.
