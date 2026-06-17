// ContextBridge — Summarizer Web Worker
// Runs the full summarization pipeline (preprocess → encode → decode → postprocess)
// off the main thread to avoid blocking the sidebar UI.
// Full implementation: Step 08

self.onmessage = async (event) => {
  if (event.data.action === 'SUMMARIZE') {
    console.debug('[ContextBridge] worker stub — SUMMARIZE received');
    self.postMessage({ action: 'RESULT', structuredSummary: null });
  }
};
