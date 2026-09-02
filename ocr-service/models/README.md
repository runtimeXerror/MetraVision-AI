# Model weights

**Nothing in this repository trains a model, and no weights are committed here.**

PaddleOCR downloads the official pretrained PP-OCRv5 weights on first use and
caches them outside the project tree — by default under `~/.paddlex/` on Linux
and macOS, and `C:\Users\<you>\.paddlex\` on Windows. That first run needs a
network connection and takes a minute or two; every run after it is offline.

Three models are fetched for the default configuration:

| Role | What it does | Why this one |
|---|---|---|
| **Text detection** (`PP-OCRv5_mobile_det`) | Finds the quadrilateral around each line of text | Trained on photographs rather than scans, which is what a label held up in a shop is |
| **Text recognition** (`PP-OCRv5_mobile_rec`) | Reads the pixels inside one box into characters | Handles the small, dense, low-contrast print that mandatory declarations are set in |
| **Text-line orientation** (`PP-LCNet_x1_0_textline_ori`) | Detects a line printed upside down or sideways and rotates it | Net-quantity and batch declarations are routinely printed rotated on pouches and sachets |

Document orientation and document unwarping are **disabled**, so their weights
are never downloaded. Both assume a rectangular page filling the frame; a close
photograph of a curved packet is not one, and unwarping distorts it into
something the detector reads worse. See the header of `services/ocr_service.py`.

## Changing the models

Everything is chosen through `PaddleOCR(...)` in `services/ocr_service.py`, and
through two environment variables:

- `OCR_LANG` — the primary recognition language (default `en`).
- `OCR_SECONDARY_LANG` — an optional second pass for a different script, e.g.
  `devanagari` for Hindi declarations. Empty by default because it roughly
  doubles inference time.

The mobile models are the default because they run at a usable speed on a CPU.
Swapping to the `server` variants (`PP-OCRv5_server_det` / `_rec`) buys a few
points of accuracy on difficult labels for several times the latency; pass them
explicitly to `PaddleOCR(text_detection_model_name=..., text_recognition_model_name=...)`
if a deployment has the hardware for it.

## Offline / air-gapped installs

Run the service once on a machine with a network connection, then copy the
`.paddlex` cache directory to the target machine, or point `PADDLE_PDX_CACHE_HOME`
at a shared location. There is no build step and no conversion — the cache is
the artefact.
