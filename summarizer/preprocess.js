// ContextBridge — Summarizer Preprocessing
// Formats, truncates, and tokenizes scraped conversation messages
// into ONNX-ready input tensors for the BART encoder.
// Full implementation: Step 07

export function formatConversation(messages) {
  console.debug('[ContextBridge] preprocess stub — messages:', messages.length);
  return '';
}

export function truncateToTokenLimit(text, maxTokens = 4096) {
  return text;
}

export async function tokenize(text) {
  return { input_ids: null, attention_mask: null };
}

export function toOnnxTensors(encoded) {
  return {};
}
