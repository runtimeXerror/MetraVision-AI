# The Legal Metrology Rule Engine

Phase 4A. The layer that decides which rules apply to a package and whether
they are satisfied — with no OCR, no computer vision, and no model of any kind
inside it.

## What this layer is for

The system has to be able to say, about a package photographed in a shop:

- **what** requirement was not met,
- **why** it was not met,
- **which** provision imposes it,
- **when** that provision came into force,
- **what evidence** supports the finding, and
- **how confident** that evidence is.

A verdict that cannot answer all six is not usable in an enforcement
proceeding, and every design decision below follows from that.

## The separation that matters

```
Future AI / OCR / CV
        ↓
Structured extracted evidence          ← src/compliance/types/Evidence.ts
        ↓
     RULE ENGINE                       ← src/compliance/rule-engine/
        ↓
Applicable rule resolution
        ↓
Validation
        ↓
Exceptions / exemptions
        ↓
Compliance decision
        ↓
Evidence-backed result                 ← src/compliance/types/ComplianceResult.ts
```

The AI contains no legal rules. The rule engine contains no image processing.
`ComplianceEvaluationRequest` is the seam, and it is expressed entirely in terms
of values, confidences and evidence references — never in terms of models,
pixels or engines.

## Rules are versions, not rules

`LegalRule` is **one version of one requirement**. `ruleId` is the identity of
the requirement and survives amendment; `ruleVersion` distinguishes the
successive texts.

Rule 6(1)(e) — the retail sale price — has had four texts since 2011:

| Version | In force | Notification | What changed |
| --- | --- | --- | --- |
| `2011-04-01` | 2011-04-01 → 2016-09-07 | G.S.R. 202(E) | As enacted |
| `2016-09-07` | 2016-09-07 → 2018-01-01 | G.S.R. 858(E) | Essential Commodities Act prices prevail |
| `2018-01-01` | 2018-01-01 → 2024-01-01 | G.S.R. 629(E) | Must say "maximum retail price inclusive of all taxes" |
| `2024-01-01` | 2024-01-01 → | G.S.R. 779(E) | Replaced by "in Indian currency" |

An inspection dated 2019 is judged against the third row. The same evidence
inspected in 2025 gets a different answer, because the law changed — and that
is the behaviour, not a bug.

`ruleId` is deliberately **not** the provision reference. When G.S.R. 779(E)
omitted rule 5 and re-enacted the promotional-group obligation word for word as
rule 4(2), it stayed one requirement that changed address:
`LM-PC-PROMO-GROUP` runs from 2012 to today across both provision numbers.

## Resolution is by date and nothing else

`VersionResolver` selects on `effectiveFrom <= date < effectiveTo`. It does not
read `status`. That separation is what lets `RuleSetValidator` detect a record
whose declared status disagrees with its dates, instead of the stale status
quietly changing a verdict.

Dates are compared as `YYYY-MM-DD` strings. A commencement is a calendar date in
India, not an instant; parsing it into a `Date` puts it at midnight UTC, which
is 05:30 in Delhi, and an inspection recorded at 02:00 IST on the first of the
month would resolve to the previous version.

### The 2026 country-of-origin sequence

The case worth understanding, because it defeats the obvious implementation:

- **G.S.R. 128(E)**, 13 February 2026, inserts rule 6(10A). In force **1 July 2026**.
- **G.S.R. 312(E)**, 27 April 2026, *substitutes* rule 6(10A). In force **1 July 2027**.

The substituting notification is older than the text it replaces is long-lived.
Resolving by notification date would apply the 2027 wording throughout 2026.
Resolving by commencement date gives the right answer: version `2026-07-01` is
in force from 1 July 2026 to 30 June 2027, and version `2027-07-01` takes over
after that. On the project reference date of 1 September 2026 the second version
is `FUTURE_EFFECTIVE` and must not be applied.

## Exemptions are records, not `if` statements

Rule 26(a) exempts packages of ten grams or less. It has four dated texts:

| In force | Notification | Effect |
| --- | --- | --- |
| 2011-04-01 | G.S.R. 202(E) | Exempt, with a proviso for 10–20 g |
| 2012-07-01 | G.S.R. 784(E) | Proviso omitted |
| 2016-01-01 | G.S.R. 385(E) | **Not** available for tobacco |
| 2026-02-01 | G.S.R. 881(E) | **Not** available for pan masala either |

Written as a boolean in code, this has no history and nobody can say what was
exempt on a given date. Written as four versions, the question answers itself —
and the direction of the 2026 amendment stays visible: it *withdraws* an
exemption from pan masala rather than granting one.

Three effects, and they behave differently:

- `NOT_APPLICABLE` — the rule does not reach the package.
- `PARTIAL_EXEMPTION` — most rules fall away; named requirements survive and are
  still checked. Rule 26(f) exempts loose-sold garments *and then requires four
  declarations anyway*.
- `DEFER_TO_OTHER_REGULATION` — another instrument supplies the requirement.

### Medical devices

G.S.R. 778(E) of 23 October 2025 inserted provisos into rule 2(h) — the
*principal display panel* definition — and into rules 7(2) and 7(3), handing
declaration layout, letter height and letter width for medical-device packages
to the **Medical Devices Rules, 2017**.

The engine hands off and says which instrument took over. It does **not** apply
Table-I to such a package, and it does **not** treat the hand-off as an
exemption from declaring: rule 26(c) expressly withholds the drug-formulation
exemption from medical devices declared as drugs, and the engine honours that.

## Five verdicts, not two

| Status | Meaning |
| --- | --- |
| `COMPLIANT` | The requirement is satisfied. |
| `VIOLATION_DETECTED` | Not satisfied, on evidence strong enough to say so. |
| `REVIEW_REQUIRED` | Something is wrong or missing, but the evidence cannot carry a finding. |
| `NOT_APPLICABLE` | The rule does not reach this package. |
| `INSUFFICIENT_EVIDENCE` | Nothing captured could answer the question. |

The distinction the whole design protects:

```
declaration missing + package captured thoroughly + confident absence
    → VIOLATION_DETECTED

declaration missing + one blurred photo of the front
    → REVIEW_REQUIRED
```

Both arrive as `{ value: null }`. What separates them is
`absenceConfidence` on the field and `captureCompleteness` on the request —
which is why the input contract carries them.

The mirror case is enforced too: a *satisfied* check on a 0.3-confidence read
comes back `REVIEW_REQUIRED`, because passing a package on evidence too weak to
act on is as indefensible as failing one.

Thresholds live in `ConfidenceThresholds` and are configuration, not law.

## Checks awaiting computer vision

Letter height, letter width, placement and legibility need a measurement no
part of this phase produces. Those rules are fully represented — sourced,
dated, with Table-I thresholds carrying the G.S.R. 1373(E) correction — and
resolve to `INSUFFICIENT_EVIDENCE`, never to a pass and never to a violation.

They are counted separately in `summary.pendingCapability` and kept out of the
headline verdict. Every package would carry the same three or four, so letting
them decide would make the verdict a constant that says nothing about the
package and everything about the roadmap.

Supply the measurement on an evidence reference and the check evaluates:

```json
{ "imageId": "img-1", "measurements": { "heightMm": 0.8, "principalDisplayPanelAreaCm2": 120 } }
```

## Determinism

`evaluate(request, ruleSet)` is a pure function. It reads no clock, no
database, no global, and calls no model. The same request against the same
corpus produces the same bytes, apart from `evaluatedAt` and `durationMs`.

The corpus is a *parameter*, not a lookup. Re-running an old inspection against
today's rules would silently rewrite history, so every audit record stores the
`ruleSetVersion` **and** a `ruleSetChecksum` — the version says the corpus was
current to a notification, the checksum says nobody corrected a transcription
error that afternoon.

**No LLM makes a compliance decision.** If one is ever used it goes after the
deterministic result, to explain it — never before, to reach it.

## Where the corpus lives

Canonically in `backend/src/compliance/data/`, in the repository, under review.
The `legal_rules`, `rule_exceptions` and `amendments` collections are a
*projection* of it, seeded on boot and used for querying.

This is inverted from the usual arrangement on purpose. A rule version is only
trustworthy if someone read the Gazette and wrote it down, and that act should
leave a diff, a reviewer and a commit message behind. There is no admin route
that writes a legal rule — not even for `ADMIN`.

## Adding an amendment

No engine code changes. The whole workflow is data plus review.

1. **Get the official notification.** From
   <https://consumeraffairs.gov.in/pages/legal-metrology-act> or the e-Gazette.
   Not a summary, not a news article, not a blog.

2. **Add the amendment record** to `src/compliance/data/amendments.ts`:
   notification number, notification date, publication date if it differs, the
   verbatim commencement text, `effectiveFrom`, `affectedProvisions`, the change
   type, and the official URL. Set `citesPreviousNotification` to whatever the
   notification's own closing note names — the validator walks that chain and
   will tell you if the registry has a hole.

   If you cannot retrieve the official copy, set `verificationStatus` to
   `PARTIALLY_VERIFIED` or `NEEDS_VERIFICATION`, leave `officialSourceUrl`
   undefined, and write a `verificationNote` saying what you do know and how.
   **Do not invent a URL.**

3. **Add the URL** to `src/compliance/data/sources.ts`.

4. **Close the outgoing rule version.** Set its `effectiveTo` to the new
   commencement date, its `status` to `SUPERSEDED`, and its `supersededBy` to
   the new version.

5. **Add the new rule version** to `src/compliance/data/ruleVersions.ts` with
   the same `ruleId`, a `ruleVersion` of the commencement date, the amended
   `legalText` transcribed from the Gazette, a `machineInterpretation` that is
   narrower than the law and says so, and `supersedes` pointing back.

6. **Add or version any exemption** in `src/compliance/data/exceptions.ts`, the
   same way.

7. **Validate.**
   ```
   npm test -- ruleEngine
   npm run rules:report
   ```
   The report must show zero structural errors. If the notification disagrees
   with another official document, add a record to
   `src/compliance/data/conflicts.ts` rather than choosing silently.

8. **Seed and deploy.**
   ```
   npm run rules:seed -- --reset
   ```
   It exits non-zero if the corpus has structural errors, so it will not deploy
   a broken rulebook.

The rule-set version changes automatically — it is derived from the latest
notification date in the registry — and past inspections keep the version and
checksum they were decided on.

## API

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/rules` | Phase 3 catalogue (unchanged) |
| `GET` | `/api/rules/legal` | Versioned corpus; `?asOf=` filters to what was in force |
| `GET` | `/api/rules/legal/:ruleId` | One requirement with its full amendment history |
| `GET` | `/api/rules/applicable` | Which rules reach a package, before any evidence exists |
| `POST` | `/api/compliance/evaluate` | Evaluate structured evidence |
| `GET` | `/api/compliance/:inspectionId` | Evaluations recorded for an inspection |
| `GET` | `/api/compliance/status` | Engine and corpus identity |
| `GET` | `/api/amendments` | The amendment registry |
| `GET` | `/api/amendments/:notification` | One notification and what it produced |
| `GET` | `/api/rule-sources` | Provenance index with verification status |
| `GET` | `/api/rule-validation/report` | Structural and source conflicts |

All read endpoints are open to any signed-in user — an inspector is entitled to
see the provision they are enforcing. There are no mutation endpoints for the
legal corpus.
