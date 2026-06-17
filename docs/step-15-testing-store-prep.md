# Step 15 — Testing, Polish & Chrome Web Store Preparation

**Phase:** Shipping  
**Status:** Not Started  
**Depends On:** Step 14 (all features integrated)  

---

## Objective

Perform a full quality pass: fix all remaining bugs, validate the Definition of Done checklist from the requirements document, prepare the Chrome Web Store submission package, and write the README. At the end of this step, the extension is ready to submit to the Chrome Web Store.

---

## Files Modified / Created

| File | Action |
|---|---|
| `manifest.json` | Final version, description, icons verified |
| `README.md` | Complete developer and user documentation |
| All content/UI files | Bug fixes from test pass |
| `assets/icons/` | Final production icons |

---

## Definition of Done — Final Checklist

From the requirements document:

- [ ] Extension activates on all 5 platforms without errors
- [ ] Chat scraper correctly extracts full conversation from all 5 platforms
- [ ] Past chat history selection works on at least ChatGPT and Claude
- [ ] Local ONNX model downloads once and produces a valid structured summary
- [ ] Summary appears in editable sidebar text area before saving
- [ ] Handoff saved to `chrome.storage.local` with correct timestamp
- [ ] Auto-popup appears on destination platform when pending handoff exists
- [ ] Summary injects correctly into input box on all 5 platforms
- [ ] Handoffs older than 7 days (pro tier) are auto-purged on startup
- [ ] Manual delete of handoff works from sidebar
- [ ] Storage warning appears when nearing 8MB
- [ ] Extension passes Chrome Web Store review
- [ ] No console errors during normal use on any platform

---

## Platform Test Matrix

Test every combination that matters:

| Source | Destination | Capture | Inject |
|---|---|---|---|
| Claude | ChatGPT | ? | ? |
| Claude | Gemini | ? | ? |
| ChatGPT | Claude | ? | ? |
| ChatGPT | Perplexity | ? | ? |
| Gemini | DeepSeek | ? | ? |
| Perplexity | Claude | ? | ? |
| DeepSeek | ChatGPT | ? | ? |

Fill in ? with pass/fail. All cells must be "pass" before submission.

---

## Scraper Selector Validation

Run a manual check on all 5 platforms on the day of submission. DOM selectors may have changed since development:

```
For each platform:
  1. Open a conversation with at least 10 message turns
  2. Click "Summarize current chat"
  3. Verify: messages.length >= 10 in scraper output (check via console)
  4. Verify: no empty text fields in the message array
  5. Verify: roles alternate correctly (user, assistant, user, assistant...)
```

---

## Console Error Audit

Open DevTools on each of the 5 platforms and look for:

- Red errors with `[ContextBridge]` prefix — must be zero
- Uncaught promise rejections — must be zero
- CSP violations — must be zero
- ONNX Runtime warnings — acceptable (not errors)
- Network requests to external domains — must be zero (except the one-time model download)

---

## Chrome Web Store Requirements

### Manifest Fields Required

```json
{
  "name": "ContextBridge",
  "short_name": "ContextBridge",
  "version": "1.0.0",
  "description": "Bridge your AI sessions. Summarize and continue conversations across ChatGPT, Claude, Gemini, Perplexity, and DeepSeek — entirely on your device.",
  "homepage_url": "https://contextbridge.app"
}
```

- Description: max 132 characters for store listing tagline
- Detailed description: plain text, no markdown, max 16,000 characters

### Permissions Justification (Required for Review)

The store requires justification for each permission:

| Permission | Justification |
|---|---|
| `storage` | Saves handoff summaries locally between sessions |
| `unlimitedStorage` | Stores the ~400MB ONNX model in the Cache API |
| `activeTab` | Reads and injects into the currently active AI platform tab |
| `scripting` | Injects the sidebar UI into the host page |
| `host_permissions` (5 platforms) | Required to run content scripts on supported AI platforms |

### Privacy Policy

A privacy policy URL is required for extensions that handle user data. Minimum content:
- What data is collected (none — all local)
- How data is stored (chrome.storage.local only)
- Data never leaves the device
- No third-party sharing
- Contact email

### Screenshots Required

Minimum 1, maximum 5 screenshots (1280×800 or 640×400):
1. Sidebar open showing a structured summary
2. Auto-popup modal on destination platform
3. Text injected into ChatGPT input
4. Onboarding screen with download progress
5. Toolbar popup showing handoff count

### Promotional Images

- Small tile: 440×280 (optional but recommended)
- Marquee: 1400×560 (optional)

---

## Final Manifest Review

Check before submission:

```
- [ ] version is "1.0.0"
- [ ] No unused permissions declared
- [ ] content_security_policy has no 'unsafe-inline' or remote script sources
- [ ] All icon files exist at declared paths (16, 32, 48, 128)
- [ ] web_accessible_resources lists all files accessed via chrome.runtime.getURL
- [ ] background.service_worker points to existing file
- [ ] All content_scripts matchers are exact (no overly-broad patterns)
```

---

## README.md Contents

```markdown
# ContextBridge

Bridge your AI sessions. Never lose context again.

## What it does
...

## Supported Platforms
- ChatGPT
- Claude
- Gemini
- Perplexity
- DeepSeek

## Privacy
All summarization runs entirely on your device using a local ONNX model.
No conversation data is ever sent to any server.

## Development Setup
1. Clone the repo
2. Run `npm install` (for build tooling only)
3. Run `npm run build` to bundle dependencies
4. Load `dist/` as unpacked extension in Chrome

## Building from Source
...

## File Structure
...

## Model
The extension uses BART-large-CNN exported to ONNX format.
The model is downloaded once on first use (~380MB) and cached locally.
```

---

## Build & Bundle Process

Dependencies that need bundling (they cannot be loaded from CDN due to CSP):
- `onnxruntime-web` — ONNX Runtime WebAssembly files
- `@xenova/transformers` — BART tokenizer

```
Build tool: webpack or rollup
Entry points:
  - background.js
  - content/content.js
  - summarizer/worker.js
  - ui/popup.html (via html-webpack-plugin)
  - ui/onboarding.html

Output: dist/ folder
Extension loaded from: dist/
```

The `.wasm` files from `onnxruntime-web` are copied to `dist/summarizer/` and listed in `web_accessible_resources`.

---

## Post-Launch CI Check (Planned for v1.1)

Once shipped, set up a GitHub Actions workflow:
- Runs weekly on Monday
- Uses Playwright to navigate to each platform
- Runs the scraper against a test conversation
- Alerts via GitHub Issues if any platform's scraper returns 0 messages

This is not required for v1.0 submission but should be scheduled immediately after.

---

## Validation Checklist

- [ ] All 13 Definition of Done items checked off
- [ ] Full platform test matrix — all cells passing
- [ ] Zero console errors on any platform
- [ ] Privacy policy page published
- [ ] All 5 screenshots captured and sized correctly
- [ ] Permissions justification written for store submission form
- [ ] README.md complete and accurate
- [ ] Build process produces clean `dist/` with no dev artifacts
- [ ] Extension zip file under Chrome Web Store's 10MB limit for initial submission (excluding the model — model is downloaded at runtime)
- [ ] Submitted to Chrome Web Store developer dashboard
