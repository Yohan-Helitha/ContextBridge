# Step 14 — End-to-End Integration & Message Wiring

**Phase:** Integration  
**Status:** Not Started  
**Depends On:** Steps 04–13 (all modules built)  

---

## Objective

Connect all previously built modules into a single working extension. Wire the complete Capture Flow and Inject Flow end-to-end. Resolve any interface mismatches between modules, ensure all message types are handled, and verify the full user journey works without errors on all 5 platforms.

---

## Files Modified

All files are touched for final wiring — no new files.

| File | Changes |
|---|---|
| `content/content.js` | Wire scraper + worker + sidebar + autopopup together |
| `content/sidebar.js` | Wire injector, worker messages, storage responses |
| `background.js` | Ensure all message actions are fully wired |
| `summarizer/worker.js` | Verify full pipeline runs end-to-end |
| `platforms/scrapers.js` | Final selector validation pass |

---

## Full Capture Flow — Wiring Map

```
User clicks toolbar icon
  → popup.html opens
    → "Open Sidebar" clicked
      → chrome.tabs.sendMessage(CB_OPEN_SIDEBAR)
        → content.js receives CB_OPEN_SIDEBAR
          → initSidebar(platform, shadowRoot)
            → sidebar.js renders UI

User clicks "Summarize current chat"
  → sidebar.js calls scrapeMessages(platform)
    → platforms/scrapers.js getScraperForPlatform(platform).scrapeMessages()
      → returns Message[]
  → sidebar.js creates Web Worker: new Worker('summarizer/worker.js')
  → sidebar.js posts { action: 'SUMMARIZE', messages, sourcePlatform }
    → worker.js runs full pipeline
      → PROGRESS events → sidebar.js updates progress bar
      → RESULT event → sidebar.js renders structured summary in textarea

User clicks "Save Handoff"
  → sidebar.js reads textarea content
  → sidebar.js calls extractStructuredSummary() + buildInjectedPrompt()
  → sidebar.js sends CB_ACTION: SAVE_HANDOFF to background
    → background.js calls handoff-store.createHandoff()
    → background.js calls updateBadge()
  → background responds { success: true, data: { id } }
  → sidebar.js shows confirmation, reloads pending list
```

---

## Full Inject Flow — Wiring Map

```
User navigates to a new AI platform
  → content.js boots on new platform
    → sends CB_ACTION: GET_HANDOFFS to background
      → background returns pending handoffs
    → initAutoPopup(platform, handoffs, shadowRoot)
      → autopopup.js shows modal

User clicks "Review & Inject"
  → autopopup.js sends CB_OPEN_SIDEBAR to itself (via content.js)
  → sidebar.js opens in inject mode with handoff pre-loaded
  → sidebar.js renders handoff's structuredSummary in textarea

User clicks "Inject into chat"
  → sidebar.js calls injectIntoChatInput(platform, injectedPrompt)
    → injector.js finds input box, sets value + dispatches events
  → sidebar.js sends CB_ACTION: MARK_INJECTED { id }
    → background calls handoff-store.updateHandoff(id, { status: 'injected' })
    → background calls updateBadge()
  → sidebar.js shows success message
```

---

## Worker Lifecycle Management

The Web Worker must not persist indefinitely — it holds WASM memory:

```js
// In sidebar.js
let summarizerWorker = null;

function getSummarizerWorker() {
  if (!summarizerWorker) {
    summarizerWorker = new Worker(chrome.runtime.getURL('summarizer/worker.js'), { type: 'module' });
  }
  return summarizerWorker;
}

// Terminate worker when sidebar closes to free WASM memory
function closeSidebar() {
  if (summarizerWorker) {
    summarizerWorker.terminate();
    summarizerWorker = null;
  }
  // ... rest of close logic
}
```

---

## Message Type Registry

All message types used across the codebase, for reference:

### content → background (type: 'CB_ACTION')
| action | description |
|---|---|
| PING | Check background alive |
| GET_HANDOFFS | Fetch all handoffs |
| SAVE_HANDOFF | Save new handoff |
| DELETE_HANDOFF | Delete by id |
| MARK_INJECTED | Mark handoff as injected |
| GET_STORAGE_USAGE | Bytes used |
| GET_MODEL_STATUS | Model download status |
| DOWNLOAD_MODEL | Start model download |
| PURGE_EXPIRED | Delete expired handoffs |
| GET_SETTINGS | Fetch settings |
| SAVE_SETTINGS | Update settings |

### background → content (type: string)
| type | description |
|---|---|
| CB_TAB_ACTIVATED | Tab navigation detected |
| CB_OPEN_SIDEBAR | Sidebar open requested |
| CB_MODEL_DOWNLOAD_PROGRESS | Download progress event |
| CB_MODEL_DOWNLOAD_COMPLETE | Download finished |
| CB_MODEL_DOWNLOAD_ERROR | Download failed |

### content → worker (postMessage)
| action | description |
|---|---|
| SUMMARIZE | Start summarization |

### worker → content (postMessage)
| action | description |
|---|---|
| PROGRESS | Stage update |
| RESULT | Summary complete |
| ERROR | Summarization failed |

---

## Integration Test Scenarios

These should be manually tested once before Step 15:

### Scenario A: Full Happy Path (Claude → ChatGPT)
1. Open Claude, have a conversation visible
2. Click ContextBridge icon → Open Sidebar
3. Click "Summarize current chat"
4. Wait for summary (up to ~60s)
5. Review summary in textarea, click "Save Handoff"
6. Navigate to ChatGPT in the same tab or a new tab
7. Auto-popup appears → "Review & Inject" clicked
8. Sidebar opens with pre-loaded summary
9. Click "Inject into chat"
10. Injected text appears in ChatGPT's input
11. Verify: handoff count badge decrements to 0

### Scenario B: Manual Sidebar Inject
1. Save a handoff on Gemini
2. Navigate to Perplexity, dismiss the auto-popup
3. Open sidebar manually via toolbar icon
4. Find handoff in Pending Handoffs list
5. Click "Inject" on that item
6. Verify injection on Perplexity

### Scenario C: Expiry
1. Manually set a handoff's `expiresAt` to a past date via DevTools console
2. Reload the page
3. Verify the handoff is purged on next page load
4. Verify badge count updates

### Scenario D: Storage Warning
1. Add enough large handoffs to approach 8MB
2. Verify warning banner appears in sidebar

---

## Known Integration Points to Verify

| Integration | What to check |
|---|---|
| Worker URL in content script | `chrome.runtime.getURL('summarizer/worker.js')` resolves correctly |
| Shadow DOM + Worker | Workers created from content scripts in shadow DOM work normally |
| Scraper in content script | `import { getScraperForPlatform }` from platforms/scrapers.js works in content script context |
| Badge update timing | Badge updates immediately after save/delete without requiring popup refresh |
| SPA re-detection | After SPA navigation in ChatGPT, new chat scraping works on new conversation |

---

## Validation Checklist

- [ ] Full Capture Flow (Scenario A) completes without errors on Claude and ChatGPT
- [ ] Full Inject Flow (Scenario A) completes — text appears in ChatGPT input
- [ ] Scenario B (manual inject from list) works on at least 2 platforms
- [ ] Scenario C (expiry) purges the handoff on page reload
- [ ] Badge count is accurate throughout the entire flow
- [ ] No console errors during any scenario
- [ ] Worker terminates cleanly when sidebar is closed
- [ ] Message responses never hang — all paths call sendResponse or postMessage
