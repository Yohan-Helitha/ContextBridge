# Step 02 — Background Service Worker Foundation

**Phase:** Architecture  
**Status:** Not Started  
**Depends On:** Step 01 (folder structure and manifest)  

---

## Objective

Implement the complete background service worker (`background.js`). This is the central nervous system of the extension — it handles message routing between content scripts, manages the ONNX model lifecycle, runs the expiry checker, and owns all storage operations. At the end of this step, the background worker is fully wired and communicates correctly with content scripts, even though the summarizer and UI are not yet built.

---

## Files Modified

| File | Action |
|---|---|
| `background.js` | Full implementation |
| `storage/handoff-store.js` | Stub wired (full impl in Step 04) |

---

## Responsibilities of background.js

```
background.js
├── 1. Startup & Initialization
│   ├── chrome.runtime.onInstalled  → first-install flag, onboarding trigger
│   └── chrome.runtime.onStartup   → run expiry check on browser start
│
├── 2. Message Router
│   └── chrome.runtime.onMessage   → dispatches all content ↔ background messages
│
├── 3. Expiry Manager
│   └── checkAndPurgeExpiredHandoffs() → called on startup + every page load ping
│
├── 4. Model Manager (stub — full impl in Step 06)
│   ├── downloadModel(tier)         → triggers model fetch
│   └── getModelStatus()            → returns "not-downloaded" | "downloading" | "ready"
│
└── 5. Tab Listener
    └── chrome.tabs.onUpdated       → pings content script when navigation completes
```

---

## Message Protocol

All messages follow a strict typed envelope pattern:

```js
// Request (content → background)
{
  type: 'CB_ACTION',        // always 'CB_ACTION' for routing
  action: string,           // specific action name
  payload: object | null    // action-specific data
}

// Response (background → content)
{
  success: boolean,
  data: any,
  error: string | null
}
```

### Actions Handled by Background

| Action | Payload | Response |
|---|---|---|
| `PING` | null | `{ alive: true }` |
| `GET_HANDOFFS` | null | `{ handoffs: Handoff[] }` |
| `SAVE_HANDOFF` | `{ handoff: Handoff }` | `{ id: string }` |
| `DELETE_HANDOFF` | `{ id: string }` | `{ deleted: true }` |
| `MARK_INJECTED` | `{ id: string }` | `{ updated: true }` |
| `GET_STORAGE_USAGE` | null | `{ usedBytes: number }` |
| `GET_MODEL_STATUS` | null | `{ status: string }` |
| `DOWNLOAD_MODEL` | `{ tier: 'pro' }` | `{ started: true }` |
| `PURGE_EXPIRED` | null | `{ purged: number }` |
| `GET_SETTINGS` | null | `{ settings: Settings }` |
| `SAVE_SETTINGS` | `{ settings: Settings }` | `{ saved: true }` |

---

## Settings Object

```js
const DEFAULT_SETTINGS = {
  tier: 'pro',                        // 'free' | 'pro' — locked to 'pro' for now
  modelStatus: 'not-downloaded',      // 'not-downloaded' | 'downloading' | 'ready'
  onboardingComplete: false,
  suppressedPlatforms: [],            // platforms where auto-popup is suppressed
  handoffExpiry: 7 * 24 * 60 * 60 * 1000,  // 7 days in ms (pro)
  maxHandoffs: Infinity,              // unlimited (pro)
};
```

---

## Expiry Manager Logic

```
checkAndPurgeExpiredHandoffs():
  1. Load all handoffs from chrome.storage.local
  2. Get current UTC timestamp
  3. Filter handoffs where expiresAt < now OR status === 'expired'
  4. Delete each expired handoff by key
  5. Return count of purged items
  6. Log: '[ContextBridge] Purged N expired handoffs'
```

Called on:
- `chrome.runtime.onStartup`
- `chrome.runtime.onInstalled`
- Every `CB_ACTION → PURGE_EXPIRED` message from content scripts

---

## Tab Update Listener

```
chrome.tabs.onUpdated:
  - Fires when a tab URL changes to a supported platform
  - Sends a message to the content script: { type: 'CB_TAB_ACTIVATED' }
  - Content script uses this to re-check for pending handoffs
  - Only fires if the URL matches one of the 5 platform patterns
```

---

## First-Install Handling

```
chrome.runtime.onInstalled (reason === 'install'):
  1. Set chrome.storage.local: { 'cb_onboarding_complete': false }
  2. Set chrome.storage.local: { 'cb_settings': DEFAULT_SETTINGS }
  3. Open the onboarding tab (Step 13 — deferred stub for now)
  4. Log: '[ContextBridge] First install — onboarding pending'
```

---

## Error Handling Rules

- Every message handler is wrapped in try/catch.
- On error, always respond `{ success: false, error: err.message }` — never let `sendResponse` go uncalled.
- Service workers can be terminated at any time — never hold state in module-level variables. All state goes through `chrome.storage.local`.
- Always `return true` from `onMessage` listeners when the response is async.

---

## Implementation Notes

- Use ES modules (`type: "module"` in manifest). Import from `storage/handoff-store.js` once it exists.
- The model manager in this step is a **stub** — it returns `{ status: 'not-downloaded' }` until Step 06.
- Keep background.js thin — it routes messages but delegates all logic to the appropriate module.
- Storage keys are namespaced with `cb_` prefix to avoid collisions.

---

## Storage Key Convention

| Key | Value type | Description |
|---|---|---|
| `cb_settings` | `Settings` object | Extension settings |
| `cb_handoff_{id}` | `Handoff` object | One key per handoff |
| `cb_handoff_index` | `string[]` | Ordered list of handoff IDs |
| `cb_model_cache_pro` | `boolean` | Whether pro model is cached |
| `cb_onboarding_complete` | `boolean` | Whether onboarding was shown |

---

## Validation Checklist

- [ ] `chrome.runtime.onInstalled` fires and writes default settings to storage
- [ ] `PING` message from any content script returns `{ alive: true }`
- [ ] `PURGE_EXPIRED` message triggers expiry logic and returns correct count
- [ ] `GET_MODEL_STATUS` returns `{ status: 'not-downloaded' }` at this stage
- [ ] No uncaught promise rejections in the service worker console
- [ ] Service worker appears as "active" in `chrome://extensions`
- [ ] All 8 message actions respond correctly (test via `chrome.runtime.sendMessage` in console)
