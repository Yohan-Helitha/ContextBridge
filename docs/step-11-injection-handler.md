# Step 11 — Injection Handler

**Phase:** UI & Integration  
**Status:** Not Started  
**Depends On:** Step 05 (platform knowledge), Step 09 (sidebar triggers inject)  

---

## Objective

Implement `content/injector.js` — the module responsible for inserting the handoff summary into the AI platform's chat input box. This is the final action of the entire inject flow. At the end of this step, clicking "Inject into chat" from the sidebar correctly populates the input box on all 5 platforms, ready for the user to press send.

---

## Files Modified

| File | Action |
|---|---|
| `content/injector.js` | Full implementation — all 5 platform injectors |
| `content/sidebar.js` | Wire "Inject into chat" button to injector |

---

## The Core Challenge

All 5 platforms use React or Angular. Their input boxes are **controlled components** — simply setting `element.value = text` does not work because React's internal state is not updated. The DOM value changes but the send button stays disabled and the framework sees no change.

The correct approach for React-controlled inputs is to dispatch a native input event that React's synthetic event system intercepts.

---

## Public API

```js
// Injects text into the platform's chat input box
// Returns true on success, false if input box not found
export async function injectIntoChatInput(platform, text)  -> Promise<boolean>
```

---

## Universal React Input Injection Technique

```js
function setReactInputValue(inputEl, text) {
  // Get React's internal fiber node
  const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
    window.HTMLTextAreaElement.prototype, 'value'
  )?.set ?? Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype, 'value'
  )?.set;

  // Set value via native setter (bypasses React's own setter)
  nativeInputValueSetter.call(inputEl, text);

  // Dispatch input event — React's SyntheticEvent system picks this up
  inputEl.dispatchEvent(new Event('input', { bubbles: true }));
  inputEl.dispatchEvent(new Event('change', { bubbles: true }));
}
```

For `contenteditable` divs (used by some platforms):

```js
function setContentEditableValue(el, text) {
  el.focus();
  el.textContent = '';  // clear existing
  
  // Use execCommand for contenteditable (deprecated but still widely supported)
  document.execCommand('insertText', false, text);
  
  // Fallback: dispatch input event manually
  el.dispatchEvent(new InputEvent('input', { bubbles: true, data: text }));
}
```

---

## Platform 1: ChatGPT

```js
// ChatGPT uses a contenteditable div, not textarea
const INPUT_SELECTOR = '#prompt-textarea';

async function injectChatGPT(text) {
  const input = document.querySelector(INPUT_SELECTOR);
  if (!input) throw new Error('ChatGPT input not found');
  input.focus();
  setContentEditableValue(input, text);
  // Verify content appeared
  return input.textContent.includes(text.slice(0, 20));
}
```

---

## Platform 2: Claude

```js
// Claude also uses a contenteditable div (ProseMirror editor)
const INPUT_SELECTOR = '[contenteditable="true"].ProseMirror, div[contenteditable="true"]';

async function injectClaude(text) {
  const input = document.querySelector(INPUT_SELECTOR);
  if (!input) throw new Error('Claude input not found');
  input.focus();
  // ProseMirror requires careful handling — clear existing content first
  input.textContent = '';
  input.dispatchEvent(new InputEvent('input', { bubbles: true }));
  // Then insert text
  setContentEditableValue(input, text);
  return true;
}
```

---

## Platform 3: Gemini

```js
// Gemini uses a rich text editor with contenteditable
const INPUT_SELECTOR = '.ql-editor[contenteditable="true"], rich-textarea [contenteditable="true"]';

async function injectGemini(text) {
  const input = document.querySelector(INPUT_SELECTOR);
  if (!input) throw new Error('Gemini input not found');
  input.focus();
  setContentEditableValue(input, text);
  return true;
}
```

---

## Platform 4: Perplexity

```js
// Perplexity uses a textarea element
const INPUT_SELECTOR = 'textarea[placeholder], textarea.overflow-auto';

async function injectPerplexity(text) {
  const input = document.querySelector(INPUT_SELECTOR);
  if (!input) throw new Error('Perplexity input not found');
  setReactInputValue(input, text);
  input.focus();
  return true;
}
```

---

## Platform 5: DeepSeek

```js
// DeepSeek uses a textarea
const INPUT_SELECTOR = '#chat-input, textarea[class*="chat"]';

async function injectDeepSeek(text) {
  const input = document.querySelector(INPUT_SELECTOR)
               ?? document.querySelector('textarea');
  if (!input) throw new Error('DeepSeek input not found');
  setReactInputValue(input, text);
  input.focus();
  return true;
}
```

---

## Main Dispatcher

```js
const INJECTORS = {
  chatgpt:    injectChatGPT,
  claude:     injectClaude,
  gemini:     injectGemini,
  perplexity: injectPerplexity,
  deepseek:   injectDeepSeek,
};

export async function injectIntoChatInput(platform, text) {
  const injector = INJECTORS[platform];
  if (!injector) return false;

  try {
    const success = await injector(text);
    return success;
  } catch (err) {
    console.error(`[ContextBridge] Inject failed on ${platform}:`, err.message);
    return false;
  }
}
```

---

## Post-Inject Actions

After successful injection:

1. The sidebar shows: "Text injected — review and press send."
2. The sidebar "Inject into chat" button becomes disabled to prevent double-inject.
3. `sendToBackground({ action: 'MARK_INJECTED', payload: { id: handoff.id } })` — marks handoff as injected and removes from pending list.
4. Sidebar returns to idle state after 3 seconds.

After failed injection:

1. Sidebar shows error: "Could not find the input box. Try clicking the input area first, then inject again."
2. Provides a "Try again" button.
3. Handoff is NOT marked as injected — the user can retry.

---

## Input Box Not Found — Recovery Flow

Some platforms lazy-render their input box. If the selector returns null:

```js
async function waitForInput(selector, timeout = 3000) {
  const el = document.querySelector(selector);
  if (el) return el;
  // Wait for it to appear
  return waitForElement(selector, timeout); // from scrapers.js shared utils
}
```

---

## Security Note

The injected text is the user's own summary — content they created from their own conversation. No external text is ever injected from a remote source. The injected text never exceeds what the user approved in the sidebar text area.

The injection does NOT auto-submit. The user always reviews the injected text in the input box and manually presses send. This is intentional and a core design principle.

---

## Validation Checklist

- [ ] Injection correctly populates ChatGPT's contenteditable input
- [ ] Injection correctly populates Claude's ProseMirror input
- [ ] Injection correctly populates Gemini's rich text editor
- [ ] Injection correctly populates Perplexity's textarea
- [ ] Injection correctly populates DeepSeek's textarea
- [ ] On all 5 platforms, the send button becomes enabled after injection (React state updated)
- [ ] Text injected is exactly equal to the handoff's `injectedPrompt` (no truncation)
- [ ] Handoff is marked as `injected` in storage after successful injection
- [ ] Injecting does NOT auto-send the message
- [ ] Failed injection shows a user-readable error and allows retry
- [ ] No platform throws a JS error due to the injection method used
