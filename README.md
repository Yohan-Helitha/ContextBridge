# ContextBridge

Bridge your AI sessions. Never lose context again.

ContextBridge is a Chrome extension that acts as an intelligent memory bridge between AI chat platforms. When you hit a context limit on one AI, the extension reads the conversation, generates a structured summary using a local ML model running entirely in your browser, and lets you inject that summary into a new AI session — so you can continue exactly where you left off.

---

## Supported Platforms

- ChatGPT (`chatgpt.com`)
- Claude (`claude.ai`)
- Gemini (`gemini.google.com`)
- Perplexity (`perplexity.ai`)
- DeepSeek (`chat.deepseek.com`)

---

## Privacy

All summarization runs entirely on your device using a local ONNX model (BART-large-CNN, ~380MB, downloaded once on first use). No conversation data is ever sent to any server. No accounts. No API keys.

---

## Development Setup

> **Status:** Active development — Step 01 scaffold complete.

### Prerequisites

- Chrome or any Chromium-based browser (Brave, Edge, Arc)
- Node.js 18+ (for build tooling — added in a later step)

### Load the extension (unpacked)

1. Clone the repo
2. Open `chrome://extensions`
3. Enable **Developer mode** (top-right toggle)
4. Click **Load unpacked**
5. Select the `ContextBridge` folder (this repo root)

The extension installs immediately. At this scaffold stage it logs a debug message on each supported platform and does nothing else.

---

## Project Structure

```
contextbridge/
├── manifest.json                  MV3 extension manifest
├── background.js                  Service worker: routing, storage, model manager
├── content/
│   ├── content.js                 Entry point injected on all 5 platforms
│   ├── sidebar.js                 Sidebar UI logic
│   ├── autopopup.js               Auto-popup modal on destination platform
│   └── injector.js                Injects summary into chat input box
├── platforms/
│   └── scrapers.js                Per-platform DOM selectors and scrape logic
├── summarizer/
│   ├── summarizer.js              ONNX Runtime Web wrapper and model loader
│   ├── preprocess.js              Conversation formatter and tokenizer
│   ├── postprocess.js             Structured summary extractor and prompt builder
│   ├── worker.js                  Web Worker running the full inference pipeline
│   └── models/                    ONNX model files (downloaded at runtime, not bundled)
├── storage/
│   └── handoff-store.js           Handoff CRUD, expiry, and quota logic
├── ui/
│   ├── sidebar.html / sidebar.css Sidebar panel markup and styles
│   └── popup.html  / popup.css    Toolbar popup markup and styles
├── assets/
│   └── icons/                     Extension icons (16, 32, 48, 128px)
└── docs/                          Step-by-step build documents
```

---

## Build Steps

| Step | Description | Status |
|---|---|---|
| 01 | Project Scaffolding & Manifest | ✅ Complete |
| 02 | Background Service Worker | 🔲 Not started |
| 03 | Content Script & Platform Detection | 🔲 Not started |
| 04 | Handoff Storage Layer | 🔲 Not started |
| 05 | Chat Scrapers (5 platforms) | 🔲 Not started |
| 06 | ONNX Model Infrastructure | 🔲 Not started |
| 07 | Summarizer Preprocessing | 🔲 Not started |
| 08 | Summarizer Postprocessing | 🔲 Not started |
| 09 | Sidebar UI & Capture Flow | 🔲 Not started |
| 10 | Auto-Popup Modal | 🔲 Not started |
| 11 | Injection Handler | 🔲 Not started |
| 12 | Toolbar Popup UI | 🔲 Not started |
| 13 | Onboarding Screen | 🔲 Not started |
| 14 | End-to-End Integration | 🔲 Not started |
| 15 | Testing & Chrome Store Prep | 🔲 Not started |

---

## License

TBD
