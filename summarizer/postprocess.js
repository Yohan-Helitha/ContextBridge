// ContextBridge — Summarizer Postprocessing
// Parses raw BART model output into a structured handoff summary object
// and builds the final injected prompt string.

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PLATFORM_DISPLAY_NAMES = {
  chatgpt:    'ChatGPT',
  claude:     'Claude',
  gemini:     'Gemini',
  perplexity: 'Perplexity',
  deepseek:   'DeepSeek',
};

/**
 * Regex patterns for extracting each structured field from BART output.
 * Each pattern captures everything after the marker up to the next marker or end-of-string.
 */
const STRUCTURE_MARKERS = {
  topic:        /\[TOPIC\]\s*(.+?)(?=\[COVERED\]|\[LAST POINT\]|\[OPEN THREADS\]|\[CONTINUE FROM\]|$)/si,
  covered:      /\[COVERED\]\s*(.+?)(?=\[TOPIC\]|\[LAST POINT\]|\[OPEN THREADS\]|\[CONTINUE FROM\]|$)/si,
  lastPoint:    /\[LAST POINT\]\s*(.+?)(?=\[TOPIC\]|\[COVERED\]|\[OPEN THREADS\]|\[CONTINUE FROM\]|$)/si,
  openThreads:  /\[OPEN THREADS\]\s*(.+?)(?=\[TOPIC\]|\[COVERED\]|\[LAST POINT\]|\[CONTINUE FROM\]|$)/si,
  continueFrom: /\[CONTINUE FROM\]\s*(.+?)(?=\[TOPIC\]|\[COVERED\]|\[LAST POINT\]|\[OPEN THREADS\]|$)/si,
};

// ---------------------------------------------------------------------------
// Structured summary extraction
// ---------------------------------------------------------------------------

/**
 * Parse raw BART output text into a structured summary object.
 * Applies regex extraction for each of the 5 fields.
 * openThreads is returned as string[] (split on bullet/newline).
 *
 * @param {string} rawText
 * @returns {{ topic: string, covered: string, lastPoint: string, openThreads: string[], continueFrom: string }}
 */
export function extractStructuredSummary(rawText) {
  const result = {};

  for (const [field, regex] of Object.entries(STRUCTURE_MARKERS)) {
    const match = rawText.match(regex);
    result[field] = match ? match[1].trim() : '';
  }

  // Parse openThreads into an array
  result.openThreads = result.openThreads
    ? result.openThreads
        .split(/\n|•|–|-|\d+\.\s/)
        .map(s => s.trim())
        .filter(Boolean)
    : [];

  return result;
}

// ---------------------------------------------------------------------------
// Fallback handling
// ---------------------------------------------------------------------------

/**
 * Fill in missing structured fields using heuristics over the raw summary text.
 * Ensures every field has a meaningful non-empty value before saving a handoff.
 *
 * @param {{ topic: string, covered: string, lastPoint: string, openThreads: string[], continueFrom: string }} structured
 * @param {string} rawText
 * @returns {typeof structured}
 */
export function applyFallbacks(structured, rawText) {
  // topic — use first sentence of raw summary
  if (!structured.topic) {
    structured.topic =
      rawText.split(/[.!?]/)[0]?.trim() || 'Unknown topic';
  }

  // covered — use everything up to the halfway point
  if (!structured.covered) {
    const half = Math.floor(rawText.length / 2);
    structured.covered =
      rawText.slice(0, half).replace(/\s+/g, ' ').trim() ||
      'See full summary above';
  }

  // lastPoint — use last sentence of raw summary
  if (!structured.lastPoint) {
    const sentences = rawText.split(/[.!?]/).map(s => s.trim()).filter(Boolean);
    structured.lastPoint = sentences[sentences.length - 1] || rawText.slice(-150).trim();
  }

  // openThreads — no good heuristic; leave as empty array
  if (!structured.openThreads || structured.openThreads.length === 0) {
    structured.openThreads = [];
  }

  // continueFrom — synthesise from lastPoint
  if (!structured.continueFrom) {
    structured.continueFrom =
      `Please continue from where we left off: ${structured.lastPoint}`;
  }

  return structured;
}

// ---------------------------------------------------------------------------
// Injected prompt builder
// ---------------------------------------------------------------------------

/**
 * Build the final natural-language prompt that gets injected into the
 * destination AI's input box.
 *
 * @param {{ topic: string, covered: string, lastPoint: string, openThreads: string[], continueFrom: string }} structured
 * @param {string} sourcePlatform  e.g. 'chatgpt'
 * @returns {string}
 */
export function buildInjectedPrompt(structured, sourcePlatform) {
  const platformName = PLATFORM_DISPLAY_NAMES[sourcePlatform] ?? sourcePlatform;

  const threads =
    structured.openThreads && structured.openThreads.length > 0
      ? `\n\nWe also had some open threads to return to: ${structured.openThreads.join('; ')}.`
      : '';

  return (
    `I was previously studying this topic on ${platformName} and hit the context limit. ` +
    `Here's a summary of where we were:\n\n` +
    `Topic: ${structured.topic}\n` +
    `What we covered: ${structured.covered}\n` +
    `Where we stopped: ${structured.lastPoint}` +
    threads +
    `\n\n${structured.continueFrom}`
  );
}
