// ContextBridge — ONNX Runtime Web Wrapper & Model Loader
// Manages download, caching, and loading of the BART-large-CNN ONNX model.
// Exposes encoder/decoder InferenceSession objects for the summarizer pipeline.
// Full implementation: Step 06

export async function loadModel() {
  console.debug('[ContextBridge] summarizer stub — loadModel called');
  return { encoderSession: null, decoderSession: null };
}

export function isModelLoaded() {
  return false;
}
