# SIH26034 — Packaged Commodities Compliance Scanner

Smart India Hackathon 2026 · Problem statement **SIH26034**

A field-inspector system for the Department of Legal Metrology. An inspector
photographs a packaged commodity's label; the system reads the mandatory
declarations off it, checks them against the rules that apply to that product
category, and produces an enforcement record.

---

## Quick start — run it

Four terminals. Database and backend first; both clients need them.

```bash
# 1 · Database  →  mongodb://127.0.0.1:27017  (leave this running)
cd D:\Projects\SIH26034\backend
npm run db
```

```bash
# 2 · Backend  →  http://localhost:4000/api
cd D:\Projects\SIH26034\backend
npm run dev
```

```bash
# 3 · Web console  →  http://localhost:5173
cd D:\Projects\SIH26034\web
npm run dev
```

```bash
# 4 · Mobile app  →  press a / i, or scan the QR in Expo Go
cd D:\Projects\SIH26034\mobile
npm start
```

Dependencies are already installed and `backend/.env` is in place. `npm run db`
runs MongoDB from the binary already on this machine — nothing to install — and
keeps its data in `backend/.mongo-data`, so restarting the API no longer resets
the database or signs you out. Leave `MONGODB_URI` empty instead and the backend
still starts a database of its own, but every restart replaces it; see
`backend/README.md` for why that gets painful once you are editing code.

Sign in with `LM-INS-4471` / `Inspector@123` (inspector) or `meera.nair@legalmetrology.gov.in` / `Supervisor@123`
(supervisor) — both sign-in screens fill these in on a tap.

---

## Current status — the end-to-end pipeline works

| Phase | Component | Status |
| --- | --- | --- |
| **1** | `mobile/` — Inspector app | ✅ Built |
| **2** | `backend/` — Node/Express + MongoDB API | ✅ Built, connected, tested |
| **3** | `web/` — Supervisor dashboard | ✅ Built, connected, tested |
| **4A** | Legal Metrology rule engine — versioned corpus, five-state verdicts | ✅ Built, tested |
| **4B** | OCR → extraction → rule engine → report | ✅ **Built, connected, tested** |
| 5 | A benchmarked OCR model in place of the cloud API | ⬜ Not started |

Two clients, one backend, one database. Inspectors capture in the field on the
mobile app; supervisors review, endorse and report in the web console. Neither
client holds its own copy of the data or its own idea of what the law requires.

**A photograph now produces a real verdict.** `POST /api/inspections/scan` runs
the whole pipeline in one call:

```
IMAGE  →  OCR API  →  raw text + located regions  →  field extraction
       →  structured declarations + evidence  →  Legal Metrology rule engine
       →  rule-by-rule checks  →  issues  →  compliance report
       →  mobile app + web dashboard
```

Every stage is behind an interface and every stage records its own version, so
an inspection is reproducible and the OCR engine is replaceable. Details:
[`ML_OCR/README.md`](ML_OCR/README.md).

```
React Native (Expo)          React (Vite)
   Inspector app             Supervisor console
        │                            │
        └──────────  REST + JWT  ────┘
                     │
        Node.js · Express · TypeScript
                     │
        ┌────────────┼─────────────┐
        │            │             │
     MongoDB    OCRProvider    rule engine
                     │        (pure, versioned,
                     ↓         no model, no LLM)
        Google Cloud Vision  ·or·  fixtures  ·or·  a future local model
```

The web console never connects to MongoDB. Both clients go through the same
API, and the API is the only thing that decides what a role may see. The OCR
credential lives only in the backend process — no key ever reaches a client.


---

## Repository layout

```
SIH26034/
├── mobile/          React Native + Expo SDK 54 + TypeScript
│   └── README.md    App documentation, run instructions, architecture
├── backend/         Node.js + Express + TypeScript + MongoDB
│   └── README.md    Setup, environment, scripts, seeding
├── web/             React + Vite + TypeScript + Tailwind
│   └── README.md    Dashboard documentation, routes, architecture
├── docs/
│   ├── api.md                   Every endpoint, with request/response shapes
│   ├── backend-architecture.md  Layering, the two swappable seams, security
│   └── database.md              Collections, indexes, the review model
└── README.md        This file
```

---

## Running it

Two terminals. Start the backend first.

### 1 · Backend

```bash
cd backend
npm install
cp .env.example .env      # every value already has a working default
npm run dev
```

It prints both the local and the LAN address:

```
API listening on http://localhost:4000/api
  reachable from a device at http://192.168.1.7:4000/api
```

**MongoDB is optional for a demo.** With `MONGODB_URI` empty the server starts
an in-process MongoDB and seeds it — no installation required, but the data is
discarded on restart. For a durable database, install MongoDB (or run
`docker run -d -p 27017:27017 mongo:7`), set `MONGODB_URI=mongodb://127.0.0.1:27017`,
then `npm run seed`.

### 2 · Mobile

```bash
cd mobile
npm install
npm start
```

Press `a` for Android, `i` for iOS, or scan the QR code with Expo Go.

The app derives the backend host from the Expo dev-server address it was loaded
from, so a physical device on the same Wi-Fi and the Android emulator both work
with no configuration. Override it only if the backend runs elsewhere:

| Target | `EXPO_PUBLIC_API_URL` |
| --- | --- |
| Leave empty (recommended) | derived from the Expo host |
| Android emulator | `http://10.0.2.2:4000/api` |
| iOS simulator | `http://localhost:4000/api` |
| Physical device | `http://<your-LAN-IP>:4000/api` |

The Profile screen shows the resolved URL and a live **Connection** row, which
is the fastest way to diagnose a demo that will not load.

### 3 · Web console

```bash
cd web
npm install
npm run dev
```

Open **http://localhost:5173**. No configuration needed: the Vite dev server
proxies `/api` and `/uploads` to the backend on port 4000, so the browser talks
to its own origin and there is no CORS to arrange. Set `VITE_PROXY_TARGET` if
the backend is on another port, or `VITE_API_URL` for a deployed build.

### Demo credentials

| Role | Identifier | Password | Where |
| --- | --- | --- | --- |
| Inspector | `LM-INS-4471` | `Inspector@123` | Both |
| Supervisor | `meera.nair@legalmetrology.gov.in` | `Supervisor@123` | Web console |
| Admin | `admin@legalmetrology.gov.in` | `Admin@1234` | Web console |

The same accounts work in both clients — there is one identity system, not two.
Both sign-in screens fill these in on a tap, so use that during a presentation
rather than typing.

The seed creates 22 inspections across three inspectors, five product
categories, three districts and every verdict, plus the rule catalogue — so
every screen has content before anything is captured. Sign in to the console as
the **inspector** to see role scoping: the roster vanishes, `/inspectors` is
refused, and every count drops to that officer's own work.

---

## Demo flow

```
Login → Home → Start New Inspection → Inspection Details
     → Capture Product Images → Image Quality Review
     → Analysis → Compliance Result → Review (if required)
     → Finalize → Inspection Report → History
```

Every step above is a round trip to the backend and a write to MongoDB. The
whole path is covered end-to-end by `backend/tests/demo-flow.test.ts`.

### The four demo cases

Successive analyses rotate through scripted scenarios, so a walkthrough shows
every verdict without needing particular photographs:

| Trigger | Product | Verdict |
| --- | --- | --- |
| 1st analysis (1–2 images) | Packaged atta, all declarations present | **Compliant** |
| 2nd analysis (1–2 images) | Namkeen, missing consumer care + FSSAI licence | **Violation Detected** |
| 3rd analysis (1–2 images) | Worn cosmetic label, several uncertain reads | **Review Required** |
| Any analysis, **3+ images** | Imported earbuds, no country of origin | **Violation Detected** |

---

## Design principles

These are the decisions that shaped the code, and the ones worth defending in a
review.

**Three verdicts, never pass/fail.** `COMPLIANT | VIOLATION_DETECTED |
REVIEW_REQUIRED`. The third value is what the system reports when it is not
confident enough to assert either of the others. A compliance tool that can only
say yes or no forces the model to guess exactly where it should be escalating to
a human.

**AI output and human correction are separate fields, permanently.** Every
extracted declaration keeps `aiValue` (what the model read) alongside
`humanVerifiedValue`, `humanVerifiedBy` and `humanVerifiedAt`. The review
endpoint never overwrites the original reading. Destroying that distinction
would cost the enforcement record its evidence trail and the AI phase its
training signal. The web console shows both values side by side, always.

**Applicable rules are resolved, not hardcoded.** Which declarations are
mandatory depends on the product category. Both the API and the UI render
whatever the resolved rule set contains, and neither assumes MRP and net
quantity are the complete list.

**Three seams, one line of configuration each.** `OCRProvider`,
`AnalysisProvider` and `StorageProvider` are interfaces. Swapping the cloud OCR
API for a locally hosted model is `OCR_PROVIDER=…` plus one class in
`backend/src/services/ocr/`; moving off local disk is one `StorageProvider`
implementation. No controller, screen or type changes for any of them — which is
the whole reason they are seams rather than inline implementations.

**One service seam on the client.** No screen, store or component performs I/O
or knows a URL — everything routes through `mobile/src/services/api.ts`, which
owns the base URL, the auth header, the response envelope and the single-flight
token refresh. That is why Phase 2 changed the service layer and left the
screens intact.

**Built for field conditions.** The app is used outdoors, one-handed, often in
bright sunlight, sometimes with gloves: body text at ≥ 7:1 contrast, nothing
interactive under 48dp, and status never signalled by colour alone.

---

## Honesty about what this does and does not establish

A compliance tool that overstates its own certainty is worse than no tool. So:

**A clean scan never reads "compliant."** It reads *NO COMPLIANCE ISSUES
DETECTED IN THE CHECKS PERFORMED*, alongside the count of checks performed,
passed, not applicable, and not assessable. The system checks a photograph
against the subset of the Packaged Commodities Rules it implements; it cannot
weigh the package, measure letter heights, see faces nobody photographed, or
read a rule that is not in its corpus. Nothing anywhere claims "100% compliant",
"100% accurate", or "legally guaranteed".

**"Not detected" is never "not declared."** A declaration the OCR stage did not
find is a statement about the photograph. Whether its absence is a finding turns
on how much of the package was actually captured — one photograph of the front
face scores below the threshold at which the engine will record an absence as a
violation, so it becomes a review instead. Photograph four faces and the same
absence becomes a finding.

**No confidence is ever invented.** Where the OCR provider reports none, the
field carries none, and the engine treats a value of unknown reliability as a
question for a person rather than as a finding.

**Findings are never worded by this software.** Every legal string an inspector
reads — the requirement, the clause, the notification number, the Gazette text —
is copied verbatim from the rule corpus, with the official source URL beside it.

**No LLM makes any legal decision.** The rule engine is a pure function over a
versioned corpus; the extractor is regex and label matching. Both produce the
same answer every time, which is what makes an inspection defensible.

Specifically, this build still does **not**:

- take physical measurements — rules 7(2) and 7(3) (character height and width)
  report `MEASUREMENT_NOT_AVAILABLE`, are counted separately, and are kept out
  of the headline verdict
- weigh or measure the commodity, so it never asserts that a declared quantity
  is inaccurate — only that a declaration is present, absent, or not in a
  standard unit
- train, fine-tune or benchmark an OCR model — that is the next phase, and the
  `OCRProvider` interface exists so it lands without touching anything else
- generate PDFs server-side — the report renders as self-contained HTML, which
  is what the mobile app prints
- synchronise offline captures — inspections are submitted as the inspector
  works, and the queue abstraction is unused

---

## Verification

```bash
cd backend
npm run lint        # ESLint, clean
npm run typecheck   # tsc --noEmit, clean
npm test            # 76 tests, own in-memory MongoDB
npm run build       # compiles src/ to dist/

cd ../web
npm run lint        # ESLint, clean
npm run typecheck   # tsc --noEmit, clean
npm run build       # type-checks and builds to dist/

cd ../mobile
npm run typecheck   # tsc --noEmit, clean
```

The backend suite covers authentication and token rotation, the inspection
lifecycle and its authorization rules, image upload validation, the review
model's separation of AI and human values, profile and password changes, the
dashboard aggregations (including that they agree with the register they
summarise), the violation read model, the rule repository's versioning
contract, and a full sign-in-to-filed-report walkthrough.

---

## Tech stack

**Mobile** — React Native 0.81 · Expo SDK 54 · TypeScript 5.9 ·
React Navigation 7 · Zustand 5 · expo-camera · expo-image-picker ·
expo-secure-store

**Backend** — Node.js 20 · Express 4 · TypeScript 5.7 · MongoDB 7 ·
Mongoose 8 · JWT + bcrypt · Zod · Helmet · CORS · express-rate-limit ·
Pino · Multer · Vitest + Supertest

**Web** — React 18 · Vite 6 · TypeScript 5.7 · Tailwind CSS 3 ·
React Router 6 · TanStack Query 5 · Recharts 2 · Axios · Zustand 5 ·
lucide-react

**OCR** — Google Cloud Vision (`DOCUMENT_TEXT_DETECTION`), behind
`OCRProvider`, with deterministic fixtures for CI

**Next phase (planned)** — a benchmarked OCR model, self-hosted, behind the same
interface

---

## What the next phase picks up

Nothing on this list is a change to either client.

1. **Benchmark and self-host an OCR model.** Write one `OCRProvider`, register
   it, set `OCR_PROVIDER`. Because the provider is a parameter, the same
   photographs can be re-scanned through `POST /inspections/:id/scan` and the
   two verdicts compared directly — every evaluation is kept, each carrying the
   OCR provider and rule-set checksum it was produced under.
2. **Take the measurements.** Character height and width (rules 7(2) and 7(3))
   are the only checks the engine cannot currently assess. The evidence contract
   already carries `measurements` for them; nothing produces one yet.
3. **Add an object-storage `StorageProvider`** (S3, Cloudinary, GCS) beside the
   local-disk one.
4. **Render the report to PDF server-side.** The HTML report is already
   self-contained and print-styled; this is a rendering step, not a redesign.
5. **Push updates.** Query invalidation is already the console's update
   mechanism; a channel would invalidate the same keys.
