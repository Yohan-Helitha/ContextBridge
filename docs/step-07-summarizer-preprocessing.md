# Step 07 — Summarizer Preprocessing

**Phase:** Core Mechanics — Summarizer  
**Status:** Not Started  
**Depends On:** Step 05 (scraper output format), Step 06 (model loaded)  

---

## Objective

Implement `summarizer/preprocess.js`. This module takes the raw `Message[]` array from the scraper and converts it into tokenized ONNX-ready input tensors for the BART encoder. At the end of this step, a scraped conversation can be formatted, truncated to fit the model's token limit, and encoded into the numerical input the model expects.

---

## Files Modified

| File | Action |
|---|---|
| `summarizer/preprocess.js` | Full implementation |
| `summarizer/summarizer.js` | Import and call preprocess before inference |

---

## Preprocessing Pipeline

```
Message[]  ->  formatConversation()  ->  truncateToTokenLimit()  ->  tokenize()  ->  InputTensors
```

---

## Step 1: Format Conversation

Convert the normalized `Message[]` into a single text string formatted for BART input:

```js
export function formatConversation(messages) {
  return messages
    .map(msg => {
      const speaker = msg.role === 'user' ? 'User' : 'Assistant';
      return `${speaker}: ${msg.text}`;
    })
    .join('\n\n');
}
```

Example output (plain text):

  User: I want to understand how ATP synthase works.
  Assistant: ATP synthase is a molecular machine...

The prefix `"summarize the following AI conversation:"` is prepended to guide BART toward a summarization task.

---

## Step 2: Token Limit Enforcement (Pro Tier)

BART-large supports up to 1024 tokens natively, but the pro tier extends effective input by chunking.

```
MAX_TOKENS_PRO = 4096   (approximate word count: ~3,000 words)
MAX_TOKENS_FREE = 1024  (approximate word count: ~750 words)

Current build: PRO tier only — use MAX_TOKENS_PRO = 4096
```

If the formatted conversation exceeds the token limit, apply this truncation strategy:

```
Priority order (what to keep when truncating):
  1. ALWAYS keep the LAST 30% of the conversation (most recent context)
  2. ALWAYS keep the FIRST 10% (topic introduction)
  3. Fill remaining token budget with middle messages, newest first
  4. Insert "[...earlier conversation truncated...]" marker where content was cut
```

```js
export function truncateToTokenLimit(text, maxTokens = 4096) {
  const words = text.split(/\s+/);
  // Rough estimate: 1 token ~= 0.75 words
  const maxWords = Math.floor(maxTokens * 0.75);
  if (words.length <= maxWords) return text;

  const keepFirst = Math.floor(maxWords * 0.10);
  const keepLast  = Math.floor(maxWords * 0.30);
  const keepMid   = maxWords - keepFirst - keepLast;

  const firstPart  = words.slice(0, keepFirst).join(' ');
  const lastPart   = words.slice(-keepLast).join(' ');
  const midStart   = words.length - keepLast - keepMid;
  const midPart    = words.slice(Math.max(keepFirst, midStart), words.length - keepLast).join(' ');

  return `${firstPart}\n\n[...earlier conversation truncated...]\n\n${midPart}\n\n${lastPart}`;
}
```

---

## Step 3: Tokenization

BART uses a byte-pair encoding (BPE) tokenizer (same as RoBERTa). For in-browser tokenization, use the `@xenova/transformers` tokenizer (Hugging Face Transformers.js) which runs in WebAssembly.

```js
import { AutoTokenizer } from '@xenova/transformers';

let tokenizer = null;

export async function getTokenizer() {
  if (!tokenizer) {
    // Load tokenizer config from cached model files
    tokenizer = await AutoTokenizer.from_pretrained('facebook/bart-large-cnn', {
      local_files_only: false,  // will cache automatically
    });
  }
  return tokenizer;
}

export async function tokenize(text) {
  const tok = await getTokenizer();
  const encoded = tok(text, {
    max_length: 4096,
    truncation: true,
    padding: true,
    return_tensors: 'np',  // returns NumPy-style typed arrays
  });
  return encoded;
}
```

### Output Tensors

```js
// encoded contains:
{
  input_ids:      BigInt64Array  // token ids — shape [1, seq_len]
  attention_mask: BigInt64Array  // 1 for real tokens, 0 for padding — shape [1, seq_len]
}
```

These are converted to ONNX Tensors before being passed to the encoder:

```js
import * as ort from 'onnxruntime-web';

export function toOnnxTensors(encoded) {
  return {
    input_ids: new ort.Tensor('int64', encoded.input_ids.data, encoded.input_ids.dims),
    attention_mask: new ort.Tensor('int64', encoded.attention_mask.data, encoded.attention_mask.dims),
  };
}
```

---

## Running in a Web Worker

Tokenization and inference are CPU-intensive and must not block the main thread. They run in a dedicated Web Worker:

```
Architecture:
  content.js → postMessage({ action: 'SUMMARIZE', messages }) → worker.js
  worker.js  → loads model sessions (once, cached)
  worker.js  → runs preprocess + inference + postprocess
  worker.js  → postMessage({ action: 'RESULT', structuredSummary })
  content.js → receives summary, updates sidebar UI
```

The worker file is `summarizer/worker.js` (created in this step as a stub, fully wired in Step 08).

```js
// summarizer/worker.js
self.onmessage = async (event) => {
  if (event.data.action === 'SUMMARIZE') {
    // Step 07: preprocess
    // Step 08: inference + postprocess
    // Stub for now:
    self.postMessage({ action: 'RESULT', structuredSummary: null });
  }
};
```

---

## Dependency: @xenova/transformers

Add to the extension:

```
Option A: Bundle via webpack/rollup at build time (preferred)
Option B: Load from web_accessible_resources as a local script

Use Option A — bundle transformers.js tokenizer only (not the full model runtime).
This avoids loading from external CDN and satisfies the CSP policy.
```

---

## Validation Checklist

- [ ] `formatConversation()` produces correctly prefixed text from a `Message[]` input
- [ ] `truncateToTokenLimit()` returns original text if under limit
- [ ] `truncateToTokenLimit()` inserts truncation marker when over limit
- [ ] `truncateToTokenLimit()` always preserves last 30% of conversation
- [ ] `tokenize()` returns `input_ids` and `attention_mask` typed arrays
- [ ] `toOnnxTensors()` produces valid `ort.Tensor` objects with correct shapes
- [ ] Tokenization runs inside a Web Worker without blocking the sidebar UI
- [ ] A 3,000-word conversation tokenizes without error within the 4096 token limit