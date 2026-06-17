# Step 03 — Content Script Entry Point & Platform Detection

**Phase:** Architecture  
**Status:** Not Started  
**Depends On:** Step 01, Step 02  

---

## Objective

Implement `content/content.js` as the unified entry point injected into all 5 platforms. It detects which platform the user is on, pings the background service worker, checks for pending handoffs, and boots the correct sub-modules (sidebar and auto-popup). At the end of this step, the extension knows what platform it's on and can communicate with the background — UI sub-modules are stubbed.

---

## Files Modified

| File | Action |
|---|---|
| `content/content.js` | Full implementation |
| `content/autopopup.js` | Minimal stub — enough to be called |
| `content/sidebar.js` | Minimal stub — enough to be called |

---

## Platform Detection

Platform is determined by `window.location.hostname`. This is the single source of truth for platform identity throughout the entire codebase.

```js
const PLATFORMS = {
  'chatgpt.com':           'chatgpt',
  'claude.ai':             'claude',
  'gemini.google.com':     'gemini',
  'www.perplexity.ai':     'perplexity',
  'chat.deepseek.com':     'deepseek',
};

function detectPlatform() {
  return PLATFORMS[window.location.hostname] ?? null;
}
```

If `detectPlatform()` returns `null`, the content script exits immediately — it does nothing on unrecognised hosts.

---

## Boot Sequence

```
content.js boot sequence:
  1. detectPlatform() — exit if null
  2. sendMessage({ action: 'PING' }) — verify background is alive
  3. sendMessage({ action: 'PURGE_EXPIRED' }) — clean stale handoffs on page load
  4. sendMessage({ action: 'GET_HANDOFFS' }) — fetch pending handoffs
  5. if (pendingHandoffs.length > 0) → boot autopopup module
  6. Listen for chrome.runtime.onMessage → 'CB_TAB_ACTIVATED' to re-run step 4–5
  7. Listen for user toolbar icon click → boot sidebar module
```

---

## Message Sending Helper

All content-to-background communication is wrapped in a single async helper:

```js
async function sendToBackground(action, payload = null) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      { type: 'CB_ACTION', action, payload },
      (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        if (!response.success) {
          reject(new Error(response.error));
          return;
        }
        resolve(response.data);
      }
    );
  });
}
```

This is the **only** place in the content layer that calls `chrome.runtime.sendMessage`. All other files import and use this helper.

---

## SPA Navigation Handling

All 5 target platforms are React/SPA-based. The URL can change without a page reload (client-side routing). The content script must detect these navigations.

```
Strategy: MutationObserver on document.title + popstate/hashchange events

On navigation detected:
  1. Re-run detectPlatform() (hostname won't change but path matters for some platforms)
  2. Re-check pending handoffs
  3. If auto-popup was already dismissed this session, do not re-show it
  4. Log: '[ContextBridge] SPA navigation detected → recheck'
```

Navigation events to listen to:
- `window.addEventListener('popstate', ...)`
- `window.addEventListener('hashchange', ...)`
- `MutationObserver` on `document.head` watching `<title>` changes

---

## Toolbar Icon Click → Sidebar Open

In MV3, there is no `chrome.browserAction.onClicked` when a popup is defined. The sidebar is opened from within the popup (Step 12). However, `content.js` also listens for a programmatic open message:

```js
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'CB_OPEN_SIDEBAR') {
    openSidebar();
  }
  if (message.type === 'CB_TAB_ACTIVATED') {
    recheckHandoffs();
  }
});
```

`openSidebar()` calls the sidebar module's `init()` function (Step 09).

---

## Isolation — Shadow DOM

The sidebar is injected as a Shadow DOM element to completely isolate its CSS from the host page. This is critical because all 5 target platforms have complex CSS that would otherwise clash.

```js
function createSidebarHost() {
  const host = document.createElement('div');
  host.id = 'contextbridge-sidebar-host';
  host.style.cssText = 'position:fixed;top:0;right:0;z-index:2147483647;width:0;height:0;';
  const shadow = host.attachShadow({ mode: 'open' });
  document.body.appendChild(host);
  return shadow;
}
```

The shadow root is passed to the sidebar module as its rendering context. **All sidebar DOM operations use this shadow root, never `document` directly.**

---

## content.js Exported Interface

Other modules can import from content.js:

```js
export { detectPlatform, sendToBackground, getSidebarShadowRoot };
```

---

## Stub Requirements for autopopup.js and sidebar.js

At this step, these stubs must exist and be importable:

```js
// content/autopopup.js
export function initAutoPopup(platform, handoffs, shadowRoot) {
  console.debug('[ContextBridge] autopopup stub — handoffs:', handoffs.length);
}
```

```js
// content/sidebar.js
export function initSidebar(platform, shadowRoot) {
  console.debug('[ContextBridge] sidebar stub — platform:', platform);
}
```

---

## Error Handling

- If background PING fails (service worker sleeping), retry once after 200ms. Log warning if still failing.
- If `detectPlatform()` returns null, silently exit — do not log, do not throw.
- Wrap the entire boot sequence in a top-level try/catch. Log errors to console but never throw to the platform's error boundary.

---

## Validation Checklist

- [ ] `console.debug` shows correct platform name on each of the 5 platforms
- [ ] PING to background resolves successfully
- [ ] `PURGE_EXPIRED` is called on every page load/SPA navigation
- [ ] SPA navigation is detected on ChatGPT and Claude (both use client-side routing)
- [ ] Shadow DOM host element appears in the DOM on all 5 platforms
- [ ] `CB_OPEN_SIDEBAR` message received → sidebar stub `initSidebar` is called
- [ ] No content script errors appear in the platform's browser console
- [ ] Visiting a non-listed URL (e.g. google.com) shows no ContextBridge activity
