# SIH26034 — Inspector Mobile App

Field inspector application for the **Packaged Commodities Compliance Scanner**.

React Native 0.81 · Expo SDK 54 · React 19 · TypeScript · React Navigation 7 · Zustand.

> **Phase 2.** The app now talks to the Node/Express + MongoDB backend in
> `../backend`. Authentication, inspections, image upload, review and reports are
> all real and persisted. The **analysis is still simulated** — it runs on the
> server, and no OCR or model inference is performed anywhere. Phase 3 replaces
> the backend's analysis provider; no mobile change is required.

---

## Quick start

**Start the backend first** — the app needs it:

```bash
cd backend && npm install && cp .env.example .env && npm run dev
```

Then:

```bash
cd mobile
npm install
npm start
```

> `.npmrc` sets `legacy-peer-deps=true`. React Navigation declares broad peer
> ranges that npm rejects against React 19, and Expo's own installers shell out
> to npm, so this has to be project config rather than a CLI flag.

Then press `a` for Android, `i` for iOS, or scan the QR code with Expo Go.

### Demo credentials

| Field | Value |
| --- | --- |
| Inspector ID | `LM-INS-4471` |
| Password | `Inspector@123` |

The login screen has a **Demo access** chip that fills these in — tap it rather
than typing during a presentation. `LM-INS-3308` and `LM-INS-5192` are the other
inspectors; `LM-SUP-1204` / `Supervisor@123` signs in as a supervisor and sees
every inspector's records.

These accounts come from `backend/src/seed/seed.ts`.

### Scripts

| Command | Purpose |
| --- | --- |
| `npm start` | Expo dev server |
| `npm run android` / `npm run ios` | Launch on a device or emulator |
| `npm run tunnel` | Dev server over a tunnel, for a device on another network |
| `npm run typecheck` | `tsc --noEmit` |
| `npx expo-doctor` | Validate the SDK 54 project setup (18 checks) |

---

## Demo flow

The full walkthrough, in order:

```
Login  →  Home  →  Start New Inspection  →  Inspection Details
      →  Capture Product Images  →  Image Quality Review
      →  Analysis  →  Compliance Result  →  Review (if required)
      →  Finalize  →  Inspection Report  →  History
```

### The four demo cases

Successive analyses rotate through scripted scenarios, so a demo shows every
verdict without needing specific photographs:

| Trigger | Scenario | Verdict |
| --- | --- | --- |
| 1st analysis (1–2 images) | Packaged atta, all declarations present | **Compliant** |
| 2nd analysis (1–2 images) | Namkeen missing consumer care + FSSAI licence | **Violation Detected** |
| 3rd analysis (1–2 images) | Worn cosmetic label, several uncertain reads | **Review Required** |
| Any analysis with **3+ images** | Imported earbuds, no country of origin | **Violation Detected** |

Capture three or more package faces to force the multi-image case. Seeded
history already contains all four.

---

## Architecture

```
mobile/
├── App.tsx                 Root: providers only
├── index.ts                Expo entry
└── src/
    ├── components/         ui · forms · domain · layout
    ├── screens/            One file per screen; auth/ and inspection/ subfolders
    ├── navigation/         Root stack + bottom tabs, fully typed
    ├── services/           ALL I/O lives here — the one seam
    │   ├── api.ts          The one HTTP client
    │   ├── aiService.ts    analyzeProduct() — the AI abstraction
    │   ├── authService.ts  Session issue / restore / revoke
    │   ├── inspectionService.ts
    │   ├── reportService.ts
    │   ├── mappers.ts      Backend DTOs → the app's own types
    │   └── storage.ts      SecureStore + offline-queue abstraction
    ├── store/              Five separate Zustand stores
    ├── hooks/              useAsync · useImageCapture
    ├── types/              enums · models · api — the shared contract
    ├── constants/          theme · labels · rules · config
    └── utils/              format · id · validation
```

### The service seam

No screen, store or component performs I/O or knows a URL. Everything routes
through `src/services/`, and every service goes through one HTTP client —
`src/services/api.ts`, which owns the base URL, the `Authorization` header,
the success/error envelope and the single-flight token refresh.

`src/services/aiService.ts` is the clearest example of why that seam matters:

```
Phase 1   analyzeProduct()  →  buildMockAnalysis()             on-device, removed
Phase 2   analyzeProduct()  →  POST /inspections/:id/analyze   Node/Express backend
                                  →  mock analyser
Phase 3   analyzeProduct()  →  POST /inspections/:id/analyze   unchanged
                                  →  Python/FastAPI AI service
                                        →  OCR / CV / VLM
```

The mobile app never learns which analyser answered — Phase 3 is a backend
configuration change (`ANALYSIS_PROVIDER=http`) and touches nothing here.

The Phase 1 mock service layer was deleted when the API landed; the remaining
flag is a diagnostic switch only and defaults to *off*:

```ts
// src/constants/config.ts
export const USE_MOCK_SERVICES = process.env.EXPO_PUBLIC_USE_MOCK === 'true';
```

### Five stores, not one

| Store | Owns |
| --- | --- |
| `authStore` | Session and inspector. The only store that survives sign-out. |
| `inspectionStore` | The draft being captured (details, reference, notes). |
| `imageStore` | Captured images and their quality assessments. |
| `analysisStore` | The analysis run and the inspector's review decisions. |
| `historyStore` | Filed inspections, filters and aggregate stats. |

Separated because the capture flow mutates image state on every shutter press,
and a list of completed inspections must not re-render because of it.

### AI result vs. human correction

`ExtractedField` keeps both, permanently:

```ts
aiValue: string | null       // what the model read — never overwritten
humanValue?: string | null   // what the inspector determined
reviewAction?: 'accepted' | 'edited' | 'marked_unavailable'
```

Collapsing these would destroy the evidence trail an enforcement record needs,
and the training signal Phase 3 wants. The result and report screens show both.

### Three verdicts, never pass/fail

`ComplianceStatus` is `compliant | violation | review_required`. The third value
is what the system reports when it is not confident enough to assert either of
the others — it is the reason the human review flow exists. A missing mandatory
declaration outranks uncertainty and always yields `violation`.

### Rules are resolved, not hardcoded

The backend resolves which declarations a category requires, and every verdict
arrives carrying the rule set it was assessed against — `ruleSetId` and
`ruleSetLabel` on `ComplianceResult`, shown on the result screen. The UI renders
whatever fields that set contains and never assumes MRP, net quantity and the
rest are the complete list.

Phase 1 kept a presentation-side copy of the same table in
`src/constants/rules.ts` so the screen could be category-aware with no server.
That copy was **deleted** when the API landed, as its own note said it should
be: a second copy of the law on the client can only drift out of step with the
one that actually decided the outcome. Only `REVIEW_CONFIDENCE_THRESHOLD`
remains, and it governs presentation order in the review screen.

---

## Pointing the app at the backend

**Try it with no configuration first.** With `EXPO_PUBLIC_API_URL` empty,
`src/constants/config.ts` derives the API host from the Expo dev-server address
the app was loaded from, which is already correct for a physical device on the
same Wi-Fi and for the Android emulator. `localhost` on a phone means *the
phone*, which is the single most common reason a demo fails to connect.

Set it explicitly only when the backend is not on the machine serving Metro:

| Running on | `EXPO_PUBLIC_API_URL` |
| --- | --- |
| **Android emulator** | `http://10.0.2.2:4000/api` — `10.0.2.2` is the emulator's alias for the host |
| **iOS simulator** | `http://localhost:4000/api` — shares the host's network stack |
| **Physical device** (Expo Go) | `http://<your-LAN-IP>:4000/api`, e.g. `http://192.168.1.7:4000/api` |
| **`expo start --web`** | `http://localhost:4000/api` |
| **Deployed backend** | `https://api.example.gov.in/api` |

`npm run dev` in `backend/` prints the LAN address to use:

```
API listening on http://localhost:4000/api
  reachable from a device at http://192.168.1.7:4000/api
```

Copy `.env.example` to `.env` to set it. Restart Metro after changing it —
`EXPO_PUBLIC_*` variables are inlined at bundle time.

### If the app cannot connect

- Phone and laptop must be on the **same Wi-Fi**, and it must not be a guest
  network with client isolation.
- Windows Firewall commonly blocks inbound :4000. Allow Node through it, or use
  `npx expo start --tunnel`.
- Check the backend is up: open `http://<LAN-IP>:4000/api/health` in the phone's
  browser. If that fails, the app will fail too.

---

## Error and empty states

Every async operation is modelled as an exhaustive union
(`AsyncState<T>` in `src/types/api.ts`), so a screen cannot silently render
nothing. `ApiError` carries a `kind` (`network`, `timeout`, `unauthorized`,
`upload_failed`, `analysis_failed`, …) and a `retryable` flag that decides
whether a Retry button appears.

Covered states: loading skeletons, empty lists, network failure, analysis
failure, low confidence, permission denial, and missing source images.

---

## Design notes

The app is used outdoors, one-handed, often in bright sunlight, sometimes with
gloves. Three rules drive the design system in `src/constants/theme.ts`:

1. **High contrast over subtlety** — body text sits at ≥ 7:1 on its surface.
2. **Large touch targets** — nothing interactive is under 48dp.
3. **Status is never colour-only** — every badge pairs a tint with a label and
   an icon, so a red/green colour-blind inspector still reads the verdict.

A fourth rule follows from the first three: **a figure on screen is a way into
the records behind it.** Each overview tile sets the history filter that matches
the number it shows, clearing any leftover search first, so tapping "Violations"
opens exactly the records that were counted.

And a fifth: **the phone knows things the inspector should not have to type.**
Step 1 fills the location from the device's GPS and the address that fix
reverse-geocodes to. What it fills stays editable — a reverse-geocode returns
the nearest thing the map knows about, which in a market row is routinely the
wrong shop — and correcting the address never discards the coordinates. The fix
is the evidence of where the officer stood; the address is a label for it, and
the two are allowed to disagree. District and state are captured alongside,
because those are what the console's reports are grouped by.

---

## What this build deliberately does not do

- No OCR, computer vision or model inference. The analysis runs on the server
  and is scripted there; the UI says so wherever a result is shown.
- No real rule engine. The verdict comes from a small declared-fields table in
  the backend, not from an interpretation of the law.
- No PDF generation. `exportReportPdf()` throws a clear message rather than
  returning a stub, so nothing can be mistaken for a working download.
- No offline sync. Inspections are submitted to the server as the inspector
  works, so `offlineQueue` in `src/services/storage.ts` is never written to.
- No password reset. `requestPasswordReset()` explains that a supervisor resets
  it, rather than reporting a success no mail relay will honour.
- No web dashboard.

## SDK 54 notes

Two platform behaviours changed with SDK 54 and are handled explicitly:

**Android is always edge-to-edge.** The system gesture bar now overlays the app,
so the bottom tab bar derives its height from `useSafeAreaInsets()` rather than
a hardcoded per-platform number (`src/navigation/TabNavigator.tsx`). `ActionBar`
in `components/layout.tsx` pays the same inset.

**`expo-camera` hardcodes `RECORD_AUDIO`** in its own native manifest, for the
video mode this app never uses. `android.blockedPermissions` in `app.json`
strips it from the merged manifest — a government inspection app must not
request a microphone it never touches.

Also on SDK 54: the legacy top-level `splash` key is replaced by the
`expo-splash-screen` config plugin, and `expo-font` is now a required direct
dependency of `@expo/vector-icons`.

---

## Phase 3 checklist

Nothing on this list is a mobile change — which was the point of the service
seam.

1. **Real OCR.** Set `ANALYSIS_PROVIDER=http` and `AI_SERVICE_URL` in the
   backend. The app keeps calling `POST /inspections/:id/analyze` and never
   learns which analyser answered.
2. **Real rule engine.** Replace the backend `complianceService` implementation
   behind the same interface.
3. **Object storage.** Add a `StorageProvider` for S3 or Cloudinary; image URLs
   are already resolved through `assetUrl()`, so remote URLs need no change.
4. **Shared types.** Move `src/types/` and `src/utils/format.ts` into a package
   the web dashboard also consumes — both are dependency-free for this reason.
5. **Offline sync.** Enqueue on a `network` `ApiError` and drain `offlineQueue`
   on reconnect. This one does need screen work, to show queued state.
