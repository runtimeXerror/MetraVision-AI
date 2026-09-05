# OCR service

PaddleOCR reading packaged-commodity labels, behind a small HTTP API.

```
POST /ocr       multipart image  →  text + bounding boxes + confidence
GET  /health    readiness, engine version, configured languages
```

This service reads pixels. It does not know what an MRP is, which declarations
the law requires, or what a missing one means — every judgement belongs to the
rule engine in `backend/src/compliance/`, one process away. See
[`docs/ocr-pipeline.md`](../docs/ocr-pipeline.md) for how the whole pipeline fits
together.

## Running it

From the repository root, one command starts this service and the API together
and waits for the model to be ready before the API accepts requests:

```bash
npm run setup:ocr   # first time on a machine: builds .venv, installs PaddleOCR
npm run dev         # every time after that
```

To run this service on its own — debugging it, or pointing a second backend at
it — start it directly:

```bash
cd ocr-service
python -m venv .venv
.venv/Scripts/python -m pip install -r requirements.txt      # Windows
# .venv/bin/python -m pip install -r requirements.txt        # macOS / Linux

.venv/Scripts/python -m uvicorn app:app --port 8001
v\Scripts\python.exe -m uvicorn app:app --port 8001
```

The **first start downloads the pretrained weights** (a minute or two, needs a
network connection) and caches them in `~/.paddlex/`. Every start after that is
offline and takes about four seconds. Wait for `OCR service ready` before
scanning — the backend's `GET /api/inspections/scan/status` reports
`ocrServiceReachable` and tells you if it is not.

Then the backend, with `OCR_PROVIDER=paddle` and `OCR_SERVICE_URL` pointing
here (both are the defaults in `.env.example`):

```bash
cd backend && npm run dev
```

## Why a separate process

PaddleOCR is Python; the backend is TypeScript. Porting the backend would
rewrite a working system, and shelling out to a script per request would pay
the model-load cost — several seconds and about a gigabyte — on every scan. A
long-lived sidecar holds the weights in memory and answers over HTTP, and the
backend needs to know nothing about Paddle beyond this contract.

Keep it on localhost. It holds inspection photographs in memory and has no
authentication of its own; it is meant to sit behind the backend on the same
host. Exposing it puts a network boundary in front of evidence about a named
trader, and that boundary has to be secured separately.

## The response

```jsonc
{
  "success": true,
  "fullText": "Net Quantity: 5 kg\nMRP ₹315.00 (incl. of all taxes)",
  "lines": [
    {
      "text": "Net Quantity: 5 kg",
      "confidence": 0.9716,
      "boundingBox": { "x": 65, "y": 222, "width": 279, "height": 48 },
      "polygon": [[66, 222], [344, 226], [343, 270], [65, 265]]
    }
  ],
  "metadata": {
    "imageWidth": 900, "imageHeight": 1200,
    "processingTimeMs": 2359,
    "engine": "paddleocr",
    "engineVersion": "en_PP-OCRv5_mobile_rec/paddleocr-3.7.0",
    "models": ["PP-OCRv5_mobile_det+en_PP-OCRv5_mobile_rec (en)"],
    "languages": ["en"],
    "preprocessing": [],
    "lineCount": 12,
    "meanConfidence": 0.9921
  }
}
```

Two properties of this payload are load-bearing downstream, and both are easy
to break by being helpful:

- **`confidence` is absent, not defaulted, when the engine supplied none.** The
  rule engine reads an absent confidence as *reliability unknown* and routes a
  failed check to review instead of recording a violation. A default of `1.0`
  would turn a guess into a finding against a trader.
- **Text is verbatim.** Rule 6 tests wording — the declaration has to *say*
  what the law requires. Expanding `M.R.P.`, normalising `₹` to `Rs.`, or
  tidying `Net Qty.` changes what the rule engine is shown. Normalisation is
  the extractor's job, and it is written knowing it receives raw OCR.

`polygon` is the quadrilateral actually detected; `boundingBox` is its
axis-aligned envelope, which is what an overlay can draw. Both are in the
coordinate frame of the **original** image, so they land correctly on the
stored evidence photograph even when the read happened on a downscaled copy.

## Errors

The status codes are a taxonomy, not decoration — the backend maps each to a
different outcome for the inspection.

| Status | Meaning | What the backend does |
|---|---|---|
| `200` + `lines: []` | Read worked, found no text | Inspection stops with `NO_TEXT_DETECTED`, retryable |
| `400` | Not a decodable image, or an unsupported type | `OCR_IMAGE_REJECTED` — retake the photograph |
| `413` | Larger than `MAX_UPLOAD_MB` | `OCR_IMAGE_REJECTED` |
| `503` | The engine is unavailable | `OCR_FAILED` — scan abandoned, inspection kept as `DRAFT` |
| *(not running)* | Nothing listening on the port | `OCR_SERVICE_DOWN`, naming the command to start it |

The first row is the one that must never collapse into the others, in either
direction. "The OCR service is down" and "this package carries no
declarations" lead to opposite conclusions about a trader, so a failed read is
never returned as an empty one, and an empty one is never returned as an error.

## Configuration

| Variable | Default | Notes |
|---|---|---|
| `OCR_LANG` | `en` | Primary recognition language |
| `OCR_SECONDARY_LANG` | *(empty)* | A second pass for another script — `hi` for Devanagari. Roughly doubles inference time |
| `OCR_DET_MODEL` | `PP-OCRv5_mobile_det` | Detection weights |
| `OCR_REC_MODEL` | `en_PP-OCRv5_mobile_rec` | Recognition weights |
| `OCR_MIN_CONFIDENCE` | `0.30` | Readings below this are dropped as noise |
| `MAX_UPLOAD_MB` | `12` | Matches the backend's limit |
| `LOG_LEVEL` | `INFO` | |

### Hindi and bilingual labels

Indian packaging is routinely English and Devanagari on the same face. One
engine recognises one script family, so `OCR_SECONDARY_LANG=hi` loads a second
one and merges its lines in — kept only where they do **not** overlap a line
the primary pass already read, because a Devanagari recogniser handed "MRP"
returns a confident wrong answer.

Note that PP-OCRv6 has no Devanagari recogniser, so Hindi resolves to the
PP-OCRv5 model automatically. `services/ocr_service.py` asks for the newest
generation first and falls back a version at a time, rather than hard-coding
which language needs which — that mapping changes with every release.

### Model choice

The default is the PP-OCRv5 **mobile** pair rather than PaddleOCR's own default
(the heavier PP-OCRv6 medium pair). Measured on this project's label set —
clear, blurry, rotated 12°, low contrast, low resolution and small print, on a
12-core CPU:

| Models | Per image | Declarations found |
|---|---|---|
| PP-OCRv5 mobile | 2.0–2.8s | all |
| PP-OCRv6 medium | 4.8–7.8s | all |

Identical extraction for ~2.7× the time. An inspection is up to four
photographs read sequentially — 9s against 27s — and the backend gives up at
`OCR_TIMEOUT_MS`, 20 seconds. The faster pair is the one that fits.

That is a default, not a verdict: v6 is newer and in principle stronger, and
those labels are rendered rather than photographed. Set `OCR_DET_MODEL` and
`OCR_REC_MODEL` to compare on real photographs, and raise the backend timeout
if v6 wins on them.

## Tests

```bash
.venv/Scripts/python -m pip install -r requirements-dev.txt
.venv/Scripts/python -m pytest            # fast: 25 tests, no model, ~3s
.venv/Scripts/python -m pytest -m slow    # 16 tests, real inference, ~45s
```

The fast suite covers the wire format and image handling — the rules about
confidence, verbatim text and coordinate frames — without loading a model. The
slow suite reads rendered labels at six difficulty levels and asserts that
every mandatory declaration comes back, that a blank surface reads as nothing
rather than as a failure, and that boxes land inside the original frame.

Those labels are rendered, so treat the slow suite as a regression test rather
than an accuracy benchmark. Field accuracy is judged on real photographs.

## Upgrading PaddlePaddle

`paddlepaddle` is pinned to **3.1.1**, below its latest release, and the pin is
deliberate. On 3.3.1 every model here crashes as soon as the oneDNN CPU backend
is active:

```
NotImplementedError: (Unimplemented) ConvertPirAttribute2RuntimeAttribute
not support [pir::ArrayAttribute<pir::DoubleAttribute>]
```

The only way to run 3.3.1 is with oneDNN disabled, which costs a factor of
twenty — 42s per label instead of 2s, past the backend's timeout before a
second image is read. Re-test on each release and raise the pin when it is
fixed upstream; `requirements.txt` carries the one-line check.
