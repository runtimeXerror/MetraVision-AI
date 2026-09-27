# MetraVision AI — Supervisor Dashboard

Web console for the **Packaged Commodities Compliance Scanner**.

React 18 · TypeScript · Vite 6 · Tailwind CSS · React Router 6 · TanStack Query 5 · Recharts · Axios

> **Phase 3.** This console reads the same Node/Express + MongoDB backend the
> mobile app writes to. There is no second database and no second identity
> system. **Analysis is still simulated** — no OCR, no vision model, no Python
> service. Every figure shown is a real aggregation over real records; the
> *readings* those records contain are scripted.

---

## Quick start

**Start the backend first** — the console is useless without it:

```bash
cd backend && npm install && cp .env.example .env && npm run dev
```

Then:

```bash
cd web
npm install
npm run dev
```

Open **http://localhost:5173**.

No configuration is needed locally: the Vite dev server proxies `/api` and
`/uploads` to `http://localhost:4000`, so the browser talks to its own origin
and there is no CORS to arrange.

### Demo accounts

| Role | Identifier | Password | Sees |
| --- | --- | --- | --- |
| **Supervisor** | `meera.nair@legalmetrology.gov.in` | `Supervisor@123` | Every inspection in the department |
| **Administrator** | `admin@legalmetrology.gov.in` | `Admin@1234` | Everything, plus rule authoring |
| Inspector | `LM-INS-4471` | `Inspector@123` | Only their own records |

The login page lists these and fills them in on a click. Sign in as the
inspector to see role scoping working: the roster disappears from the sidebar,
`/inspectors` is refused, and every count drops to that officer's own work.

### Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Vite dev server on :5173, proxying to the backend |
| `npm run build` | Type-check and build to `dist/` |
| `npm run preview` | Serve the production build |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint |

---

## Environment

Copy `.env.example` to `.env`. Both values are optional locally.

| Variable | Purpose |
| --- | --- |
| `VITE_API_URL` | Backend base URL **including `/api`**. Leave empty in development — the dev-server proxy handles it. Set it for a deployed build, e.g. `https://api.legalmetrology.gov.in/api`. |
| `VITE_PROXY_TARGET` | Where the dev server forwards `/api` and `/uploads`. Defaults to `http://localhost:4000`; change it if the backend runs on another port. |

Only `VITE_`-prefixed variables reach the browser bundle. There are no
credentials of any kind in this project, and the console never connects to
MongoDB — it only ever talks to the API.

---

## Routes

| Route | Page | Minimum role |
| --- | --- | --- |
| `/login` | Sign-in | — |
| `/dashboard` | KPIs, trend, distribution, findings, districts | Any |
| `/inspections` | The inspection register | Any |
| `/inspections/:id` | Record: overview · images · AI analysis · compliance · review · report | Any |
| `/reviews` | Review queue — records the analyser escalated | Any |
| `/violations` | Findings register with severity and case status | Any |
| `/violations/:id` | One finding, its evidence and its timeline | Any |
| `/inspectors` | Roster and activity | **Supervisor** |
| `/inspectors/:id` | One officer's record | **Supervisor** |
| `/products` | Commodities, rolled up from inspection history | Any |
| `/rules` | Rule repository | Any (authoring: **Admin**) |
| `/rules/:id` | One rule and its version history | Any |
| `/reports` | Reportable records and department summaries | Any |
| `/profile` | Account, profile edit, password change | Any |
| `/settings` | Preferences and system information | Any |

Inspectors see a *narrower* dataset on every shared route — the API scopes it
from their token, not from anything the browser sends.

---

## Architecture

```
web/
├── src/
│   ├── components/
│   │   ├── ui/          primitives · states · table · forms
│   │   ├── charts/      every Recharts chart, in one file
│   │   └── domain/      badges · EvidencePanel · FilterBar
│   ├── pages/           one file per route
│   ├── layouts/         AppShell · Sidebar · Header · GlobalSearch
│   ├── routes/          route table + guards
│   ├── services/        ALL I/O — one file per resource
│   ├── hooks/           useDebounced · useFilters
│   ├── store/           auth + UI preferences (Zustand)
│   ├── types/           the API contract
│   └── utils/           cn · format
└── public/
```

### One HTTP client

No component constructs a URL, sets a header or reads a status code. Everything
goes through `services/client.ts`, which owns the base URL, the `Authorization`
header, the success/error envelope, the error taxonomy and a **single-flight**
token refresh.

Single-flight matters: the dashboard opens several queries at once, so an
expired token produces a burst of 401s. Without it each would refresh
independently and the backend's token rotation would revoke the token the others
were still using — signing the supervisor out exactly when the session was
recoverable.

### Server state belongs to TanStack Query

The only global store is authentication. Everything else the console displays is
server state, and duplicating it into Zustand would mean two caches and one of
them going stale. Mutations invalidate the queries they affect, which is also
what makes the console **real-time ready**: when a push channel exists, it
invalidates the same keys and every affected view updates.

### Filters live in the URL

`useFilters` keeps filter state in the query string, so a view narrowed to one
district and one month is something a supervisor can bookmark, send to a
colleague, and still have after opening a record and pressing Back.

### The dashboard does no arithmetic

Every figure is aggregated in MongoDB and arrives ready to render. A second
definition of "compliance rate" living in the browser would drift from the one
the API reports, and only one of them can be right.

Note what the API deliberately *does*: `complianceRate` is computed over
**assessed** records only. A dashboard that counted drafts as non-compliant
would show a rate that falls whenever an inspector opens a form.

---

## The evidence panel

The component that matters most is `components/domain/EvidencePanel.tsx`.

A supervisor asked to endorse "MRP not declared" has to be able to see the face
of the package and *where on it* the analyser looked — otherwise they are
endorsing the model, not the evidence. Bounding boxes arrive in the analyser's
own coordinate space (`aiAnalysis.bboxSpace`) and are drawn as percentages, so
they stay correct at any rendered size.

Seeded inspections carry **synthetic label images**, generated by the backend in
that same 800×1000 space with each declaration drawn at the box the analyser
reports. The overlay therefore lands on text that is actually there — and a
missing declaration is visibly missing. The labels are watermarked
`SIMULATED LABEL · NOT A PHOTOGRAPH`; nothing here should be mistakable for a
real package.

---

## Honesty about what is simulated

Every surface that shows a result says where it came from. The AI Analysis tab
opens with a notice that the values are a machine extraction and not a legal
determination; the dashboard and the result views carry the same disclosure;
Settings reports the live analysis provider from `/api/health`.

This console does **not**:

- perform OCR, computer vision or model inference, or call any Python service
- apply the real Legal Metrology rule engine — verdicts come from a small
  declared-fields table on the backend
- generate PDFs. The download and share actions on `/reports` are inert, and
  labelled as such. A browser-side PDF of an enforcement record would be built
  from whatever the operator's screen happened to contain, which is the wrong
  provenance for a document that may be served on a dealer.
- carry its own copy of the law. The rule repository is API-backed; there is no
  rule table anywhere in `src/`.

---

## Accessibility and responsiveness

Desktop-first, as the brief specifies — field work belongs to the mobile app —
but the layout holds all the way down to a 360px phone, and it is a supervisor
checking one case on the way somewhere, not a shrunken desktop.

Below `md` every register table restacks: the header row is dropped and each row
becomes a card of `label · value` lines, with the reference or name as its
title. The same markup is a real table from `md` up — `TD` takes a `label` prop
that only the stacked layout renders, and its value wrapper becomes
`display: contents` at the breakpoint, so the wide layout is byte-for-byte what
it always was. Below `sm` the header search collapses to an icon that opens over
the header row, the filter bar folds behind a **Filters** button that reports
how many are applied, pagination trades its numbered window for a page counter,
and the rail becomes a slide-over that locks the page behind it.

Two chart properties Recharts takes as props rather than CSS — the category axis
width and the tick angle — are switched on a media query through `useIsNarrow`;
everything else responds through Tailwind classes alone.

Filters that grow with the data — categories, the inspector roster, states,
districts — use `SearchableSelect` rather than a native `<select>`: sorted
alphabetically, filterable by typing, and capped at five visible rows so the
control is the same height whether it offers three districts or three hundred.
The short fixed lists (status, severity, date range) stay native, where the
browser's own keyboard behaviour and mobile picker are worth more than a
consistent popover. Rows per page lives in the URL beside the page number,
defaulting to 10.

State and district are one filter pair, not two independent ones: choosing a
state narrows the district list to that state and clears a district that no
longer belongs to it, because a pairing that matches nothing reads as "no
records" rather than as a filter contradicting itself.

Status is never signalled by colour alone: every badge carries an icon or a dot
and a text label. Focus rings are visible throughout — this is a keyboard-driven
back-office tool, and a supervisor tabbing a review queue needs to know where
they are. `prefers-reduced-motion` is honoured.

Light and dark are the same class names against a different set of CSS custom
properties, so the two cannot drift apart one hardcoded colour at a time. The
charts read their palette from those same properties and re-read it when the
theme flips.

---

## Security

Route guards are a **usability** boundary, not a security one — a guard in the
browser can be edited away by whoever holds the browser. The API independently
refuses anything the caller is not entitled to, and that is the real boundary.
What the guards buy is that a user is never shown a door that will not open.

- Sessions are held in `sessionStorage` and end when the tab closes. This is a
  shared-workstation tool; a token that outlives the person who signed in is a
  liability.
- An expired access token is refreshed once and the request replayed. A refresh
  that fails clears the session and routes to sign-in.
- A 429 is surfaced rather than retried — hammering a limiter is what triggers
  it.
- No secrets, no database credentials, no direct MongoDB access.

---

## What Phase 4 picks up

Nothing on this list is a change to this console.

1. **Real OCR.** The backend sets `ANALYSIS_PROVIDER=http`; readings start
   arriving from the Python service with a real `engine` and `bboxSpace`, and
   the evidence overlay draws them unchanged.
2. **Real rule engine.** `complianceService` is replaced behind its interface.
   The rule repository already models versioned, dated requirements for it.
3. **Server-side PDF**, rendered from the payload `/inspections/:id/report`
   already returns.
4. **Push updates.** Query invalidation is already the update mechanism; a
   channel would invalidate the same keys.
