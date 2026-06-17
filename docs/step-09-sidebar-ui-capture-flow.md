# Step 09 — Sidebar UI & Capture Flow

**Phase:** UI & Integration  
**Status:** Not Started  
**Depends On:** Step 04 (storage), Step 05 (scrapers), Step 07–08 (summarizer worker)  

---

## Objective

Build the full Sidebar Panel UI injected into the host page via Shadow DOM. This implements the complete **Capture Flow** — from clicking "Summarize current chat" through to "Save Handoff". At the end of this step, a user can open the sidebar, trigger summarization, see a real structured summary in an editable text area, and save it as a handoff.

---

## Files Modified

| File | Action |
|---|---|
| `content/sidebar.js` | Full implementation |
| `ui/sidebar.html` | Full markup |
| `ui/sidebar.css` | Full styles |

---

## Sidebar Layout

```
+----------------------------------+
| [x]        ContextBridge         |
+----------------------------------+
| ACTIVE HANDOFF                   |
|  [ Summarize current chat ]      |
|  [ Pick a past chat  (experimental) ]  |
+----------------------------------+
| -- Loading state --              |
|  Generating summary...           |
|  [████████░░░░] 65%              |
+----------------------------------+
| -- Summary state --              |
|  [textarea: editable summary]    |
|  [ Save Handoff ]                |
+----------------------------------+
| PENDING HANDOFFS (2)             |
|  Claude · 2h ago  [Inject] [x]   |
|  ChatGPT · 5h ago [Inject] [x]   |
+----------------------------------+
| [Settings]                       |
| Storage: ████░░░░ 3.2MB / 8MB    |
+----------------------------------+
```

---

## Sidebar State Machine

```
States:
  'idle'        → default, show "Summarize current chat" button
  'scraping'    → reading DOM messages
  'summarizing' → worker processing (show progress bar)
  'review'      → summary ready in editable textarea
  'saved'       → confirmation message shown briefly, then back to 'idle'
  'error'       → show error message + retry button
```

State is managed in `sidebar.js` as a local variable — not persisted to storage.

---

## Key UI Interactions

### Summarize Current Chat

```
User clicks "Summarize current chat":
  1. setState('scraping')
  2. Call scraper: scrapeMessages(platform) -> Message[]
  3. If messages.length === 0: setState('error', 'No messages found in this chat')
  4. Else: setState('summarizing')
  5. Spawn/message the Web Worker: { action: 'SUMMARIZE', messages, sourcePlatform }
  6. Listen for worker progress events -> update progress bar %
  7. On worker RESULT: populate textarea, setState('review')
  8. On worker ERROR: setState('error', err.message)
```

### Save Handoff

```
User clicks "Save Handoff":
  1. Read current textarea value (may have been edited by user)
  2. Re-parse structuredSummary from edited text using extractStructuredSummary()
  3. Rebuild injectedPrompt from updated structured summary
  4. sendToBackground({ action: 'SAVE_HANDOFF', payload: { handoff } })
  5. setState('saved') — show confirmation for 2 seconds
  6. Reload pending handoffs list
  7. setState('idle')
```

### Pick a Past Chat

```
User clicks "Pick a past chat":
  1. Call scraper's getHistoryList(platform) -> HistoryItem[]
  2. Render list of chat titles in sidebar
  3. User clicks a title
  4. Call scraper's navigateToHistory(url)
  5. Wait for page load (listen for DOM change)
  6. Proceed from step 2 of "Summarize current chat" flow above
  7. Show "(experimental)" label throughout this flow
```

---

## Editable Summary Format in Textarea

The textarea displays the structured summary in the 5-marker format so the user can read and edit it:

```
[TOPIC] Photosynthesis — light-dependent reactions
[COVERED] Photosystem II, water splitting, electron transport chain
[LAST POINT] How ATP synthase uses the proton gradient
[OPEN THREADS] Difference between cyclic and non-cyclic photophosphorylation
[CONTINUE FROM] Please continue explaining ATP synthase and the chemiosmosis process.
```

The user edits the raw text. On save, the markers are parsed again to reconstruct the structured object.

---

## Pending Handoffs List

Each item in the list shows:
- Source platform icon/name
- Chat title (truncated to 40 chars)
- Age (e.g. "2h ago", "1d ago")
- `[Inject]` button — switches to inject flow (Step 11)
- `[x]` delete button — calls `sendToBackground({ action: 'DELETE_HANDOFF', payload: { id } })`

List is refreshed from background on:
- Sidebar open
- After save
- After delete
- After inject

---

## Storage Usage Bar

```js
async function updateStorageBar() {
  const { usedBytes } = await sendToBackground('GET_STORAGE_USAGE');
  const percent = Math.min(100, (usedBytes / (8 * 1024 * 1024)) * 100);
  storageBar.style.width = `${percent}%`;
  storageLabel.textContent = `${(usedBytes / 1024 / 1024).toFixed(1)}MB / 8MB`;
  if (percent >= 100) {
    warningBanner.style.display = 'block';
    warningBanner.textContent = 'Storage almost full — consider deleting old handoffs.';
  }
}
```

---

## Shadow DOM Rendering

The sidebar is injected into the Shadow DOM root created in Step 03:

```js
export function initSidebar(platform, shadowRoot) {
  // Inject sidebar HTML into shadow root
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = chrome.runtime.getURL('ui/sidebar.css');
  shadowRoot.appendChild(link);

  const container = document.createElement('div');
  container.id = 'cb-sidebar';
  container.innerHTML = SIDEBAR_HTML_TEMPLATE;
  shadowRoot.appendChild(container);

  bindEvents(platform, shadowRoot);
  loadPendingHandoffs();
  updateStorageBar();
}
```

The sidebar CSS uses a fixed-width right-side drawer that slides in. All CSS is scoped to `#cb-sidebar` inside the shadow root.

---

## Sidebar CSS Principles

- Width: 360px, fixed right side, full height
- Z-index: inherited from host (already set to max in Step 03)
- Font: system-ui, -apple-system — matches host OS
- Color scheme: dark-mode aware via `prefers-color-scheme`
- No external font loads — no network requests from CSS
- Slide-in animation: CSS `transform: translateX(100%)` -> `translateX(0)` with `transition: 0.2s ease`

---

## Validation Checklist

- [ ] Sidebar opens and closes without affecting the host page layout
- [ ] "Summarize current chat" triggers scraping and shows progress bar
- [ ] Progress bar updates as the worker sends PROGRESS events
- [ ] Completed summary appears in editable textarea in the 5-marker format
- [ ] User can edit the textarea content before saving
- [ ] "Save Handoff" saves to storage and shows confirmation
- [ ] Pending handoffs list renders all pending items with correct age labels
- [ ] Delete button removes a handoff from list and storage
- [ ] Storage usage bar reflects actual bytes used
- [ ] Warning banner appears when over 8MB
- [ ] Sidebar Shadow DOM does not leak any styles into the host platform page
- [ ] Sidebar works on all 5 platforms (no z-index or layout collisions)
