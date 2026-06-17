# Step 12 — Toolbar Popup UI

**Phase:** UI & Integration  
**Status:** Not Started  
**Depends On:** Step 02 (background message protocol), Step 09 (sidebar)  

---

## Objective

Build the toolbar popup (`ui/popup.html`) — the small window that appears when the user clicks the ContextBridge icon in Chrome's toolbar. At the end of this step, the popup shows the correct handoff badge count, allows the user to activate the sidebar on the current tab, and provides quick access to the extension's status.

---

## Files Modified

| File | Action |
|---|---|
| `ui/popup.html` | Full implementation |
| `ui/popup.css` | Full styles |
| `background.js` | Badge count updater |

---

## Popup Layout

```
+-----------------------------+
| [CB icon]  ContextBridge    |
+-----------------------------+
|  2 pending handoffs         |
|                             |
|  [ Open Sidebar ]           |
+-----------------------------+
|  Model: Ready               |
|  Platform: Claude           |
+-----------------------------+
|  [Settings]  [Help]         |
+-----------------------------+
```

Width: 280px. Height: auto (compact). No scrolling.

---

## Popup States

### State 1: Normal (model ready, handoffs exist)
```
[CB icon]  ContextBridge
─────────────────────────
  2 pending handoffs
  [ Open Sidebar ]
─────────────────────────
  Model: Ready  |  Claude
```

### State 2: No handoffs
```
[CB icon]  ContextBridge
─────────────────────────
  No pending handoffs
  [ Open Sidebar ]
─────────────────────────
  Model: Ready  |  Claude
```

### State 3: Model not downloaded
```
[CB icon]  ContextBridge
─────────────────────────
  Summarizer not ready
  [ Download Model ]
─────────────────────────
  Not set up  |  Claude
```

### State 4: Not on a supported platform
```
[CB icon]  ContextBridge
─────────────────────────
  Open a supported AI
  platform to get started
─────────────────────────
  ChatGPT · Claude · Gemini
  Perplexity · DeepSeek
```

---

## "Open Sidebar" Button

```js
document.getElementById('btn-open-sidebar').addEventListener('click', async () => {
  // Get the active tab
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  // Tell the content script to open the sidebar
  await chrome.tabs.sendMessage(tab.id, { type: 'CB_OPEN_SIDEBAR' });
  // Close the popup (it auto-closes when a message is sent to the tab)
  window.close();
});
```

---

## "Download Model" Button

Shown only when model status is `not-downloaded`:

```js
document.getElementById('btn-download-model').addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ type: 'CB_ACTION', action: 'DOWNLOAD_MODEL', payload: { tier: 'pro' } });
  updateStatus(); // refresh popup UI
});
```

---

## Badge Count

The extension icon shows a badge with the count of pending handoffs:

```js
// In background.js — called whenever handoffs change
async function updateBadge() {
  const handoffs = await getPendingHandoffs();
  const count = handoffs.length;
  chrome.action.setBadgeText({ text: count > 0 ? String(count) : '' });
  chrome.action.setBadgeBackgroundColor({ color: '#3B82F6' }); // blue
}
```

`updateBadge()` is called after every `SAVE_HANDOFF`, `DELETE_HANDOFF`, `MARK_INJECTED`, and `PURGE_EXPIRED` action.

---

## Popup Initialization

```js
// popup.html loads popup.js (inline or as a module script)
async function init() {
  // 1. Detect current tab platform
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const platform = detectPlatformFromUrl(tab.url);

  // 2. Get pending handoffs count
  const response = await chrome.runtime.sendMessage({ type: 'CB_ACTION', action: 'GET_HANDOFFS' });
  const pendingCount = response.data?.handoffs?.filter(h => h.status === 'pending').length ?? 0;

  // 3. Get model status
  const modelResp = await chrome.runtime.sendMessage({ type: 'CB_ACTION', action: 'GET_MODEL_STATUS' });
  const modelStatus = modelResp.data?.status ?? 'not-downloaded';

  // 4. Render appropriate state
  renderPopup({ platform, pendingCount, modelStatus });
}

init();
```

---

## Platform Detection from URL (Popup Context)

The popup runs in its own page context — it cannot access `window.location` of the current tab directly. It uses the tab's URL:

```js
function detectPlatformFromUrl(url) {
  if (!url) return null;
  const hostname = new URL(url).hostname;
  const map = {
    'chatgpt.com':        'chatgpt',
    'claude.ai':          'claude',
    'gemini.google.com':  'gemini',
    'www.perplexity.ai':  'perplexity',
    'chat.deepseek.com':  'deepseek',
  };
  return map[hostname] ?? null;
}
```

---

## Popup CSS Principles

- Uses CSS variables for theming (matches sidebar theme)
- Compact, no-scroll layout
- System font stack
- Transitions on button hover (100ms)
- Popup width: 280px fixed (Chrome clips larger popups)

---

## Validation Checklist

- [ ] Popup opens when clicking toolbar icon
- [ ] Correct pending handoff count is shown
- [ ] Badge on toolbar icon reflects handoff count
- [ ] "Open Sidebar" button sends message to content script and closes popup
- [ ] On unsupported platform — shows platform list, no "Open Sidebar" button
- [ ] Model status "Ready" / "Not downloaded" shows correctly
- [ ] "Download Model" button visible only when model not ready
- [ ] Platform name detected correctly from tab URL
- [ ] Popup renders within 280px width without horizontal scroll
- [ ] No errors in popup's DevTools console
