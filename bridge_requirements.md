# ContextBridge — Extension Requirements Document
**Version:** 1.0  
**Status:** Finalized  
**Last Updated:** 2026-05-04  
**Type:** Browser Extension (Manifest V3)  

---

## 1. Product Overview

ContextBridge is a browser extension that acts as an intelligent memory bridge between AI chat platforms. When a user hits a context limit on one AI (e.g. Claude), the extension reads the conversation, generates a structured summary using a local ML model running entirely in the browser, and allows the user to inject that summary into a new AI session (e.g. ChatGPT) — so they can continue exactly where they left off without rewriting a catch-up prompt.

The extension is **opt-in and user-activated**. It does nothing until the user explicitly triggers it. All summarization happens locally on the device using a bundled ONNX model. No conversation data is ever sent to a third-party server.

---

## 2. Target Platforms

Supported for both chat reading (scraping) and context injection at launch.

| Platform | URL Pattern |
|---|---|
| ChatGPT | `https://chatgpt.com/*` |
| Claude | `https://claude.ai/*` |
| Gemini | `https://gemini.google.com/*` |
| Perplexity | `https://www.perplexity.ai/*` |
| DeepSeek | `https://chat.deepseek.com/*` |

---

## 3. Architecture Overview

```
┌─────────────────────────────────────────────────┐
│                Browser Extension                │
│                                                 │
│  Content Script (per platform)                  │
│  ├── Chat Scraper        reads DOM messages     │
│  ├── Inject Handler      writes to input box    │
│  └── UI Layer            sidebar + popup        │
│                                                 │
│  Background Service Worker                      │
│  ├── Handoff Store       chrome.storage.local   │
│  ├── Expiry Manager      purges after 24h       │
│  └── Model Manager       loads ONNX model       │
│                                                 │
│  Summarizer (ONNX Runtime Web)                  │
│  ├── Free tier model     ~60MB, DistilBART      │
│  └── Pro tier model      ~400MB, BART-large     │
└─────────────────────────────────────────────────┘
          │ chrome.storage.local only
          │ No external network calls
          ▼
     User's Device
```

- **No backend.** No API keys. No accounts required at launch.
- **Model runs in-browser** via ONNX Runtime Web (WebAssembly).
- **Storage:** `chrome.storage.local` (free: 10MB cap), `unlimitedStorage` permission (pro).
- **Browsers at launch:** Chrome and all Chromium-based browsers (Brave, Edge, Arc).
- **Future:** Firefox, Safari (post-MVP).

---

## 4. User Flow

### 4.1 Capture Flow (Source Platform)

1. User is studying with an AI and approaches or hits the context limit.
2. User clicks the **ContextBridge toolbar icon** — this activates the extension for this session.
3. Extension sidebar opens showing two options:
   - **Summarize current chat** (default — reads the visible conversation)
   - **Pick a past chat** (optional — shows a list of past conversations from that platform's sidebar/history)
4. User selects a chat. Extension scrapes the full message list from the DOM.
5. Sidebar shows a loading state: "Generating summary with local model…"
6. Local ONNX summarizer processes the conversation and produces a structured handoff summary.
7. Summary appears in the sidebar in an **editable text area** — user can read, adjust, or trim it.
8. User clicks **"Save Handoff"**. Summary is stored in `chrome.storage.local` with a `createdAt` timestamp.
9. Sidebar confirms: "Handoff saved. Ready to continue on another platform."

### 4.2 Inject Flow (Destination Platform)

1. User navigates to a different AI platform (e.g. moves from Claude to ChatGPT).
2. Extension detects a pending handoff exists and **auto-pops up immediately** — a small modal overlay appears in the corner of the screen.
3. Modal shows: "You have a pending handoff from [Claude]. Want to continue your session here?"
4. Two action buttons: **"Review & Inject"** and **"Dismiss"**.
5. User clicks "Review & Inject" — the full editable summary opens in the sidebar.
6. User can make final edits to the summary text.
7. User clicks **"Inject into chat"** — the summary is inserted into the platform's input box as a visible prompt, ready to send.
8. User reviews the injected text in the input box, then presses send.
9. The new AI receives the context and the user continues their session seamlessly.
10. After successful injection, the handoff is marked as used and removed from storage.

---

## 5. Handoff Expiry & Storage Management

- Every saved handoff includes a `createdAt` UTC timestamp.
- On every extension startup and every platform page load, the background service worker checks all stored handoffs.
- Any handoff older than **24 hours** is automatically purged from `chrome.storage.local`.
- A maximum of **5 pending handoffs** can exist at once on the free tier (oldest is purged first when limit is exceeded).
- Users can manually delete any pending handoff from the sidebar at any time.
- If storage usage exceeds 8MB (free) the extension shows a warning banner: "Storage almost full — consider deleting old handoffs."

---

## 6. Summarizer — Local ML Model

### 6.1 Design Principle

The summarizer is built and bundled into the extension. It does not call any external AI API. Summarization runs entirely on the user's device using ONNX Runtime Web.

### 6.2 Free Tier Model

| Property | Spec |
|---|---|
| Model | DistilBART-CNN-12-6 (or equivalent distilled abstractive model) |
| Format | ONNX, quantized (int8) |
| Download size | ~55–70MB (one-time, on first use) |
| Runtime | ONNX Runtime Web via WebAssembly |
| Summary style | Abstractive — rewrites content, does not just extract sentences |
| Max input tokens | ~1,024 tokens (~750 words of conversation) |
| Output | 1 structured paragraph, 80–150 words |

### 6.3 Pro Tier Model

| Property | Spec |
|---|---|
| Model | BART-large-CNN or fine-tuned equivalent |
| Format | ONNX, quantized |
| Download size | ~350–420MB (one-time, stored in pro user storage) |
| Summary quality | Noticeably more structured, better topic continuity, handles longer chats |
| Max input tokens | ~4,096 tokens |
| Output | Structured summary with topic header + progress paragraph + open threads |

### 6.4 Model Download UX

- On first activation, the extension shows a one-time **"Downloading your summarizer"** screen with a progress bar.
- Download happens via the background service worker and is cached using the Cache API.
- If the download fails or is interrupted, a retry button is shown.
- The model is never re-downloaded unless the extension is reinstalled or the user clears browser data.

### 6.5 Structured Summary Format

For study sessions, the summary follows this structure regardless of model tier:

```
[TOPIC] What subject/topic was being studied
[COVERED] What has been explained and understood so far
[LAST POINT] The exact concept or question the session ended on
[OPEN THREADS] Any questions left unanswered or flagged for later
[CONTINUE FROM] A one-sentence instruction for the new AI to resume from
```

The injected prompt wraps this in natural language so the receiving AI understands the context immediately without needing special formatting.

---

## 7. Chat Scraping — Per Platform

Each platform renders conversations differently. All scraping is read-only DOM access inside the content script. No platform APIs or credentials are used.

| Platform | Message container (approximate) | Speaker detection |
|---|---|---|
| ChatGPT | `div[data-message-author-role]` | `data-message-author-role="user"` vs `"assistant"` |
| Claude | `.font-claude-message` / conversation turn divs | Alternating turn structure |
| Gemini | `message-content` components | User vs model role classes |
| Perplexity | `.prose` answer blocks + user query divs | Position + class-based |
| DeepSeek | Chat message list items | Role attribute or class |

> **Note:** All selectors are isolated in `platforms/scrapers.js` and must be validated at build time. A CI check will ping each platform weekly to detect selector breakage. Scraper logic is versioned independently from the rest of the extension so hotfixes can ship fast.

### 7.1 Past Chat History (Optional Selection)

- When the user chooses "Pick a past chat", the extension reads the platform's sidebar/history list from the DOM.
- It renders the list of recent chat titles in the extension sidebar.
- User clicks a title — extension navigates to that chat URL in the current tab, waits for it to load, then scrapes it.
- This flow is clearly labelled as "experimental" in the UI since history DOM structures vary most across platforms.

---

## 8. Storage Tiers

| Feature | Free | Pro |
|---|---|---|
| Storage quota | 10MB (`chrome.storage.local` default) | Unlimited (`unlimitedStorage` permission) |
| Max pending handoffs | 5 | Unlimited |
| Handoff expiry | 24 hours | 7 days |
| Summarizer model | DistilBART (~65MB) | BART-large (~400MB) |
| Max conversation length | ~750 words | ~3,000 words |
| Summary output quality | Good | High |
| Platforms supported | All 5 | All 5 |
| Price | Free | $4/month or $36/year |

---

## 9. UI Components

### 9.1 Toolbar Popup
- Extension icon in Chrome toolbar
- Shows: active handoffs count badge, quick "Activate" button, link to sidebar

### 9.2 Sidebar Panel
- Opens as a side drawer injected into the page
- Sections: Active Handoff, Pending Handoffs list, Settings
- Editable text area for reviewing/editing summary before save or inject
- Delete button per handoff
- Storage usage indicator at bottom

### 9.3 Auto-Popup Modal (Destination Platform)
- Appears automatically in bottom-right corner when a pending handoff is detected
- Non-blocking — does not prevent the user from using the AI platform
- Shows: source platform name, handoff age, "Review & Inject" and "Dismiss" buttons
- Auto-dismisses after 30 seconds if user takes no action (handoff remains saved)
- Respects user preference: "Don't auto-popup on this platform" checkbox

### 9.4 Onboarding Screen
- Shown once on first install
- Explains the bridge concept in 3 steps with simple illustrations
- Triggers model download with progress bar

---

## 10. Privacy & Security

- No conversation data is ever transmitted outside the user's browser.
- The ONNX model runs in a Web Worker — conversation text is processed in memory and discarded after summarization.
- The extension requests only the permissions it needs: `storage`, `activeTab`, `scripting`, `unlimitedStorage` (pro).
- No analytics, no telemetry, no crash reporting in v1.
- Extension manifest declares `content_security_policy` with no remote script sources.
- All stored handoff summaries are plain text — no raw message logs are ever stored, only the generated summary.

---

## 11. File Structure

```
contextbridge/
├── manifest.json
├── background.js                  # Service worker: expiry, model manager, storage
├── content/
│   ├── content.js                 # Entry point injected on all 5 platforms
│   ├── sidebar.js                 # Sidebar UI logic
│   ├── autopopup.js               # Handoff detection + auto-popup on destination
│   └── injector.js                # Injects summary into chat input
├── platforms/
│   └── scrapers.js                # Per-platform DOM selectors + scrape logic
├── summarizer/
│   ├── summarizer.js              # ONNX Runtime Web wrapper + model loader
│   ├── preprocess.js              # Tokenizer + conversation formatter
│   ├── postprocess.js             # Structures raw model output into handoff format
│   └── models/                    # ONNX model files (downloaded on first use, not bundled)
├── storage/
│   └── handoff-store.js           # CRUD + expiry logic for handoffs
├── ui/
│   ├── sidebar.html
│   ├── sidebar.css
│   ├── popup.html
│   └── popup.css
├── assets/
│   └── icons/
└── README.md
```

---

## 12. Data Model

### Handoff Object
```json
{
  "id": "uuid-v4",
  "sourcePlatform": "claude",
  "chatTitle": "Photosynthesis — Light reactions",
  "rawSummary": "We were studying photosynthesis...",
  "structuredSummary": {
    "topic": "Photosynthesis — light-dependent reactions",
    "covered": "Photosystem II, water splitting, electron transport chain",
    "lastPoint": "How ATP synthase uses the proton gradient",
    "openThreads": ["Difference between cyclic and non-cyclic photophosphorylation"],
    "continueFrom": "Please continue explaining ATP synthase and the chemiosmosis process."
  },
  "injectedPrompt": "We were previously studying photosynthesis...[full natural language paragraph]",
  "createdAt": "2026-05-04T10:00:00Z",
  "expiresAt": "2026-05-05T10:00:00Z",
  "status": "pending | injected | expired | dismissed"
}
```

---

## 13. Out of Scope (v1.0)

- Cloud sync or cross-device handoff
- Firefox / Safari support
- User accounts or login
- Multi-handoff chaining (A → B → C)
- Real-time collaboration
- Voice or image context in handoffs
- Fine-tuning the summarizer on user data
- Analytics of any kind

---

## 14. Definition of Done

The MVP is complete when:

- [ ] Extension activates on all 5 platforms without errors
- [ ] Chat scraper correctly extracts full conversation from all 5 platforms
- [ ] Past chat history selection works on at least ChatGPT and Claude
- [ ] Local ONNX model downloads once and produces a valid structured summary
- [ ] Summary appears in editable sidebar text area before saving
- [ ] Handoff saved to `chrome.storage.local` with correct timestamp
- [ ] Auto-popup appears on destination platform when pending handoff exists
- [ ] Summary injects correctly into input box on all 5 platforms
- [ ] Handoffs older than 24 hours are auto-purged on startup
- [ ] Manual delete of handoff works from sidebar
- [ ] Storage warning appears when nearing 8MB
- [ ] Extension passes Chrome Web Store review
- [ ] No console errors during normal use on any platform
