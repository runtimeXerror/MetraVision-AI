# Backend Architecture

## Where this sits

```
┌─────────────────────┐   ┌─────────────────────┐
│  React Native app   │   │   React web console │
│  Phase 1 — field    │   │   Phase 3 — office  │
└──────────┬──────────┘   └──────────┬──────────┘
           │      REST / JSON  ·  Bearer JWT
           └─────────────┬────────────┘
┌────────────────────────▼────────────┐
│         Express + TS API            │  ← this document
└────────────────────────┬────────────┘
                         │  Mongoose
┌────────────────────────▼────────────┐
│              MongoDB                │
└─────────────────────────────────────┘

                         ┆  Phase 4
┌────────────────────────▼────────────┐
│         Python / FastAPI            │
│          OCR · CV · VLM             │
└─────────────────────────────────────┘
```

Two clients, one API. Neither holds its own copy of the data, and neither
decides what a role may see — the API scopes every list and every aggregation
from the caller's token, so a filter the web console cannot express is a filter
that does not exist.

The dotted edge is already wired. `ANALYSIS_PROVIDER=http` switches the backend
from the scripted analyser to an HTTP call, and nothing else changes.

---

## Layering

```
routes/        URL → middleware chain → controller.        No logic.
middleware/    auth · validation · uploads · errors · rate limiting
controllers/   read the request, call services, shape the response
services/      the business layer — the only place rules live
models/        Mongoose schemas + toDTO()
```

The rule the layering enforces: **a controller never contains a business rule,
and a service never touches `req` or `res`.** That is what makes
`complianceService` unit-testable on its own and replaceable wholesale in the
AI phase.

`services/analyticsService.ts` follows the same rule for the dashboard's read
models. Every figure the console renders is aggregated in MongoDB there, over
the same collection the mobile app writes to. The alternative — shipping
inspections to the browser and counting them — would put a second, silently
diverging definition of "compliance rate" in the client, and would not survive
the first thousand records.

`app.ts` builds the Express application and deliberately contains **no
`listen()` and no database connection**. `index.ts` does the boot sequence:
connect → seed if empty → listen. The split is what lets the test suite mount
the real application against an in-memory MongoDB without binding a port, so the
tests exercise the actual middleware chain rather than a stub.

---

## The AI seam

`services/analysisService.ts` is the only file that knows how an analysis is
produced.

```ts
interface AnalysisProvider {
  readonly name: string;
  analyse(input: AnalysisInput): Promise<AnalysisOutput>;
}

class MockAnalysisProvider implements AnalysisProvider { … }  // Phase 2
class HttpAnalysisProvider implements AnalysisProvider { … }  // wired, unused today
```

Controllers call `analyseInspection()` and receive fields plus an engine record.
They cannot tell which provider ran, and neither can the mobile app.

**What the mock does and does not do.** It selects one of four scripted
scenarios, resolves the applicable rule set for the category, and emits fields
with plausible confidences and bounding boxes. It performs **no OCR, no computer
vision and no inference of any kind**. A rotating cursor means successive
analyses show different verdicts, so a demo exercises every path; three or more
images always routes to the multi-image scenario.

**Why the seam is worth the indirection.** The alternative — calling the AI
service directly from the controller — would mean the retry policy, the timeout,
the error taxonomy and the response shape all leak into request handling, and
swapping engines would touch every call site. Here it is one branch.

`engine` and `engineVersion` are persisted on every record. When the real
pipeline starts writing `PADDLE_OCR`, historical inspections remain
distinguishable as scripted output — an auditor can tell which findings were
machine-read and which were not.

---

## The scan pipeline

The path a photograph actually takes, and the newer of the two analysis routes.
`analysisService.ts` above still serves the scripted `POST /:id/analyze`; the
scan endpoints run this instead.

```
image bytes
    |  OCRProvider                 services/ocr/          no idea what the law says
raw text + located regions
    |  InformationExtractionService services/extraction/  no idea what the law says
structured fields + evidence
    |  ComplianceInputAdapter      services/scan/         translates, decides nothing
ComplianceEvaluationRequest
    |  the rule engine             compliance/            the only thing that decides
ComplianceResult
    |  issues + report             services/scan/
API response
```

Each arrow is a one-way dependency. `scanService.runScan` orchestrates and
judges nothing; the rule engine is imported, not reimplemented, and its result
is passed on unchanged.

### The OCR seam

```ts
interface OCRProvider {
  readonly name: string;
  readonly version: string;
  extractText(image: OCRImageInput): Promise<OCRResult>;
  isConfigured(): boolean;
  configurationHint(): string | null;
}
```

Nothing downstream imports a provider — extraction, the adapter, the engine and
both clients depend on `OCRResult` alone. Adding the benchmarked local model is
one class in `services/ocr/` and one `case` in its `index.ts`.

This is the seam most likely to move. The MVP provider is Google Cloud Vision
(`DOCUMENT_TEXT_DETECTION`), chosen for printed packaging text, Indic script
support, per-word confidence and bounding polygons, and a plain REST call with
no SDK. It is also a network dependency with a per-unit price that sends label
photographs to a third party, which is exactly why it sits behind an interface.
The reasoning is written out in [`ML_OCR/README.md`](../ML_OCR/README.md).

### Three things the pipeline refuses to do

**It never evaluates a failed read.** If OCR throws, or returns nothing legible,
the pipeline stops and the API answers `SCAN_FAILED`. An empty field set is
indistinguishable to the engine from a package with no declarations on it, and
the difference between "the OCR service timed out" and "this trader sold
unlabelled goods" is the difference between a bug and a false accusation.

**It never invents a confidence.** Where the provider reports none, the field
carries none. The engine reads a missing confidence as unknown reliability and
routes a failed check to review, which is the honest answer; a substituted 0.9
would become a violation three layers down.

**It never asserts absence.** A field the extractor did not find is `NOT_FOUND`
with `absenceConfidence` omitted rather than guessed, so the engine falls back
to its own policy — how completely the package was photographed. One photograph
of the front face scores 0.45, below the engine's 0.7 floor, so a missing MRP on
a single-image scan is a review and not a finding. Four faces score 0.95 and the
same absence becomes a violation. The ladder is
`CAPTURE_COMPLETENESS_BY_IMAGE_COUNT`: an evidentiary policy, not law, which is
why it is configuration.

### Extraction

Deterministic and inspectable throughout — regex, label matching, unit
canonicalisation, and a digit repair that reports itself. No model and no LLM,
because an extraction that cannot be explained cannot support a finding.

It knows no law. It can tell you a line beginning "MRP" carries a price; it
cannot tell you whether a price was required. Putting that question here would
give the project two rulebooks.

Values for wording-sensitive rules are kept whole: `mrp` is
`"MRP ₹315.00 (incl. of all taxes)"`, not `"315.00"`, because rule 6(1)(e)
between 2018 and 2024 required the declaration to *say* it is the maximum retail
price.

### Two writes, one source of truth

A scan writes the engine's result whole under `inspection.scan`, and a lossy
projection of it into `extractedFields`, `aiAnalysis` and `complianceResult` —
the shapes the History screen, the dashboard tiles, the violations register and
the analytics aggregations were already built against. Nothing reads the
projection to make a decision, and where the two disagree the scan record is
right. See `services/scan/legacyProjection.ts` for why that trade was made.

---

## The compliance engine

`services/complianceService.ts` turns extracted declarations into a verdict. It
takes fields in and returns a result: no database access, no request context,
no UI knowledge.

**Three verdicts, never pass/fail.**

| Condition | Verdict |
| --- | --- |
| Any mandatory declaration missing | `VIOLATION_DETECTED` |
| Otherwise, any field read below 0.75 confidence | `REVIEW_REQUIRED` |
| Otherwise | `COMPLIANT` |

A violation outranks uncertainty — a missing declaration is a finding regardless
of how confident the other reads were. `REVIEW_REQUIRED` is what the system
reports when it is not confident enough to assert either of the others; a
compliance tool that can only say yes or no forces the model to guess exactly
where it should be escalating to a human.

**Confirmed values are certain.** Once an inspector has decided a field, its
original confidence stops mattering — the human is the authority, so
`effectiveValue()` prefers `humanVerifiedValue` and a reviewed field never
counts as uncertain.

**Which declarations are required is data, not code.** `services/ruleSets.ts`
maps each product category to a rule set. The mobile app renders whatever it is
told is required and carries no copy of the law, and neither does the web
console — the rule pages there read the `rules` collection over the API.

That collection is **seeded from this same table**, so the catalogue a
supervisor reads and the requirements the evaluator applies cannot drift apart.
Evaluation still runs off `ruleSets.ts`; moving it onto the database records is
the real rule-engine work and belongs with the AI phase. `ComplianceResult`
already carries `ruleSetId` and `ruleSetLabel` for that handover.

Both write paths — analyse and review — run the record through the same
evaluator, so the verdict is computed in exactly one place and the two clients
cannot disagree.

---

## Authentication

Two token types, for two different jobs.

**Access token** — 2 hours, stateless, carries `sub`, `email`, `name`, `role`,
`inspectorId` and `ver`. Authorisation reads these claims directly, so it costs
no database round-trip.

**Refresh token** — 30 days, and **persisted as a SHA-256 hash**. A stateless
refresh token cannot be revoked, which makes logout a lie. Storing a hash means
a database dump yields no usable sessions. Rows carry a TTL index so MongoDB
reaps expired tokens itself.

**Rotation.** Every refresh revokes the token it consumed and issues a new pair.
A leaked refresh token is therefore usable at most once, and its reuse is
detectable — the second attempt hits a revoked row and returns
`REFRESH_REVOKED`.

**`tokenVersion`** on the user record is embedded in every access token. Bumping
it invalidates every outstanding token at once without a revocation list; used
on password change and forced sign-out.

**Account enumeration is closed.** An unknown account and a wrong password
return an identical status, message and error code.

**Privilege escalation is closed.** `POST /auth/register` always creates an
`INSPECTOR`; a request body asking for `ADMIN` is rejected with 403. Elevating a
role is an administrative act, not something a public endpoint grants.

---

## Authorisation

One rule, enforced in one place:

> An inspector reaches only their own records. A supervisor or admin reaches the
> whole jurisdiction.

`loadInspection()` in `controllers/inspection.controller.ts` performs the check
for **every** single-record route — get, patch, delete, images, analyze, review,
finalize, report. Enforcing it in the shared loader rather than per handler is
what stops a newly added endpoint from quietly omitting it.

The list endpoint applies the same scope as its first filter, before any
user-supplied query, so no combination of parameters can widen it.

**A hidden record returns 404, not 403.** A 403 confirms the record exists,
which tells an inspector that a colleague filed an inspection at that reference.

---

## Image handling

Files are held in memory by multer and handed to the storage provider as a
buffer, rather than written to disk by multer directly — the provider may be S3
in a later phase, and it needs bytes, not a path on this machine.

**Validation is two-stage.** The declared MIME type is checked against an
allow-list, and then the file's magic bytes are checked against the declared
type. A client can claim any MIME type it likes; a text file renamed `.png` is
rejected with `INVALID_IMAGE` before anything reaches storage.

Filenames are generated, never taken from the client — an inspector-supplied
name is untrusted input, and a predictable one invites enumeration. The local
provider also refuses to delete outside the upload root, so a malformed stored
key cannot escape via `../`.

**The storage seam.** Controllers depend on `StorageProvider`, never on a
concrete implementation:

```ts
interface StorageProvider {
  put(input: PutObjectInput): Promise<StoredObject>;
  delete(key: string): Promise<void>;
  urlFor(key: string): string;
}
```

Adding S3, Cloudinary or GCS is one class and one `case` in the factory.

Deleting an image tolerates a storage failure: the authoritative record is the
inspection document, and an orphaned file is housekeeping, not correctness.

---

## Error handling

One `ApiError` type carrying an HTTP status, a stable `errorCode`, and a message
written to be shown to an inspector verbatim.

`middleware/error.ts` is the single place an error becomes a response. It
normalises Zod issues, Mongoose validation and cast errors, duplicate-key
violations, and multer limits into the standard envelope. Anything unrecognised
is logged with its stack and returned as a generic 500 — **internal detail never
leaves the process, and stack traces are never sent to a client.**

`details` is forwarded only on 4xx, where it is validation feedback the client
needs, never on 5xx where it would be internal state.

Because Express 4 does not await handlers, every async route is wrapped in
`asyncHandler` — without it a rejected promise becomes an unhandled rejection
and the request hangs until it times out.

---

## Security summary

| Concern | Measure |
| --- | --- |
| Passwords | bcrypt, 10 rounds; `select: false`; never serialised |
| Sessions | Short access tokens; hashed, rotating, revocable refresh tokens |
| Transport headers | Helmet, with `crossOriginResourcePolicy` relaxed for images |
| CORS | Explicit origin list in production |
| Rate limiting | 300/15 min general; 20/15 min on credential endpoints |
| Input | Zod on every body, query and param |
| Uploads | Type allow-list, magic bytes, size cap, generated filenames, path-escape guard |
| Authorisation | Single shared loader; 404 rather than 403 on hidden records |
| Enumeration | Identical login failure for unknown account and wrong password |
| Escalation | Self-registration is always `INSPECTOR` |
| Logging | `pino` with `redact` on authorization headers, passwords and tokens |
| Immutability | Finalized inspections reject every write |

---

## The AI phase

The seams that already exist, and what fills them:

| Seam | Today | Next |
| --- | --- | --- |
| `services/ocr/` | Google Cloud Vision, or deterministic fixtures | A benchmarked local model: one class, one `case`, one env var |
| `services/extraction/` | Regex and label patterns | Better patterns, or a layout model behind the same `ExtractionResult` |
| `compliance/` | The full versioned rule engine | Physical measurements, unblocking rules 7(2) and 7(3) |
| `analysisService.ts` | Scripted scenarios, for `POST /:id/analyze` | Superseded by the scan pipeline |
| `storage/` | Local disk | S3 / Cloudinary / GCS provider |
| `GET /:id/report` | JSON and self-contained HTML | The HTML is already what the mobile app prints to PDF |

None of these require a controller, a route, a mobile screen or a console page
to change — which was the point of building them as seams rather than as inline
implementations.

The labelled data for evaluating a real OCR model is already accumulating: every
reviewed field stores what the engine read *and* what the inspector determined,
side by side, with a timestamp and an attributed reviewer.
