// ContextBridge — Summarizer Preprocessing
// Formats, truncates, and tokenizes scraped conversation messages
// into ONNX-ready input tensors for the BART encoder.
//
// Pipeline:
//   Message[]  →  formatConversation()  →  truncateToTokenLimit()
//             →  tokenize()  →  toOnnxTensors()  →  InputTensors

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Pro-tier effective token budget (chunked input). */
const MAX_TOKENS_PRO = 4096;

/**
 * Instruction prefix prepended to every conversation.
 * Nudges BART toward structured output — the postprocess regex is the real
 * guarantor of structure, but the prefix helps.
 */
const SUMMARIZE_PREFIX =
  'Summarize this AI tutoring conversation using exactly these markers:\n' +
  '[TOPIC] [COVERED] [LAST POINT] [OPEN THREADS] [CONTINUE FROM]\n\n' +
  'Conversation:\n';

// ---------------------------------------------------------------------------
// Tokenizer singleton (lazily loaded inside worker context)
// ---------------------------------------------------------------------------

let _tokenizer = null;

/**
 * Return the cached AutoTokenizer, loading it on first call.
 * Uses @xenova/transformers bundled into the extension at build time.
 *
 * In the worker the transformers ESM bundle is available at:
 *   chrome.runtime.getURL('summarizer/transformers.min.js')
 *
 * @returns {Promise<object>}
 */
export async function getTokenizer() {
  if (_tokenizer) return _tokenizer;

  // Dynamic import of the bundled Transformers.js — only available in worker context.
  const { AutoTokenizer, env } = await import(
    /* webpackIgnore: true */
    self.location
      ? new URL('transformers.min.js', self.location.href).href
      : chrome.runtime.getURL('summarizer/transformers.min.js')
  );

  // Keep tokenizer files local — no outbound network for the tokenizer JSON files.
  // They are bundled inside the extension package under summarizer/tokenizer/.
  env.localModelPath = (
    self.location
      ? new URL('tokenizer/', self.location.href).href
      : chrome.runtime.getURL('summarizer/tokenizer/')
  );
  env.allowRemoteModels = false;

  _tokenizer = await AutoTokenizer.from_pretrained('facebook/bart-large-cnn');
  return _tokenizer;
}

// ---------------------------------------------------------------------------
// Step 1: Format conversation
// ---------------------------------------------------------------------------

/**
 * Convert a Message[] array into a single text string with speaker labels,
 * prepended with the BART instruction prefix.
 *
 * @param {Array<{role: 'user'|'assistant', text: string}>} messages
 * @returns {string}
 */
export function formatConversation(messages) {
  if (!messages || messages.length === 0) return SUMMARIZE_PREFIX;

  const body = messages
    .map(msg => {
      const speaker = msg.role === 'user' ? 'User' : 'Assistant';
      return `${speaker}: ${msg.text}`;
    })
    .join('\n\n');

  return SUMMARIZE_PREFIX + body;
}

// ---------------------------------------------------------------------------
// Step 2: Token-limit truncation
// ---------------------------------------------------------------------------

/**
 * Truncate text to fit within the pro-tier token budget.
 * Preserves the first 10% (topic intro), last 30% (recent context), and
 * fills the middle with the newest available content.
 * Inserts a truncation marker where content is omitted.
 *
 * @param {string} text
 * @param {number} [maxTokens=4096]
 * @returns {string}
 */
export function truncateToTokenLimit(text, maxTokens = MAX_TOKENS_PRO) {
  const words = text.split(/\s+/);
  // Conservative estimate: 1 token ≈ 0.75 words
  const maxWords = Math.floor(maxTokens * 0.75);
  if (words.length <= maxWords) return text;

  const keepFirst = Math.floor(maxWords * 0.10);
  const keepLast  = Math.floor(maxWords * 0.30);
  const keepMid   = maxWords - keepFirst - keepLast;

  const firstPart = words.slice(0, keepFirst).join(' ');
  const lastPart  = words.slice(-keepLast).join(' ');

  // Middle: take newest content that fits (just before the last segment)
  const midStart = Math.max(keepFirst, words.length - keepLast - keepMid);
  const midEnd   = words.length - keepLast;
  const midPart  = words.slice(midStart, midEnd).join(' ');

  return `${firstPart}\n\n[...earlier conversation truncated...]\n\n${midPart}\n\n${lastPart}`;
}

// ---------------------------------------------------------------------------
// Step 3: Tokenization
// ---------------------------------------------------------------------------

/**
 * Tokenize text using the BART BPE tokenizer.
 * Returns raw encoded output with typed-array fields.
 *
 * @param {string} text
 * @returns {Promise<{input_ids: object, attention_mask: object}>}
 */
export async function tokenize(text) {
  const tok = await getTokenizer();
  const encoded = tok(text, {
    max_length: MAX_TOKENS_PRO,
    truncation: true,
    padding: true,
    return_tensors: 'np',
  });
  return encoded;
}

// ---------------------------------------------------------------------------
// Step 4: Convert to ONNX Tensors
// ---------------------------------------------------------------------------

/**
 * Wrap tokenizer output in ort.Tensor objects ready for encoder inference.
 * Must be called inside the Web Worker where onnxruntime-web is loaded.
 *
 * @param {{ input_ids: object, attention_mask: object }} encoded
 * @param {object} ort  The onnxruntime-web module (passed in from worker)
 * @returns {{ input_ids: ort.Tensor, attention_mask: ort.Tensor }}
 */
export function toOnnxTensors(encoded, ort) {
  return {
    input_ids: new ort.Tensor(
      'int64',
      encoded.input_ids.data,
      encoded.input_ids.dims,
    ),
    attention_mask: new ort.Tensor(
      'int64',
      encoded.attention_mask.data,
      encoded.attention_mask.dims,
    ),
  };
}
