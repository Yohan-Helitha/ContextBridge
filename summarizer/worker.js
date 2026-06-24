// ContextBridge — Summarizer Web Worker
// Runs the full summarization pipeline off the main thread:
//   preprocess → encode → decode (autoregressive) → postprocess
//
// Message protocol (caller → worker):
//   { action: 'SUMMARIZE', messages: Message[], sourcePlatform: string }
//
// Message protocol (worker → caller):
//   { action: 'PROGRESS', stage: string }
//   { action: 'RESULT',   rawSummary, structuredSummary, injectedPrompt }
//   { action: 'ERROR',    error: string }

import { formatConversation, truncateToTokenLimit, tokenize, toOnnxTensors } from './preprocess.js';
import { loadModel, runEncoder, runDecoderLoop, detokenize } from './summarizer.js';
import { extractStructuredSummary, applyFallbacks, buildInjectedPrompt } from './postprocess.js';

// Resolve onnxruntime-web once at worker start and keep a reference for
// the helpers that need to construct ort.Tensor objects.
let _ort = null;
async function getOrt() {
  if (_ort) return _ort;
  _ort = await import(new URL('ort.esm.min.js', self.location.href).href);
  _ort.env.wasm.wasmPaths = new URL('./', self.location.href).href;
  return _ort;
}

self.onmessage = async (event) => {
  const { action, messages, sourcePlatform } = event.data;
  if (action !== 'SUMMARIZE') return;

  try {
    // 1 — Load ONNX sessions
    self.postMessage({ action: 'PROGRESS', stage: 'loading_model' });
    const ort = await getOrt();
    const { encoderSession, decoderSession } = await loadModel();

    // 2 — Preprocess: format → truncate → tokenize → tensors
    self.postMessage({ action: 'PROGRESS', stage: 'preprocessing' });
    const formattedText  = formatConversation(messages);
    const truncatedText  = truncateToTokenLimit(formattedText);
    const encoded        = await tokenize(truncatedText);
    const inputTensors   = toOnnxTensors(encoded, ort);

    // 3 — Encoder forward pass
    self.postMessage({ action: 'PROGRESS', stage: 'encoding' });
    const hiddenStates = await runEncoder(encoderSession, inputTensors);

    // 4 — Autoregressive decoder loop
    self.postMessage({ action: 'PROGRESS', stage: 'generating' });
    const tokenIds = await runDecoderLoop(
      decoderSession,
      hiddenStates,
      inputTensors.attention_mask,
      ort,
      { maxNewTokens: 300, minNewTokens: 80 },
    );

    // 5 — Postprocess: detokenize → extract structure → fallbacks → prompt
    self.postMessage({ action: 'PROGRESS', stage: 'postprocessing' });

    // Reuse the tokenizer instance already loaded in preprocess.js
    const { getTokenizer } = await import('./preprocess.js');
    const tokenizer = await getTokenizer();
    const rawSummary = await detokenize(tokenIds, tokenizer);

    let structured = extractStructuredSummary(rawSummary);
    structured     = applyFallbacks(structured, rawSummary);
    const injectedPrompt = buildInjectedPrompt(structured, sourcePlatform);

    self.postMessage({
      action: 'RESULT',
      rawSummary,
      structuredSummary: structured,
      injectedPrompt,
    });

  } catch (err) {
    console.error('[ContextBridge] worker pipeline error:', err);
    self.postMessage({ action: 'ERROR', error: err.message ?? String(err) });
  }
};
