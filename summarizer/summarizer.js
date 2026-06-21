// ContextBridge — ONNX Runtime Web Wrapper & Model Loader
// Manages caching and loading of the BART-large-CNN ONNX model (pro tier).
// Download orchestration lives in background.js (service worker context).
//
// onnxruntime-web is loaded via dynamic import inside loadModel() so that this
// module can be safely imported by background.js without triggering WASM
// initialisation. The ORT ESM bundle and its WASM companion files must be
// placed in summarizer/ at build time:
//   npm install onnxruntime-web
//   npm run copy-wasm   (copies ort-wasm*.wasm + ort.esm.min.js → summarizer/)

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Cache API namespace used for all model files.
 * Must match the value used in background.js download logic.
 */
export const CACHE_NAME = 'contextbridge-model-v1';

/**
 * Base URL for model file downloads.
 * This is the ONLY location in the codebase where the external model URL is defined.
 */
export const MODEL_BASE_URL =
  'https://huggingface.co/contextbridge/bart-large-onnx-quantized/resolve/main/';

/** Ordered list of model files to download and cache. */
export const MODEL_FILES = [
  'encoder_model_quantized.onnx',
  'decoder_model_merged_quantized.onnx',
  'config.json',
];

const ENCODER_FILE = 'encoder_model_quantized.onnx';
const DECODER_FILE = 'decoder_model_merged_quantized.onnx';

// ---------------------------------------------------------------------------
// Session state (module-level singleton — one load per browser session)
// ---------------------------------------------------------------------------

let encoderSession = null;
let decoderSession = null;

// ---------------------------------------------------------------------------
// Cache helpers
// ---------------------------------------------------------------------------

/**
 * Returns true if both encoder and decoder ONNX files are present in the
 * Cache API. Returns false if the Cache API is unavailable or files are missing.
 * @returns {Promise<boolean>}
 */
export async function isModelCached() {
  try {
    const cache = await caches.open(CACHE_NAME);
    const [encoderEntry, decoderEntry] = await Promise.all([
      cache.match(ENCODER_FILE),
      cache.match(DECODER_FILE),
    ]);
    return !!(encoderEntry && decoderEntry);
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Model loading
// ---------------------------------------------------------------------------

/**
 * Load encoder and decoder ONNX models from the Cache API into InferenceSession
 * objects. Must be called from a context where WASM execution is permitted
 * (e.g. a dedicated Web Worker — see summarizer/worker.js).
 *
 * Throws if the models are not yet cached — send DOWNLOAD_MODEL to background first.
 * @returns {Promise<{ encoderSession: object, decoderSession: object }>}
 */
export async function loadModel() {
  // Dynamic import keeps this module safe to import from service worker context.
  // At build time, ort.esm.min.js is copied to summarizer/ by the build script.
  const ort = await import(chrome.runtime.getURL('summarizer/ort.esm.min.js'));

  // Point ORT at its WASM companion files inside the extension package
  ort.env.wasm.wasmPaths = chrome.runtime.getURL('summarizer/');

  const cache = await caches.open(CACHE_NAME);
  const [encoderResponse, decoderResponse] = await Promise.all([
    cache.match(ENCODER_FILE),
    cache.match(DECODER_FILE),
  ]);

  if (!encoderResponse || !decoderResponse) {
    throw new Error(
      '[ContextBridge] Model not cached. Send DOWNLOAD_MODEL to background first.'
    );
  }

  const [encoderBuffer, decoderBuffer] = await Promise.all([
    encoderResponse.arrayBuffer(),
    decoderResponse.arrayBuffer(),
  ]);

  const sessionOptions = {
    executionProviders: ['wasm'],
    graphOptimizationLevel: 'all',
  };

  [encoderSession, decoderSession] = await Promise.all([
    ort.InferenceSession.create(encoderBuffer, sessionOptions),
    ort.InferenceSession.create(decoderBuffer, sessionOptions),
  ]);

  console.log('[ContextBridge] summarizer: encoder and decoder sessions loaded');
  return { encoderSession, decoderSession };
}

/**
 * Returns true if both ONNX InferenceSession objects are loaded in memory.
 * @returns {boolean}
 */
export function isModelLoaded() {
  return encoderSession !== null && decoderSession !== null;
}

/**
 * Returns the loaded encoder InferenceSession, or null if not yet loaded.
 * @returns {object|null}
 */
export function getEncoderSession() {
  return encoderSession;
}

/**
 * Returns the loaded decoder InferenceSession, or null if not yet loaded.
 * @returns {object|null}
 */
export function getDecoderSession() {
  return decoderSession;
}
