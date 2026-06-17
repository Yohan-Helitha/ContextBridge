# Step 06 — ONNX Model Infrastructure & Download

**Phase:** Core Mechanics — Summarizer  
**Status:** Not Started  
**Depends On:** Step 02 (background worker), Step 03 (content script)  

---

## Objective

Build the complete model management infrastructure: download, cache, and load the BART-large-CNN ONNX model (pro tier). At the end of this step, the model is downloaded once on first use, cached persistently via the Cache API, and ready to be passed to the inference pipeline in Step 07–08. The extension shows a real progress bar during download.

---

## Files Modified

| File | Action |
|---|---|
| `summarizer/summarizer.js` | Model loader + ONNX Runtime session wrapper |
| `background.js` | Wire `DOWNLOAD_MODEL` and `GET_MODEL_STATUS` actions |
| `ui/sidebar.html` + `ui/sidebar.css` | Download progress UI (used in onboarding and sidebar) |

---

## Model Specification (Pro Tier)

| Property | Value |
|---|---|
| Model | BART-large-CNN (abstractive summarization) |
| Format | ONNX, quantized int8 |
| Expected size | ~350–420 MB |
| Source | Hugging Face Hub (exported to ONNX via `optimum`) |
| Cache location | Browser Cache API — cache name: `'contextbridge-model-v1'` |
| Runtime | `onnxruntime-web` (WebAssembly backend) |

### Model Files Required

```
summarizer/models/
├── encoder_model_quantized.onnx
├── decoder_model_merged_quantized.onnx
└── config.json                          (tokenizer config)
```

BART uses an encoder-decoder architecture. Both ONNX files must be present. They are cached separately and loaded into two separate `InferenceSession` objects.

---

## Model Download Flow

```
DOWNLOAD_MODEL message received by background.js:
  1. Check Cache API: caches.open('contextbridge-model-v1')
  2. If both model files are cached → respond { status: 'ready' }, skip download
  3. Else:
     a. Notify content scripts: { type: 'CB_MODEL_DOWNLOAD_START' }
     b. Fetch encoder ONNX file with streaming
     c. Track progress → send { type: 'CB_MODEL_DOWNLOAD_PROGRESS', percent: N }
     d. Cache encoder with cache.put()
     e. Repeat for decoder file
     f. Notify: { type: 'CB_MODEL_DOWNLOAD_COMPLETE' }
     g. Update settings: modelStatus = 'ready'
```

---

## Progress Tracking

The Fetch API `response.body` is a `ReadableStream`. Tap it to report byte progress:

```js
async function fetchWithProgress(url, onProgress) {
  const response = await fetch(url);
  const contentLength = +response.headers.get('Content-Length');
  const reader = response.body.getReader();
  let received = 0;
  const chunks = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    const percent = contentLength ? Math.round((received / contentLength) * 100) : -1;
    onProgress(percent, received, contentLength);
  }

  const blob = new Blob(chunks);
  return new Response(blob, { headers: response.headers });
}
```

Progress messages are relayed to active content scripts via `chrome.tabs.sendMessage` to all matching tabs.

---

## Model Caching Strategy

```js
const CACHE_NAME = 'contextbridge-model-v1';

async function isModelCached() {
  const cache = await caches.open(CACHE_NAME);
  const encoderEntry = await cache.match('encoder_model_quantized.onnx');
  const decoderEntry = await cache.match('decoder_model_merged_quantized.onnx');
  return !!(encoderEntry && decoderEntry);
}

async function cacheModelFile(url, response) {
  const cache = await caches.open(CACHE_NAME);
  await cache.put(url, response);
}
```

**Important:** The Cache API is available in service workers and persists across browser sessions. It is NOT cleared when the user clears `chrome.storage.local`. It IS cleared if the user clicks "Clear browsing data → Cached images and files". The extension should handle this gracefully by re-running the download flow.

---

## ONNX Runtime Session Loading

```js
// summarizer/summarizer.js
import * as ort from 'onnxruntime-web';

let encoderSession = null;
let decoderSession = null;

export async function loadModel() {
  const cache = await caches.open('contextbridge-model-v1');
  
  const encoderResponse = await cache.match('encoder_model_quantized.onnx');
  const decoderResponse = await cache.match('decoder_model_merged_quantized.onnx');
  
  if (!encoderResponse || !decoderResponse) {
    throw new Error('Model not cached. Run download first.');
  }
  
  const encoderBuffer = await encoderResponse.arrayBuffer();
  const decoderBuffer = await decoderResponse.arrayBuffer();
  
  encoderSession = await ort.InferenceSession.create(encoderBuffer, {
    executionProviders: ['wasm'],
    graphOptimizationLevel: 'all',
  });
  
  decoderSession = await ort.InferenceSession.create(decoderBuffer, {
    executionProviders: ['wasm'],
    graphOptimizationLevel: 'all',
  });
  
  return { encoderSession, decoderSession };
}

export function isModelLoaded() {
  return encoderSession !== null && decoderSession !== null;
}
```

### ONNX Runtime Web — CSP Requirement

The manifest CSP must include `'wasm-unsafe-eval'` (already set in Step 01). Without this, ONNX Runtime Web cannot JIT-compile the WebAssembly.

### ONNX Runtime Web — Bundling

`onnxruntime-web` ships its own `.wasm` files that must be accessible. Set the `wasm` path resolver:

```js
ort.env.wasm.wasmPaths = chrome.runtime.getURL('summarizer/');
```

The `.wasm` files (`ort-wasm-simd.wasm`, etc.) must be listed in `manifest.json` under `web_accessible_resources`.

---

## Model Status State Machine

```
not-downloaded → (user triggers download) → downloading → ready
                                                        ↘ error → (retry) → downloading
ready → (cache cleared) → not-downloaded
```

Model status is persisted in `chrome.storage.local` under `cb_settings.modelStatus`.

---

## Memory Management

ONNX Runtime Web loads models into WebAssembly memory. On devices with <4GB RAM, the 400MB model may cause issues. Mitigation:
- Run inference in a dedicated Web Worker (implemented in Step 07) — this isolates memory from the main thread.
- After inference completes, do NOT keep sessions alive indefinitely. For now, sessions are loaded once and kept for the browser session. A future optimization would be to dispose and reload on demand.

---

## Model Source & Download URL

At build time, the model files will be hosted on a CDN (e.g., Hugging Face Hub or a dedicated ContextBridge CDN). The URL is configurable via a constant:

```js
const MODEL_BASE_URL = 'https://huggingface.co/contextbridge/bart-large-onnx-quantized/resolve/main/';
const MODEL_FILES = [
  'encoder_model_quantized.onnx',
  'decoder_model_merged_quantized.onnx',
  'config.json',
];
```

This constant lives in `summarizer/summarizer.js` and is the only place the external URL appears in the codebase.

**Security note:** The download is a one-time fetch to a trusted, versioned URL. The model file is not executed as code — it is loaded as binary data by ONNX Runtime. This is equivalent to downloading a resource file.

---

## Validation Checklist

- [ ] `isModelCached()` returns `false` on first install
- [ ] Clicking "Download Model" triggers the download flow with progress events
- [ ] Progress bar UI updates in real time during download (0% → 100%)
- [ ] Both encoder and decoder ONNX files are stored in Cache API after download
- [ ] On extension reload, `isModelCached()` returns `true` — no re-download
- [ ] `loadModel()` returns valid `InferenceSession` objects for both encoder and decoder
- [ ] If Cache API is cleared and extension is reloaded, `isModelCached()` returns `false` and download re-runs
- [ ] ONNX Runtime `.wasm` files are accessible at their `web_accessible_resources` paths
- [ ] No CSP errors during ONNX Runtime initialization
