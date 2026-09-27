# MetraVision AI — Backend API

REST API for the Packaged Commodities Compliance Scanner.

Node.js · Express · TypeScript · MongoDB · Mongoose · JWT · Zod

```
React Native mobile app
          ↓  REST / JSON
Node.js + Express + TypeScript
          ↓  Mongoose
       MongoDB
```

> **Phase 2 scope.** Authentication, inspections, image upload, review and
> reporting are real and persisted. The **analysis is simulated** — no OCR, no
> computer vision, no model of any kind. `services/analysisService.ts` is the
> abstraction Phase 3 replaces with the Python AI service; flipping
> `ANALYSIS_PROVIDER=http` is the entire integration step.

---

## Quick start

```bash
cd backend
npm install
cp .env.example .env
npm run dev
```

That is the whole setup. **MongoDB does not need to be installed** — with
`MONGODB_URI` empty the server starts an in-process MongoDB via
`mongodb-memory-server` and seeds it.

### Prefer `npm run db` once you start editing

The zero-install fallback is right for a first look and wrong for a working
session. `tsx watch` restarts the server on every file change, and with no
`MONGODB_URI` each restart boots a *new* mongod — which preallocates about
300 MB of WiredTiger journal before it will accept a connection. Restarts get
slow, the outgoing and incoming instances race for the same data directory, and
any that are force-killed leave their 300 MB behind. On a machine that is short
of space this ends with mongod unable to allocate its journal at all, which
looks like the backend randomly refusing to start.

So run the database once, in its own terminal, and leave it there:

```bash
npm run db     # terminal 1 — mongod on 127.0.0.1:27017, data in backend/.mongo-data
npm run dev    # terminal 2 — the API
```

`npm run db` reuses the mongod binary `mongodb-memory-server` already
downloaded, so there is still nothing to install. Set
`MONGODB_URI=mongodb://127.0.0.1:27017` in `.env` to point the server at it.

Restarts then stop touching the database entirely, and the data survives them —
including the demo accounts' ids, so a browser session stays signed in across a
restart instead of being thrown back to the sign-in screen.

```
API listening on http://localhost:4000/api
  reachable from a device at http://192.168.1.7:4000/api
Seeded 5 users and 22 inspections.
```

The second line is the address to give the mobile app when testing on a phone.

### Demo credentials

| Role | Inspector ID | Password |
| --- | --- | --- |
| Inspector | `LM-INS-4471` | `Inspector@123` |
| Inspector | `LM-INS-3308` | `Inspector@123` |
| Inspector | `LM-INS-5192` | `Inspector@123` |
| Supervisor | `LM-SUP-1204` | `Supervisor@123` |
| Admin | `LM-ADM-0001` | `Admin@1234` |

Email addresses work in place of the ID — `ravi.sharma@legalmetrology.gov.in`
and so on. Inspectors see only their own inspections; the supervisor and admin
see all of them.

### Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Dev server with reload (`tsx watch`) |
| `npm run db` | Long-lived MongoDB for development (see above) |
| `npm run build` | Compile `src/` to `dist/` (`tsconfig.build.json`) |
| `npm start` | Run the compiled build |
| `npm run seed` | Reset and reseed a **persistent** database |
| `npm test` | Vitest suite (109 tests, own in-memory MongoDB) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint |

`npm run seed` refuses to run without `MONGODB_URI` — seeding a throwaway
in-memory database from a separate process would write to a database the server
never sees. With no URI set, `npm run dev` seeds itself on boot.

---

## Using a real MongoDB

The in-memory fallback is for convenience; anything you want to survive a
restart needs a real server.

**Local install** — start `mongod`, then:

```bash
MONGODB_URI=mongodb://127.0.0.1:27017
```

**Docker**

```bash
docker run -d --name metravision-mongo -p 27017:27017 -v metravision-mongo-data:/data/db mongo:7
# then in .env
MONGODB_URI=mongodb://127.0.0.1:27017
```

**Atlas** — create a free M0 cluster, allow your IP, and use the SRV string:

```bash
MONGODB_URI=mongodb+srv://<user>:<password>@<cluster>.mongodb.net
```

Then `npm run seed` to populate it. In production a missing `MONGODB_URI` is a
hard startup failure rather than a silent fallback.

---

## Environment

Every variable has a working default; see `.env.example` for the annotated set.
The ones that matter:

| Variable | Default | Notes |
| --- | --- | --- |
| `PORT` | `4000` | |
| `MONGODB_URI` | *(empty)* | Empty → in-memory MongoDB (dev only) |
| `JWT_ACCESS_SECRET` | dev value | **Change before deploying** |
| `JWT_REFRESH_SECRET` | dev value | **Change before deploying** |
| `JWT_ACCESS_TTL` | `2h` | |
| `JWT_REFRESH_TTL` | `30d` | |
| `CORS_ORIGINS` | `*` | Comma-separated list in production |
| `STORAGE_PROVIDER` | `local` | Phase 3 adds `s3` etc. |
| `MAX_UPLOAD_MB` | `12` | Per image |
| `ANALYSIS_PROVIDER` | `mock` | `http` → Python AI service |
| `AUTO_SEED` | `true` | Only ever seeds an **empty** database |

---

## Project structure

```
backend/src/
├── config/          env validation · logger · database connection
├── controllers/     request → service → response; no business rules
├── middleware/      auth · error · validate · upload · rate limiting
├── models/          Mongoose schemas + toDTO()
├── routes/          endpoint wiring, one file per resource
├── services/        the business layer
│   ├── analysisService.ts    ← THE AI SEAM (mock | http)
│   ├── complianceService.ts  ← verdict engine
│   ├── ruleSets.ts           ← declaration requirements per category
│   ├── authService.ts        ← tokens: issue, verify, rotate, revoke
│   └── storage/              ← provider interface + local disk
├── validators/      Zod schemas, one per request shape
├── utils/           ApiError · response envelope · reference numbers
├── types/           the wire contract
├── seed/            demo data
├── app.ts           Express assembly (no listen — tests mount this)
└── index.ts         boot: connect → seed → listen
```

`app.ts` deliberately contains no `listen()` and no database connection, so the
test suite mounts the real application without binding a port.

---

## Documentation

| Document | Contents |
| --- | --- |
| [`docs/api.md`](../docs/api.md) | Every endpoint, request/response shapes, error codes |
| [`docs/database.md`](../docs/database.md) | Collections, fields, indexes, seed data |
| [`docs/backend-architecture.md`](../docs/backend-architecture.md) | Layering, the AI seam, auth design, Phase 3 plan |
| [`docs/legal-rule-engine.md`](../docs/legal-rule-engine.md) | Phase 4A — the versioned legal corpus, date-aware resolution, exemptions, and how to add an amendment |
| [`RULE_DATA_QUALITY_REPORT.md`](./RULE_DATA_QUALITY_REPORT.md) | Generated: what is verified in the corpus and what is not |

---

## Design decisions worth knowing

**Three verdicts, never pass/fail.** `COMPLIANT | VIOLATION_DETECTED |
REVIEW_REQUIRED`. The third is what the system reports when it is not confident
enough to assert either of the others. A missing mandatory declaration outranks
uncertainty and always produces a violation.

**AI output and human correction never overwrite each other.** Every extracted
declaration keeps `aiValue` alongside `humanVerifiedValue`, `humanVerifiedBy`,
`humanVerifiedAt` and `reviewAction`. Collapsing them would destroy the evidence
trail an enforcement record needs and the training signal Phase 3 wants.

**Authorisation lives in one loader.** `loadInspection()` in the inspection
controller performs the ownership check for every single-record route, so a new
endpoint cannot quietly forget it. An inspector requesting someone else's record
gets a **404, not a 403** — confirming existence would leak that the record is
there.

**Compliance is evaluated server-side, always.** Analysis and review both run
the record through `complianceService`, so the mobile app and the future
dashboard can never disagree about a status.

**Reference numbers come from an atomic counter.** `INS-2026-00001` is drawn
from a `$inc` on a `counters` document, not from `countDocuments()` — two
inspectors filing in the same second would otherwise mint the same reference.

**Refresh tokens are stored hashed and rotated on use.** A leaked refresh token
is usable at most once, and logout can actually revoke a session — which a
purely stateless design cannot do.

---

## Testing

```bash
npm test
```

56 tests across four suites, each against its own in-memory MongoDB with every
collection cleared between tests:

- `auth.test.ts` — registration, login, token rotation, revocation, and that
  the password is stored hashed and never serialised
- `inspection.test.ts` — CRUD, pagination, search, filters, cross-inspector
  authorisation
- `workflow.test.ts` — image upload (including a file that lies about its MIME
  type), analysis, review, finalize, report
- `demo-flow.test.ts` — the whole Phase 2 chain end to end, plus the
  supervisor's broader scope

---

## Phase 4A — the Legal Metrology rule engine

Built. `src/compliance/` holds a versioned corpus of the Legal Metrology
(Packaged Commodities) Rules, 2011 and all 33 amending notifications through
G.S.R. 418(E) of 29 May 2026, each read from its Gazette PDF.

```
npm run rules:report          regenerate RULE_DATA_QUALITY_REPORT.md
npm run rules:seed -- --reset project the corpus into MongoDB and validate it
npm test -- ruleEngine        the engine's own suite
```

The engine resolves rules by **inspection date**, so an inspection carried out
in 2019 is judged against the text in force in 2019. It is deterministic, uses
no LLM for any decision, and contains no OCR or CV — those arrive later behind
the `ComplianceEvaluationRequest` contract in
`src/compliance/types/Evidence.ts`.

See [`docs/legal-rule-engine.md`](../docs/legal-rule-engine.md).

---

## Still to come

1. Set `ANALYSIS_PROVIDER=http` and `AI_SERVICE_URL`.
2. Implement `POST /analyze` in the Python service, returning the
   `AnalysisOutput` shape in `services/analysisService.ts`, and map its output
   onto `ComplianceEvaluationRequest`.
3. Point `complianceService` at the Phase 4A engine so inspections evaluate
   against the versioned corpus rather than `ruleSets.ts`. The engine is
   additive today; nothing in the inspection path calls it yet.
4. Supply the image measurements the rule 7 typography checks are waiting for —
   `heightMm`, `widthMm`, `principalDisplayPanelAreaCm2`.
5. Add an object-storage provider behind `services/storage/StorageProvider.ts`.
6. Add report PDF rendering behind `GET /inspections/:id/report`.

No controller, route or mobile screen changes for any of these.
