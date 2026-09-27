# API Reference

Base URL: `http://<host>:4000/api`

All requests and responses are JSON, except image upload which is
`multipart/form-data`.

---

> **Phase 4A — the Legal Metrology rule engine.** The versioned legal corpus,
> the compliance evaluation endpoint and the amendment registry are documented
> separately in [`legal-rule-engine.md`](./legal-rule-engine.md). Those
> endpoints — `/api/compliance/*`, `/api/amendments`, `/api/rule-sources`,
> `/api/rule-validation/report`, `/api/rules/legal` and `/api/rules/applicable`
> — follow the same envelope and auth rules described here.

## Response envelope

Every endpoint returns the same shape, so a client can unwrap responses in one
place rather than per call site.

**Success**

```json
{
  "success": true,
  "data": { },
  "message": "Inspection created successfully"
}
```

`message` is present on writes and omitted on reads. List endpoints put the page
window inside `data` and repeat it in `meta`:

```json
{
  "success": true,
  "data": { "items": [], "page": 1, "pageSize": 20, "total": 42, "totalPages": 3 },
  "meta": { "page": 1, "pageSize": 20, "total": 42, "totalPages": 3 }
}
```

**Error**

```json
{
  "success": false,
  "message": "This inspection has been finalized and can no longer be modified.",
  "errorCode": "INSPECTION_FINALIZED"
}
```

`message` is written to be shown to an inspector verbatim. `errorCode` is the
stable machine-readable value a client branches on. Validation failures add a
`details` array. **Stack traces are never returned.**

### Error codes

| Code | Status | Meaning |
| --- | --- | --- |
| `VALIDATION_FAILED` | 422 | Request body or query failed schema validation; see `details` |
| `INVALID_CREDENTIALS` | 401 | Wrong identifier or password |
| `TOKEN_EXPIRED` | 401 | Access token lapsed — refresh and retry |
| `TOKEN_INVALID` | 401 | Malformed or unverifiable token |
| `REFRESH_REVOKED` | 401 | Refresh token already used, revoked, or superseded |
| `ACCOUNT_INACTIVE` | 401 | Account is not `ACTIVE` |
| `FORBIDDEN` | 403 | Authenticated but not permitted |
| `INSPECTION_NOT_FOUND` | 404 | No such record, **or** not visible to the caller |
| `FIELD_NOT_FOUND` | 404 | No extracted field by that name on the inspection |
| `IMAGE_NOT_FOUND` | 404 | Image is not part of this inspection |
| `EMAIL_IN_USE` | 409 | Registration collided with an existing account |
| `INSPECTION_FINALIZED` | 409 | Record is filed and immutable |
| `ALREADY_FINALIZED` | 409 | Finalize called twice |
| `NO_IMAGES` | 400 | Analysis requested with nothing uploaded |
| `NO_FILE` | 400 | Upload request carried no file |
| `INVALID_IMAGE` | 400 | Bytes are not a real image, whatever the MIME type claimed |
| `ANALYSIS_REQUIRED` | 400 | Finalize or report before analysis |
| `UNSUPPORTED_MEDIA_TYPE` | 415 | Not an accepted image format |
| `PAYLOAD_TOO_LARGE` | 413 | Image exceeds `MAX_UPLOAD_MB` |
| `RATE_LIMITED` | 429 | Too many requests |
| `ANALYSIS_FAILED` | 503 | The analysis engine could not produce a result |
| `SCAN_FAILED` | 4xx/5xx | The scan pipeline stopped. `details.cause` names the stage; `details.retryable` says whether retrying is worth it |
| `OCR_NOT_CONFIGURED` | 503 | `OCR_PROVIDER=google` with no credentials configured (setup, not an outage) |
| `OCR_SERVICE_DOWN` | 503 | `OCR_PROVIDER=paddle` and nothing is listening at `OCR_SERVICE_URL` — start the `ocr-service/` sidecar |
| `NO_TEXT_DETECTED` | 422 | The read succeeded and found no text. **Not** a finding that declarations are missing |
| `OCR_AUTH_FAILED` | 503 | The OCR service rejected the configured credentials |
| `OCR_QUOTA_EXCEEDED` | 503 | The OCR service quota is exhausted |
| `OCR_TIMEOUT` | 504 | The OCR service did not answer within `OCR_TIMEOUT_MS`. Raised only when *no* photograph read — one unreadable face out of several is recorded on `scan.ocr.unread` and the scan continues |
| `OCR_IMAGE_REJECTED` | 422 | The OCR service could not read the image at all |
| `OCR_FAILED` | 503 | The OCR service is unavailable |
| `NO_TEXT_DETECTED` | 422 | The read succeeded and found nothing legible |
| `RULE_ENGINE_FAILED` | 503 | The rules could not be evaluated; nothing was recorded |
| `SCAN_REQUIRED` | 400 | Report requested for an inspection with no scan on record |
| `MOCK_FIXTURE_UNKNOWN` | 400 | `mockFixture` names a fixture that does not exist |
| `MOCK_FIXTURE_UNAVAILABLE` | 400 | `mockFixture` sent while a real OCR provider is configured |
| `IMAGES_UNREADABLE` | 400 | None of the stored images could be read back for a re-scan |
| `SCAN_IN_PROGRESS` | 409 | A scan of this inspection is already running; wait for it rather than starting a second |
| `INTERNAL_ERROR` | 500 | Unexpected failure; details are logged, not returned |

> `INSPECTION_NOT_FOUND` is deliberately returned instead of `FORBIDDEN` when an
> inspector requests another inspector's record. A 403 would confirm the record
> exists.

---

## Authentication

Send the access token as a bearer header on every protected endpoint:

```
Authorization: Bearer <accessToken>
```

Access tokens last 2 hours; refresh tokens last 30 days, are stored hashed, and
are **rotated on every use** — a refresh token is valid exactly once.

### `POST /auth/register`

Public. Always creates an `INSPECTOR`; requesting a privileged role returns 403.

```json
{ "name": "Ravi Sharma", "email": "ravi@legalmetrology.gov.in", "password": "Inspector@123" }
```

→ `201` with an auth session. Password must be at least 8 characters.

### `POST /auth/login`

Public. `identifier` accepts an email address **or** an inspector ID.

```json
{ "identifier": "LM-INS-4471", "password": "Inspector@123" }
```

→ `200`

```json
{
  "success": true,
  "data": {
    "accessToken": "eyJ…",
    "refreshToken": "eyJ…",
    "expiresAt": "2026-08-31T12:00:00.000Z",
    "user": {
      "id": "6a9474eeb4fa4435697fd1f2",
      "inspectorId": "LM-INS-4471",
      "name": "Ravi Sharma",
      "email": "ravi.sharma@legalmetrology.gov.in",
      "role": "INSPECTOR",
      "status": "ACTIVE",
      "department": "Department of Legal Metrology",
      "zone": "Zone III"
    }
  },
  "message": "Signed in successfully"
}
```

An unknown account and a wrong password return an identical response, so the
endpoint cannot be used to enumerate inspector IDs.

### `POST /auth/refresh`

Public. `{ "refreshToken": "…" }` → a new session. The supplied token is revoked
as part of the exchange.

### `POST /auth/logout`

`{ "refreshToken": "…" }` revokes that session. Omit the token while
authenticated and **every** session for the caller is revoked instead.

### `GET /auth/me`

→ the authenticated user.

---

## Users

### `GET /users/me`
### `PATCH /users/me`

Writable: `name`, `phone`, `zone`, `district`, `state`, `avatarColor`.
`role`, `status`, `email` and `inspectorId` are administrative and rejected here.

### `POST /users/me/password`

```json
{ "currentPassword": "Inspector@123", "newPassword": "NewPassword@456" }
```

Revokes every existing session on success.

### `GET /users`

Supervisor or admin only. Returns the roster.

---

## Inspections

### `POST /inspections`

```json
{
  "business": { "name": "ABC Store" },
  "location": {
    "address": "MG Road, Pune",
    "district": "Pune",
    "state": "Maharashtra",
    "latitude": 18.51957,
    "longitude": 73.85535,
    "accuracyM": 12
  },
  "productCategory": "packaged_food",
  "notes": "Initial inspection"
}
```

→ `201`. The backend generates the reference:

```json
{ "id": "…", "inspectionId": "INS-2026-00001", "status": "DRAFT", "images": [], "extractedFields": [] }
```

`business.name` and `location.address` are required. `productCategory` is
optional — the analyser infers it, and the applicable rule set follows from it.

Everything under `location` except `address` is optional. The mobile app fills
`district`, `state` and the coordinates from the device's GPS fix and lets the
inspector correct the first two by hand, so the coordinates record where the
officer stood while the address stays whatever they judged it to be.

### `GET /inspections`

| Query | Default | Notes |
| --- | --- | --- |
| `page` | `1` | |
| `pageSize` | `20` | Max 100 |
| `search` | — | Partial match on reference, business, product, address |
| `status` | — | Any `InspectionStatus`, or `ALL` |
| `productCategory` | — | |
| `from` / `to` | — | ISO 8601 with offset, inclusive |
| `inspectorId` | — | Supervisor/admin only; ignored for inspectors |
| `sort` | `newest` | `newest` · `oldest` · `score` |

An inspector's results are always scoped to their own records regardless of the
query. The full database is never returned in one response.

### `GET /inspections/:id`

`:id` accepts a Mongo id **or** a human reference (`INS-2026-00001`).

Returns the complete record: business, location, images, extracted fields,
`aiAnalysis`, `complianceResult`, review progress, notes, timestamps, status.

### `PATCH /inspections/:id`

Updates `business`, `location`, `productCategory`, `productName`, `notes`.
Returns `409 INSPECTION_FINALIZED` once the record is filed.

### `DELETE /inspections/:id`

A finalized record can only be deleted by an `ADMIN`.

### `GET /inspections/stats`

```json
{
  "totalInspections": 10, "compliant": 4, "violations": 4,
  "pendingReviews": 2, "finalized": 8, "averageScore": 87
}
```

Scoped to the caller for inspectors; jurisdiction-wide for supervisors.

---

## Images

### `POST /inspections/:id/images`

`multipart/form-data`:

| Field | Notes |
| --- | --- |
| `image` | One file |
| `images` | Repeatable, up to 8 |
| `type` | `FRONT` · `BACK` · `SIDE` · `ADDITIONAL` (default `FRONT`) |

Accepted: JPEG, PNG, WebP, HEIC, up to `MAX_UPLOAD_MB` (12 MB default).
Validation is two-stage — the declared MIME type **and** the file's magic bytes,
so a text file renamed `.png` is rejected with `INVALID_IMAGE`.

→ `201`

```json
{
  "inspectionId": "INS-2026-00001",
  "images": [{
    "imageId": "img_480422eed10a0f30",
    "type": "FRONT",
    "url": "/uploads/inspections/INS-2026-00001/1788114218569-9d491a83ddc2.png",
    "mimeType": "image/png",
    "sizeBytes": 70,
    "createdAt": "2026-08-31T09:12:00.000Z"
  }]
}
```

`url` is relative to the API origin. Files are served from `/uploads`.

### `GET /inspections/:id/images`
### `DELETE /inspections/:id/images/:imageId`

---

## Analysis

### `POST /inspections/:id/analyze`

```json
{ "categoryHint": "packaged_food" }
```

`categoryHint` is optional; the engine classifies independently.

Requires at least one uploaded image (`400 NO_IMAGES` otherwise). Returns the
**complete updated inspection**, so a client needs no follow-up fetch.

```json
{
  "aiAnalysis": {
    "engine": "MOCK",
    "engineVersion": "mock-2.0.0",
    "category": { "value": "packaged_food", "confidence": 0.97 },
    "origin": "DOMESTIC",
    "meanConfidence": 0.96,
    "processingMs": 1204,
    "imageIds": ["img_…"],
    "analysedAt": "2026-08-31T09:12:04.000Z",
    "warnings": [],
    "bboxSpace": { "width": 800, "height": 1000 }
  },
  "extractedFields": [
    {
      "name": "mrp",
      "label": "Maximum Retail Price",
      "aiValue": "₹315.00",
      "confidence": 0.98,
      "bbox": [470, 348, 740, 412],
      "sourceImageId": "img_…",
      "required": true
    }
  ],
  "complianceResult": {
    "status": "COMPLIANT",
    "score": 100,
    "checks": [ … ],
    "violations": [ … ],
    "warnings": [],
    "ruleSetId": "rs-food-v1",
    "ruleSetLabel": "Packaged Food Commodities"
  }
}
```

> **`bboxSpace` matters.** `bbox` is `[x1, y1, x2, y2]` in pixels relative to
> that frame, not to the stored image. Normalise against `bboxSpace` before
> drawing an overlay, and a box stays correct at any render size.

> **No OCR runs in Phase 2.** The engine is scripted. `engine: "MOCK"` is
> persisted on every record so historical inspections stay auditable once the
> real pipeline starts writing `PADDLE_OCR` or `VLM`.

**Verdict rules**

- any mandatory declaration missing → `VIOLATION_DETECTED`
- otherwise any field read below 0.75 confidence → `REVIEW_REQUIRED`
- otherwise → `COMPLIANT`

A violation outranks uncertainty: a missing declaration is a finding regardless
of how confident the other reads were.

---

## Scan — OCR, extraction and the rule engine

```
IMAGE  ->  OCRProvider  ->  extraction  ->  rule engine  ->  issues  ->  report
```

One call does the whole pipeline. Every stage records the version of whatever
produced it, so an inspection is reproducible: the OCR provider, the extraction
engine, the rule-set version and its checksum are all stored on the record.

**The credential never leaves the server.** Every OCR call is made from the
backend process; no key, endpoint or service account is exposed to the mobile or
web client, and none appears in any response.

### `POST /inspections/scan`

`multipart/form-data`. Creates the inspection, stores the images, runs the
pipeline and returns the whole result.

| Field | Required | Notes |
| --- | --- | --- |
| `image` | one of | A single package photograph |
| `images` | one of | Up to 8 photographs of different faces |
| `inspectionDate` | yes | ISO date. **Every rule is resolved against this and nothing else** |
| `productContext` | no | JSON string; the rule engine's `ProductContext` |
| `business` | no | JSON string, `{ "name": "..." }`. Defaults to a placeholder |
| `location` | no | JSON string, `{ "address": "...", "district": "...", "state": "..." }` |
| `notes` | no | Free text |
| `mockFixture` | no | Pins the mock OCR fixture. **Rejected when a real provider is configured** |

```
POST /api/inspections/scan
Authorization: Bearer <access token>
Content-Type: multipart/form-data

images=@front.jpg
images=@back.jpg
inspectionDate=2026-09-02
productContext={"category":"packaged_food","packageType":"RETAIL","isImported":false}
```

`productContext` is passed through to the engine unchanged and accepts any key
its `ProductContext` defines — `isEcommerce`, `isSoldLoose`, `packageType` and
the rest. One extra key is understood here:

- `captureCompleteness` (0–1) — overrides the count-based estimate of how much
  of the package was photographed. See **Why a missing declaration is sometimes
  only a review** below.

**`201 Created`:**

```json
{
  "success": true,
  "message": "POTENTIAL NON-COMPLIANCE DETECTED",
  "data": {
    "inspectionId": "INS-2026-00024",
    "status": "VIOLATION_DETECTED",

    "ocr": {
      "provider": "google-vision",
      "providerVersion": "vision-v1/DOCUMENT_TEXT_DETECTION",
      "rawText": "CRISPY BITE\nMixture Namkeen\nNet Wt. 200 g\n…",
      "regions": [
        { "text": "Net Wt. 200 g", "confidence": 0.97,
          "boundingBox": [80, 288, 380, 348], "kind": "LINE", "imageId": "img_9f2c…" }
      ],
      "lineCount": 32,
      "confidenceAvailable": true,
      "processingMs": 1180
    },

    "extractedData": {
      "engine": "rule-based-extractor",
      "engineVersion": "1.0.0",
      "fields": {
        "net_quantity": {
          "field": "net_quantity", "label": "Net quantity",
          "value": "200 g", "unit": "g", "confidence": 0.97,
          "status": "FOUND", "method": "LABEL_MATCH",
          "matchedText": "Net Wt. 200 g",
          "evidence": [{ "imageId": "img_9f2c…", "text": "Net Wt. 200 g",
                         "bbox": [80, 288, 380, 348],
                         "space": { "width": 900, "height": 1400 },
                         "confidence": 0.97 }]
        },
        "mrp": { "field": "mrp", "label": "Maximum retail price",
                 "value": null, "status": "NOT_FOUND", "evidence": [] }
      },
      "informational": { "brand": { "value": "CRISPY BITE", "method": "HEURISTIC" } },
      "warnings": ["The common or generic name was identified by layout rather than by a printed label…"]
    },

    "compliance": {
      "status": "VIOLATION_DETECTED",
      "headline": "POTENTIAL NON-COMPLIANCE DETECTED",
      "summary": { "totalChecks": 20, "compliant": 4, "violations": 3,
                   "reviewRequired": 0, "notApplicable": 11,
                   "insufficientEvidence": 2, "pendingCapability": 2 },
      "checks": [ /* every provision evaluated, with provenance */ ],
      "issues": [
        {
          "issueId": "ISS-3f9a21c4d0e7",
          "ruleId": "LM-PC-R6-1-E", "ruleVersion": "2024-01-01",
          "field": "mrp", "fieldLabel": "Retail sale price",
          "classification": "POTENTIAL_VIOLATION",
          "severity": "CRITICAL",
          "title": "Required declaration not detected",
          "description": "No declaration was found. The retail sale price of the package, in Indian currency.",
          "expectedRequirement": "…", "observedValue": null,
          "reasonCode": "DECLARATION_ABSENT", "confidence": null,
          "evidence": [],
          "source": { "rule": "Rule 6", "clause": "6(1)(e)",
                      "notification": "G.S.R. 779(E)", "notificationDate": "2021-11-02",
                      "officialUrl": "https://…", "effectiveFrom": "2024-01-01",
                      "effectiveTo": null, "verificationStatus": "VERIFIED" },
          "legalText": "…verbatim from the Gazette…",
          "machineInterpretation": "…this system's narrower reading, explicitly not authoritative…"
        }
      ],
      "issueSummary": { "total": 5, "potentialViolations": 3, "review": 0, "info": 2,
                        "bySeverity": { "CRITICAL": 1, "MAJOR": 2, "MINOR": 0 } },
      "warnings": [], "applicableRules": [],
      "ruleSetVersion": "LM-PC-2026-05-29",
      "ruleSetChecksum": "a056644e1964e00e",
      "engineVersion": "lm-rule-engine/1.0.0",
      "thresholds": { "sufficient": 0.85, "weak": 0.5,
                      "absenceSufficient": 0.85, "minimumCaptureCompleteness": 0.7 }
    },

    "evidence": {
      "images": [],
      "captureCompleteness": 0.95,
      "contextApplied": [{ "key": "isImported", "value": true,
                           "basis": "An importer declaration was read on the package." }],
      "contextOverridden": []
    },

    "report": {
      "reportId": "RPT-7E6A2A010477", "available": true,
      "url": "/api/inspections/INS-2026-00024/report",
      "disclaimer": "The system provides automated compliance screening…",
      "limitations": ["…"]
    },

    "timings": { "ocrMs": 1180, "extractionMs": 15, "ruleEngineMs": 130, "totalMs": 1340 }
  }
}
```

#### `classification` vs `severity`

Two different questions, deliberately kept apart on every issue:

- **`severity`** — `CRITICAL` / `MAJOR` / `MINOR`. The rule *set's* grading of
  the requirement, copied from the corpus. How serious it is, in law, to sell
  goods with no declared price.
- **`classification`** — `POTENTIAL_VIOLATION` / `REVIEW` / `INFO`. How good
  *this scan's* evidence is about *this* package.

A `CRITICAL` rule read from a blurred photograph yields a `REVIEW`. Nothing in
the API ever says "confirmed violation": the engine's strongest verdict is that
a requirement was not satisfied on evidence good enough to act on, and whether
an offence was committed is a decision for a person with a statutory power.

#### Why a missing declaration is sometimes only a review

`{ "value": null }` from the extractor says something about the photograph, not
about the trader. Whether an absent declaration is a finding turns on how much
of the package was actually captured:

| Photographs | `captureCompleteness` | A missing MRP becomes |
| --- | --- | --- |
| 1 | 0.45 | `REVIEW_REQUIRED` |
| 2 | 0.70 | `VIOLATION_DETECTED` |
| 4+ | 0.95 | `VIOLATION_DETECTED` |

The ladder is `CAPTURE_COMPLETENESS_BY_IMAGE_COUNT`; the 0.7 floor is the
engine's `minimumCaptureCompleteness` threshold. Send an explicit
`productContext.captureCompleteness` to override the estimate.

The same principle applies to confidence: where the OCR provider reports none,
the field carries none, and the engine routes a failed check to review rather
than recording a finding on a value of unknown reliability.

#### Failures

The pipeline stops rather than evaluating empty data — an empty field set is
indistinguishable to the engine from a package with no declarations on it.

```json
{
  "success": false,
  "message": "The OCR service is unavailable. Please try again.",
  "errorCode": "SCAN_FAILED",
  "details": { "inspectionId": "INS-2026-00031", "cause": "OCR_FAILED", "retryable": true }
}
```

The inspection survives in `DRAFT` with its images attached, so the inspector
can retry against `POST /inspections/:id/scan` without photographing the package
again. No compliance evaluation is written.

### `POST /inspections/:id/scan`

The same pipeline over photographs already on an inspection. JSON body; this is
what the mobile capture flow calls after uploading faces one at a time, and the
retry path after a failure.

```json
{
  "inspectionDate": "2026-09-02",
  "productContext": { "category": "packaged_food" },
  "mockFixture": "compliant"
}
```

`inspectionDate` defaults to today. Returns the full `InspectionDTO`, including
`scan`. Re-scanning is legitimate and expected — every evaluation is kept, so a
verdict is superseded rather than overwritten, and two evaluations of one
inspection can be compared by their `ruleSetChecksum` and OCR provider.

`409 INSPECTION_FINALIZED` on a filed record; `400 NO_IMAGES` with nothing
uploaded.

### `GET /inspections/scan/status`

What the pipeline is configured to do, and whether it is set up. Names and flags
only — no credential is ever included.

```json
{
  "ocrProvider": "google-vision",
  "ocrProviderVersion": "vision-v1/DOCUMENT_TEXT_DETECTION",
  "ocrConfigured": true,
  "extractionEngine": "rule-based-extractor",
  "extractionEngineVersion": "1.0.0",
  "availableMockFixtures": [],
  "usesLlmForDecisions": false,
  "decisionsMadeBy": "lm-rule-engine"
}
```

When the provider is not configured the response adds `setupRequired` with a
one-line description of what is missing.

---

## Review

### `POST /inspections/:id/review`

One decision:

```json
{
  "fieldName": "net_quantity",
  "action": "EDITED",
  "value": "500 g",
  "comment": "Print was smudged"
}
```

Or a batch: `{ "reviews": [ … ] }` (up to 40).

`action` is `ACCEPTED` · `EDITED` · `MARKED_UNAVAILABLE`. `value` is required
when the action is `EDITED`.

The response is the updated inspection with compliance **re-evaluated** — a
correction can turn `REVIEW_REQUIRED` into `COMPLIANT`, and marking a mandatory
declaration unavailable produces a violation.

**The AI reading is never overwritten:**

```json
{
  "name": "consumer_care",
  "aiValue": null,
  "humanVerifiedValue": "care@krishna.in · 1800-111-2222",
  "humanVerifiedBy": "6a9474eeb4fa4435697fd1f2",
  "humanVerifiedAt": "2026-08-31T09:14:03.000Z",
  "reviewAction": "EDITED",
  "reviewComment": "Printed on inner wrapper"
}
```

---

## Finalize and report

### `POST /inspections/:id/finalize`

```json
{ "finalNotes": "Notice issued on site." }
```

Requires a completed analysis (`400 ANALYSIS_REQUIRED`). Sets `status` to
`FINALIZED` and stamps `finalizedAt`. **The record becomes immutable** — further
`PATCH`, upload, analyze, review or finalize calls return `409`.

### `GET /inspections/:id/report`

The compliance report. `?format=html` renders a self-contained printable page —
no external stylesheet, font or script, so it renders from a saved copy on a
laptop with no network, and is what the mobile app turns into a PDF. Both
formats are generated from the same object and cannot disagree.

An inspection that went through the scan pipeline gets the full report below.
One created through the older capture-and-review workflow keeps the report it
always had.

```json
{
  "reportVersion": "lm-scan-report/1.0.0",
  "reportId": "RPT-7E6A2A010477",
  "inspectionId": "INS-2026-00024",
  "generatedAt": "2026-09-02T10:15:00.000Z",
  "inspectionDate": "2026-09-02",

  "inspector": { "id": "…", "name": "Ravi Sharma", "inspectorId": "LM-INS-4471" },
  "business": { "name": "Sharma General Store" },
  "location": { "address": "MG Road, Pune", "district": "Pune", "state": "Maharashtra" },

  "product": { "name": "CRISPY BITE Mixture Namkeen", "brand": "CRISPY BITE",
               "commodityName": "Mixture Namkeen", "netQuantity": "200 g",
               "mrp": null, "countryOfOrigin": null },
  "images": [],

  "ocrSummary": { "provider": "google-vision", "lineCount": 32,
                  "characterCount": 640, "confidenceAvailable": true,
                  "meanRegionConfidence": 0.95, "processingTimeMs": 1180 },

  "extractedFields": [
    { "field": "net_quantity", "label": "Net quantity", "value": "200 g",
      "status": "FOUND", "confidence": 0.97, "method": "LABEL_MATCH",
      "unit": "g", "evidenceCount": 1, "sourceText": "Net Wt. 200 g" }
  ],
  "informationalFields": [],

  "rulesEvaluated": [
    { "ruleId": "LM-PC-R6-1-E", "ruleVersion": "2024-01-01", "sourceRule": "Rule 6",
      "sourceClause": "6(1)(e)", "title": "…", "applied": true }
  ],

  "checks": { "passed": [], "failed": [], "reviewRequired": [],
              "notApplicable": [], "insufficientEvidence": [] },

  "issues": [],
  "issueSummary": { "total": 5, "potentialViolations": 3, "review": 0, "info": 2,
                    "bySeverity": { "CRITICAL": 1, "MAJOR": 2, "MINOR": 0 } },

  "sources": [
    { "notification": "G.S.R. 779(E)", "notificationDate": "2021-11-02",
      "officialUrl": "https://…", "verificationStatus": "VERIFIED",
      "ruleIds": ["LM-PC-R6-1-E"] }
  ],

  "overall": {
    "status": "VIOLATION_DETECTED",
    "headline": "POTENTIAL NON-COMPLIANCE DETECTED",
    "summary": { "totalChecks": 20, "compliant": 4, "violations": 3, "…": 0 }
  },

  "provenance": {
    "engineVersion": "lm-rule-engine/1.0.0",
    "ruleSetVersion": "LM-PC-2026-05-29", "ruleSetChecksum": "a056644e1964e00e",
    "ocrProvider": "google-vision", "ocrProviderVersion": "vision-v1/DOCUMENT_TEXT_DETECTION",
    "extractionEngine": "rule-based-extractor", "extractionEngineVersion": "1.0.0",
    "thresholds": {}, "captureCompleteness": 0.95,
    "contextApplied": [], "timings": {}
  },

  "limitations": ["…"],
  "disclaimer": "The system provides automated compliance screening based on the information detected from the submitted package image and the rules implemented in the system. Results should be reviewed by an authorized inspector where evidence is incomplete or uncertain.",
  "warnings": []
}
```

#### What the headline may say

| `overall.status` | `overall.headline` |
| --- | --- |
| `COMPLIANT` | NO COMPLIANCE ISSUES DETECTED IN THE CHECKS PERFORMED |
| `VIOLATION_DETECTED` | POTENTIAL NON-COMPLIANCE DETECTED |
| `REVIEW_REQUIRED` | INSPECTOR REVIEW REQUIRED |
| `INSUFFICIENT_EVIDENCE` | INSUFFICIENT EVIDENCE TO COMPLETE THE CHECKS |
| `NOT_APPLICABLE` | NO IMPLEMENTED RULE APPLIED TO THIS PACKAGE |

A clean scan never reads "compliant" and never reads "100%". The system checks a
photograph against the subset of the Packaged Commodities Rules it implements;
it cannot weigh the package, measure letter heights, see faces nobody
photographed, or read a rule that is not in its corpus. `limitations` is
assembled from what actually happened in this scan rather than from boilerplate,
so it narrows as the evidence improves.

`summary.pendingCapability` counts checks needing a physical measurement this
version does not take from an image — rules 7(2) and 7(3), character height and
width. They are reported and warned about, and deliberately kept out of the
headline: every package carries the same count, so letting them decide would
make the verdict a constant.


---

## Health

### `GET /api/health`

Public. Reports which providers are active, so it is visible at a glance that
the analysis is the mock one.

```json
{
  "status": "ok",
  "environment": "development",
  "database": "in-memory (ephemeral)",
  "analysisProvider": "mock",
  "storageProvider": "local",
  "ocr": { "provider": "google-vision", "version": "vision-v1/DOCUMENT_TEXT_DETECTION", "configured": true },
  "extraction": { "engine": "rule-based-extractor", "version": "1.0.0" },
  "usesLlmForDecisions": false,
  "phase": "Phase 3 — web dashboard; mock analysis, no OCR"
}
```

---

## Analytics

Read models for the web dashboard. Open to any signed-in caller: **the scope is
derived from the token, never from the query string**, so an inspector asking
for the summary gets their own numbers and cannot widen it by editing a URL. A
supervisor or admin may narrow to one inspector with `inspectorId`.

All seven endpoints accept the same filters:

| Parameter | Notes |
| --- | --- |
| `from`, `to` | ISO 8601 with offset |
| `productCategory` | One of the product categories |
| `district` | Matches `location.district` |
| `state` | Matches `location.state` |
| `status` | An inspection status, or `ALL` |
| `inspectorId` | Supervisor/admin only; ignored for an inspector |
| `days` | Trend window when no explicit range is given (7–365, default 30) |

### `GET /analytics/overview`

Everything the dashboard renders, in one round trip — the alternative is seven
parallel requests each re-running the same `$match` and painting the page in
stages. Returns `{ summary, trend, distribution, violationsByCategory,
violationTypes, inspectorActivity, districts }`.

### `GET /analytics/summary`

```json
{
  "totalInspections": 22,
  "compliant": 9,
  "violations": 9,
  "pendingReviews": 4,
  "finalized": 14,
  "drafts": 0,
  "complianceRate": 41,
  "averageScore": 87,
  "activeInspectors": 3,
  "totalViolationFindings": 14
}
```

`complianceRate` is computed over **assessed** records only. Counting drafts as
non-compliant would make the figure fall whenever an inspector opens a form.

### `GET /analytics/trend`

One point per day, **including days with no activity** — a line chart that omits
quiet days draws straight through them and misrepresents the gap as steady work.

### `GET /analytics/distribution`

Compliant / violation / review-required / not-assessed counts.

### `GET /analytics/violations-by-category`

Findings per product category, returned alongside the volume inspected in each:
four findings out of five inspections and four out of four hundred are different
facts.

### `GET /analytics/violation-types`

The most frequently raised findings, with code, category, severity and count.

### `GET /analytics/inspector-activity`

Per-inspector metrics. Driven from the user collection outward, so an officer
who has filed nothing still appears.

### `GET /analytics/districts`

Geographic rollup. Rows, not anything map-shaped: without authoritative district
boundaries a choropleth would be decoration.

Each row carries `district`, `state`, `inspections`, `violations`,
`complianceRate`, and the `assessed` / `compliant` counts the rate is derived
from. The counts are there so a caller grouping rows into a state total can sum
exact figures — a mean of district percentages over unequal denominators is not
the rate of the state, and the console's state/district table needs the real
one.

---

## Violations

A violation is not its own collection — it is a finding on an inspection's
compliance result, and it has no meaning detached from the inspection that
produced it. These endpoints `$unwind` the embedded findings into flat,
addressable rows.

The identifier is composite and stable: `<inspection reference>:<finding code>`,
e.g. `INS-2026-00022:LMPCR-consumer_care`.

### `GET /violations`

Paginated. Filters: `search`, `severity`, `category`, `status` (`OPEN` |
`RESOLVED`), `productCategory`, `district`, `state`, `inspectorId`, `from`, `to`.

A finding is `OPEN` while its inspection is still live and `RESOLVED` once that
inspection is filed.

### `GET /violations/:violationId`

Returns `{ violationId, violation, status, inspection }` — the whole inspection
travels with the finding so the detail page can show the evidence without a
second request and a client-side stitch.

`400 INVALID_VIOLATION_ID` for a malformed reference, `404 VIOLATION_NOT_FOUND`
if the inspection or code does not exist, `403` if the caller is not entitled to
the inspection.

### `GET /violations/stats`

`{ total, open, resolved, critical, major, minor }` over the same filters.

---

## Products

### `GET /products`

Inspection history rolled up by commodity. There is no product collection: this
system inspects *packages presented at a premises*, and the same commodity
inspected at two shops is two pieces of evidence, not one record with a shared
state.

Each row carries `productKey`, `productName`, `productCategory`, `inspections`,
`violations`, `compliant`, `complianceRate`, `lastInspectedAt` and the
`businesses` it was found in. Filters: `search`, `productCategory`,
`inspectorId`, `from`, `to`.

---

## Rules

The rule repository. Readable by **any** signed-in user — an inspector is
entitled to see the provision they are being measured against. Writing is
admin-only.

### `GET /rules`

Paginated. Filters: `search`, `status` (`ACTIVE` | `DRAFT` | `RETIRED` | `ALL`),
`category`, `field`, `validationType`.

### `GET /rules/:id`

Accepts either the Mongo id or the human reference (`LM-PKG-6-1-C-NET-QUANTITY`),
so a URL read off the screen works when pasted.

### `POST /rules` — admin

`409 RULE_EXISTS` for a duplicate identifier.

### `PATCH /rules/:id` — admin

**Amendment, not edit.** Changing the `requirement`, `validationType` or
`parameters` is substantive: the outgoing text is closed off with an
`effectiveTo`, pushed onto `history`, and `version` increments. Everything else
(title, severity, status, categories) is metadata and updates in place.

Editing substance in place would leave every past inspection appearing to have
been judged against wording that did not exist at the time.

### `POST /rules/:id/status` — admin

`{ "status": "ACTIVE" | "DRAFT" | "RETIRED" }`. Retiring is deliberately not
deletion: a rule that produced findings stays readable for as long as those
findings are on record.

---

## Rate limits

| Scope | Window | Limit |
| --- | --- | --- |
| `/api/*` | 15 min | 300 requests |
| `/api/auth/register`, `/login`, `/refresh` | 15 min | 20 requests |

Exceeding either returns `429` with `errorCode: "RATE_LIMITED"`. Static
`/uploads` is served before the limiter, so loading an inspection's images does
not consume an inspector's request budget.
