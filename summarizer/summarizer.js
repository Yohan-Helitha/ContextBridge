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

// ---------------------------------------------------------------------------
// Inference helpers (called from summarizer/worker.js)
// ---------------------------------------------------------------------------

/**
 * Run the BART encoder over tokenized input tensors.
 *
 * @param {object} session   ONNX InferenceSession for the encoder model
 * @param {{ input_ids: object, attention_mask: object }} inputTensors
 * @returns {Promise<object>}  last_hidden_state tensor  shape: [1, seq_len, 1024]
 */
export async function runEncoder(session, inputTensors) {
  const feeds = {
    input_ids:      inputTensors.input_ids,
    attention_mask: inputTensors.attention_mask,
  };
  const results = await session.run(feeds);
  return results['last_hidden_state'];
}

/**
 * Run the BART decoder autoregressively until EOS or maxNewTokens.
 * Uses greedy decoding (argmax at each step).
 *
 * @param {object} session               ONNX InferenceSession for the decoder model
 * @param {object} encoderHiddenStates   Output of runEncoder()
 * @param {object} attentionMask         attention_mask tensor from input
 * @param {object} ort                   The onnxruntime-web module
 * @param {object} [config]
 * @returns {Promise<number[]>}          Generated token id array (excluding BOS)
 */
export async function runDecoderLoop(session, encoderHiddenStates, attentionMask, ort, config = {}) {
  const {
    maxNewTokens    = 300,
    minNewTokens    = 80,
    eosTokenId      = 2,
    bosTokenId      = 2,
  } = config;

  let decoderInputIds = new ort.Tensor('int64', [BigInt(bosTokenId)], [1, 1]);
  const outputTokenIds = [];

  for (let step = 0; step < maxNewTokens; step++) {
    const feeds = {
      input_ids:              decoderInputIds,
      encoder_hidden_states:  encoderHiddenStates,
      encoder_attention_mask: attentionMask,
    };

    const results = await session.run(feeds);
    const logits = results['logits']; // shape: [1, seq_len, vocab_size]

    // Greedy decode: argmax of the last token's logit distribution
    const vocabSize = logits.dims[2];
    const nextTokenId = _argmax(logits.data, vocabSize);
    outputTokenIds.push(nextTokenId);

    if (nextTokenId === eosTokenId && outputTokenIds.length >= minNewTokens) break;

    // Extend decoder input with the new token
    const extended = new BigInt64Array(decoderInputIds.data.length + 1);
    extended.set(decoderInputIds.data);
    extended[extended.length - 1] = BigInt(nextTokenId);
    decoderInputIds = new ort.Tensor('int64', extended, [1, extended.length]);
  }

  return outputTokenIds;
}

/**
 * Return the index of the maximum value in the last vocab-sized slice of arr.
 * @param {Float32Array|number[]} arr
 * @param {number} vocabSize
 * @returns {number}
 */
function _argmax(arr, vocabSize) {
  const start = arr.length - vocabSize;
  let maxIdx = 0;
  let maxVal = -Infinity;
  for (let i = start; i < arr.length; i++) {
    if (arr[i] > maxVal) {
      maxVal = arr[i];
      maxIdx = i - start;
    }
  }
  return maxIdx;
}

/**
 * Decode a token-id array back to a human-readable string using the tokenizer.
 *
 * @param {number[]} tokenIds
 * @param {object}   tokenizer  The AutoTokenizer instance from preprocess.js
 * @returns {Promise<string>}
 */
export async function detokenize(tokenIds, tokenizer) {
  return tokenizer.decode(tokenIds, { skip_special_tokens: true });
}
