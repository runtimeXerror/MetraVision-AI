# Running the project

Commands only. Every path is from the repository root, `MetraVision-AI` (wherever you cloned it).

Shown as PowerShell. In Git Bash the only difference is the slashes
(`cd MetraVision-AI/...`) and `./.venv/Scripts/python.exe`.

---

## Everything at once

```powershell
cd MetraVision-AI
npm run dev
```

Starts MongoDB, the OCR service and the API in that order, waits for each to be
ready before starting the next, and stops all three on Ctrl-C.

Then, in a **second terminal**, whichever client you need:

```powershell
cd MetraVision-AI\mobile
npm start
```

```powershell
cd MetraVision-AI\web
npm run dev
```

---

## One service at a time

Use these when you are debugging a single piece. Start them in this order —
each one below needs the ones above it.

### 1. MongoDB — port 27017

```powershell
cd MetraVision-AI\backend
npm run db
```

Leave it running. Data lives in `backend\.mongo-data\` and survives restarts.

### 2. OCR service — port 8001

```powershell
cd MetraVision-AI\ocr-service
.venv\Scripts\python.exe -m uvicorn app:app --port 8001
```

Or, without the `cd` and without picking the interpreter yourself:

```powershell
cd MetraVision-AI
npm run dev:ocr
```

Wait for `OCR service ready` (about 4 seconds). Check it:

```powershell
curl http://localhost:8001/health
```

Keep it on **8001** — `backend\.env` has `OCR_SERVICE_URL=http://localhost:8001`.
On any other port the service runs fine and the backend cannot find it, so
`ocrServiceReachable` goes false and every scan fails.

### 3. Backend API — port 4000

```powershell
cd MetraVision-AI\backend
npm run dev
```

Check it:

```powershell
curl http://localhost:4000/api/health
```

Fails with `ECONNREFUSED 127.0.0.1:27017` if step 1 is not running.

### 4. Mobile app — Expo

```powershell
cd MetraVision-AI\mobile
npm start
```

Scan the QR code with Expo Go. The phone and the laptop must be on the same
Wi-Fi — the app derives the API address from the Expo host. If they cannot be,
use `npm run tunnel` instead.

### 5. Web dashboard — port 5173

```powershell
cd MetraVision-AI\web
npm run dev
```

Opens at http://localhost:5173 and proxies `/api` to the backend on 4000.

---

## First time on a machine

Once per machine, before any of the above.

```powershell
cd MetraVision-AI
npm run setup:ocr
```

Builds `ocr-service\.venv` and installs PaddleOCR. The first OCR start after
this downloads the model weights (a minute or two, needs a connection) and
caches them in `~\.paddlex\`; every start after that is offline.

```powershell
cd MetraVision-AI\backend
npm install
```

```powershell
cd MetraVision-AI\mobile
npm install
```

```powershell
cd MetraVision-AI\web
npm install
```

Copy `backend\.env.example` to `backend\.env`. Every value has a working
development default.

---

## Ports

| Service | Port | Started by |
|---|---|---|
| MongoDB | 27017 | `backend` → `npm run db` |
| OCR service | 8001 | `ocr-service` → uvicorn |
| Backend API | 4000 | `backend` → `npm run dev` |
| Web dashboard | 5173 | `web` → `npm run dev` |
| Expo | 8081 | `mobile` → `npm start` |

Check what is holding a port:

```powershell
netstat -ano | Select-String ":4000 " | Select-String LISTENING
```

---

## Tests

```powershell
cd MetraVision-AI\backend
npm test
```

```powershell
cd MetraVision-AI\backend
npm run typecheck
```

```powershell
cd MetraVision-AI\mobile
npm run typecheck
```

```powershell
cd MetraVision-AI\web
npm run typecheck
```
