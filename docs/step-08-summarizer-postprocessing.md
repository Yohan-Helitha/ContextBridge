# Step 08 — Summarizer Postprocessing & Structured Output

**Phase:** Core Mechanics — Summarizer  
**Status:** Not Started  
**Depends On:** Step 06 (ONNX sessions), Step 07 (input tensors ready)  

---

## Objective

Implement `summarizer/postprocess.js` and complete the end-to-end inference pipeline in `summarizer/summarizer.js`. At the end of this step, feeding a scraped conversation through the full pipeline produces a valid `structuredSummary` object and an `injectedPrompt` string — the core value proposition of the entire extension.

---

## Files Modified

| File | Action |
|---|---|
| `summarizer/postprocess.js` | Full implementation |
| `summarizer/summarizer.js` | Full inference loop wiring encoder + decoder |
| `summarizer/worker.js` | Complete worker wiring preprocess → inference → postprocess |

---

## Full Inference Pipeline

```
Input: Message[]
  |
  v
[preprocess.js] formatConversation() + truncateToTokenLimit() + tokenize() + toOnnxTensors()
  |
  v Input tensors: { input_ids, attention_mask }
  |
  v
[summarizer.js] runEncoder(inputTensors) -> encoder_hidden_states
  |
  v
[summarizer.js] runDecoderLoop(encoder_hidden_states) -> output_token_ids[]
  |
  v Raw token ids
  |
  v
[summarizer.js] detokenize(output_token_ids) -> raw_summary_text (string)
  |
  v
[postprocess.js] extractStructuredSummary(raw_summary_text) -> structuredSummary
  |
  v
[postprocess.js] buildInjectedPrompt(structuredSummary) -> injectedPrompt (string)
  |
  v
Output: { rawSummary, structuredSummary, injectedPrompt }
```

---

## Encoder Step

```js
export async function runEncoder(encoderSession, inputTensors) {
  const feeds = {
    input_ids:      inputTensors.input_ids,
    attention_mask: inputTensors.attention_mask,
  };
  const results = await encoderSession.run(feeds);
  return results['last_hidden_state']; // shape: [1, seq_len, 1024]
}
```

---

## Decoder Loop (Autoregressive Generation)

BART generates summaries token by token. Each step feeds the previous output back as input:

```js
export async function runDecoderLoop(decoderSession, encoderHiddenStates, attentionMask, config) {
  const {
    maxNewTokens = 300,     // pro tier: longer summaries
    minNewTokens = 80,
    noRepeatNgramSize = 3,
    eosTokenId = 2,         // BART EOS token
    bosTokenId = 2,         // BART decoder start token
    padTokenId = 1,
  } = config;

  let decoderInputIds = new ort.Tensor('int64', [BigInt(bosTokenId)], [1, 1]);
  const outputTokenIds = [];

  for (let step = 0; step < maxNewTokens; step++) {
    const feeds = {
      input_ids:                decoderInputIds,
      encoder_hidden_states:    encoderHiddenStates,
      encoder_attention_mask:   attentionMask,
    };

    const results = await decoderSession.run(feeds);
    const logits = results['logits']; // shape: [1, seq_len, vocab_size]

    // Greedy decode: pick argmax of last token's logits
    const nextTokenId = argmax(logits.data, logits.dims[2]);
    outputTokenIds.push(nextTokenId);

    if (nextTokenId === eosTokenId && outputTokenIds.length >= minNewTokens) break;

    // Append next token to decoder input
    const newInputData = new BigInt64Array([...decoderInputIds.data, BigInt(nextTokenId)]);
    decoderInputIds = new ort.Tensor('int64', newInputData, [1, newInputData.length]);
  }

  return outputTokenIds;
}

function argmax(arr, vocabSize) {
  const lastTokenStart = arr.length - vocabSize;
  let maxIdx = 0;
  let maxVal = -Infinity;
  for (let i = lastTokenStart; i < arr.length; i++) {
    if (arr[i] > maxVal) { maxVal = arr[i]; maxIdx = i - lastTokenStart; }
  }
  return maxIdx;
}
```

---

## Detokenization

```js
export async function detokenize(tokenIds) {
  const tok = await getTokenizer(); // from preprocess.js
  return tok.decode(tokenIds, { skip_special_tokens: true });
}
```

---

## Postprocess: Extract Structured Summary

The raw BART output is a paragraph of summarized text. We then apply a second-pass prompt to structure it into the 5-field format.

### Strategy: Template Extraction with Regex + Fallback

The model is prompted with a structured output format. Postprocess.js parses the output:

```js
const STRUCTURE_MARKERS = {
  topic:        /\[TOPIC\]\s*(.+?)(?=\[|$)/si,
  covered:      /\[COVERED\]\s*(.+?)(?=\[|$)/si,
  lastPoint:    /\[LAST POINT\]\s*(.+?)(?=\[|$)/si,
  openThreads:  /\[OPEN THREADS\]\s*(.+?)(?=\[|$)/si,
  continueFrom: /\[CONTINUE FROM\]\s*(.+?)(?=\[|$)/si,
};

export function extractStructuredSummary(rawText) {
  const result = {};
  for (const [field, regex] of Object.entries(STRUCTURE_MARKERS)) {
    const match = rawText.match(regex);
    result[field] = match ? match[1].trim() : '';
  }

  // openThreads as array (split by bullet or newline)
  if (result.openThreads) {
    result.openThreads = result.openThreads
      .split(/\n|•|-/)
      .map(s => s.trim())
      .filter(Boolean);
  } else {
    result.openThreads = [];
  }

  return result;
}
```

### Fallback When Markers are Missing

BART may not always produce perfectly structured output. If a field is empty after extraction:

```js
export function applyFallbacks(structured, rawText) {
  // If topic is missing, use first sentence of raw summary
  if (!structured.topic) {
    structured.topic = rawText.split(/[.!?]/)[0]?.trim() ?? 'Unknown topic';
  }
  // If continueFrom is missing, generate a generic continuation prompt
  if (!structured.continueFrom) {
    structured.continueFrom = `Please continue from where we left off: ${structured.lastPoint || rawText.slice(0, 100)}`;
  }
  return structured;
}
```

---

## Build Injected Prompt

This is the final natural-language text that gets typed into the destination AI's input box:

```js
export function buildInjectedPrompt(structured, sourcePlatform) {
  const platformName = PLATFORM_DISPLAY_NAMES[sourcePlatform] ?? sourcePlatform;
  const threads = structured.openThreads?.length
    ? `\n\nWe also had some open threads to return to: ${structured.openThreads.join('; ')}.`
    : '';

  return `I was previously studying this topic on ${platformName} and hit the context limit. Here's a summary of where we were:\n\n` +
    `Topic: ${structured.topic}\n` +
    `What we covered: ${structured.covered}\n` +
    `Where we stopped: ${structured.lastPoint}` +
    threads +
    `\n\n${structured.continueFrom}`;
}

const PLATFORM_DISPLAY_NAMES = {
  chatgpt:    'ChatGPT',
  claude:     'Claude',
  gemini:     'Gemini',
  perplexity: 'Perplexity',
  deepseek:   'DeepSeek',
};
```

---

## BART Prompt Engineering

To guide BART toward the structured output format, the input text is wrapped in an instruction prefix:

```
"Summarize this AI tutoring conversation using exactly these markers:
[TOPIC] [COVERED] [LAST POINT] [OPEN THREADS] [CONTINUE FROM]

Conversation:
{formatted_conversation}"
```

This prefix is added in `preprocess.js`'s `formatConversation()` function.

**Reality note:** BART-large-CNN is trained for news summarization, not structured output. The structured extraction via regex is the reliable path. The prompt prefix nudges but does not guarantee structured output — the regex fallback is always the safety net.

---

## Complete Worker Implementation

```js
// summarizer/worker.js
import { formatConversation, truncateToTokenLimit, tokenize, toOnnxTensors } from './preprocess.js';
import { loadModel, runEncoder, runDecoderLoop, detokenize } from './summarizer.js';
import { extractStructuredSummary, applyFallbacks, buildInjectedPrompt } from './postprocess.js';

self.onmessage = async (event) => {
  const { action, messages, sourcePlatform } = event.data;

  if (action !== 'SUMMARIZE') return;

  try {
    self.postMessage({ action: 'PROGRESS', stage: 'loading_model' });
    const { encoderSession, decoderSession } = await loadModel();

    self.postMessage({ action: 'PROGRESS', stage: 'preprocessing' });
    const text = formatConversation(messages);
    const truncated = truncateToTokenLimit(text);
    const encoded = await tokenize(truncated);
    const tensors = toOnnxTensors(encoded);

    self.postMessage({ action: 'PROGRESS', stage: 'encoding' });
    const hiddenStates = await runEncoder(encoderSession, tensors);

    self.postMessage({ action: 'PROGRESS', stage: 'generating' });
    const tokenIds = await runDecoderLoop(decoderSession, hiddenStates, tensors.attention_mask, {});

    self.postMessage({ action: 'PROGRESS', stage: 'postprocessing' });
    const rawSummary = await detokenize(tokenIds);
    let structured = extractStructuredSummary(rawSummary);
    structured = applyFallbacks(structured, rawSummary);
    const injectedPrompt = buildInjectedPrompt(structured, sourcePlatform);

    self.postMessage({
      action: 'RESULT',
      rawSummary,
      structuredSummary: structured,
      injectedPrompt,
    });
  } catch (err) {
    self.postMessage({ action: 'ERROR', error: err.message });
  }
};
```

---

## Validation Checklist

- [ ] Full pipeline: `Message[]` in -> `{ rawSummary, structuredSummary, injectedPrompt }` out
- [ ] `runEncoder()` returns a tensor of shape `[1, seq_len, 1024]`
- [ ] Decoder loop terminates at EOS or maxNewTokens limit
- [ ] `detokenize()` returns readable English text (no special tokens)
- [ ] `extractStructuredSummary()` parses all 5 fields from a well-formed raw output
- [ ] Fallbacks are applied when one or more fields are missing
- [ ] `buildInjectedPrompt()` produces a complete, readable paragraph ready to paste into a chat
- [ ] Worker sends `PROGRESS` events at each stage — sidebar can show them
- [ ] Worker sends `ERROR` on failure — sidebar shows error state
- [ ] Inference completes within 60 seconds on a modern laptop (WASM is slow — set user expectations)
