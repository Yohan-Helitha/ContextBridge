# Step 01 — Project Scaffolding & Manifest Setup

**Phase:** Architecture  
**Status:** Not Started  
**Depends On:** Nothing — this is the foundation  

---

## Objective

Create the complete folder structure, `manifest.json`, placeholder files, and all static assets so the extension can be loaded unpacked into Chrome immediately. At the end of this step the extension installs without errors but does nothing functional.

---

## Files to Create

```
contextbridge/
├── manifest.json
├── background.js                  (empty stub)
├── content/
│   ├── content.js                 (empty stub)
│   ├── sidebar.js                 (empty stub)
│   ├── autopopup.js               (empty stub)
│   └── injector.js                (empty stub)
├── platforms/
│   └── scrapers.js                (empty stub)
├── summarizer/
│   ├── summarizer.js              (empty stub)
│   ├── preprocess.js              (empty stub)
│   ├── postprocess.js             (empty stub)
│   └── models/                    (empty dir — .gitkeep)
├── storage/
│   └── handoff-store.js           (empty stub)
├── ui/
│   ├── sidebar.html               (skeleton HTML)
│   ├── sidebar.css                (empty)
│   ├── popup.html                 (skeleton HTML)
│   └── popup.css                  (empty)
├── assets/
│   └── icons/
│       ├── icon16.png
│       ├── icon32.png
│       ├── icon48.png
│       └── icon128.png
└── README.md
```

---

## manifest.json — Full Specification

```json
{
  "manifest_version": 3,
  "name": "ContextBridge",
  "version": "1.0.0",
  "description": "Bridge your AI sessions — summarize and continue conversations across ChatGPT, Claude, Gemini, Perplexity, and DeepSeek.",
  "permissions": [
    "storage",
    "unlimitedStorage",
    "activeTab",
    "scripting"
  ],
  "host_permissions": [
    "https://chatgpt.com/*",
    "https://claude.ai/*",
    "https://gemini.google.com/*",
    "https://www.perplexity.ai/*",
    "https://chat.deepseek.com/*"
  ],
  "background": {
    "service_worker": "background.js",
    "type": "module"
  },
  "content_scripts": [
    {
      "matches": [
        "https://chatgpt.com/*",
        "https://claude.ai/*",
        "https://gemini.google.com/*",
        "https://www.perplexity.ai/*",
        "https://chat.deepseek.com/*"
      ],
      "js": ["content/content.js"],
      "css": [],
      "run_at": "document_idle"
    }
  ],
  "action": {
    "default_popup": "ui/popup.html",
    "default_icon": {
      "16": "assets/icons/icon16.png",
      "32": "assets/icons/icon32.png",
      "48": "assets/icons/icon48.png",
      "128": "assets/icons/icon128.png"
    },
    "default_title": "ContextBridge"
  },
  "content_security_policy": {
    "extension_pages": "script-src 'self' 'wasm-unsafe-eval'; object-src 'self';"
  },
  "web_accessible_resources": [
    {
      "resources": [
        "ui/sidebar.html",
        "ui/sidebar.css",
        "ui/popup.css",
        "assets/icons/*",
        "summarizer/models/*"
      ],
      "matches": [
        "https://chatgpt.com/*",
        "https://claude.ai/*",
        "https://gemini.google.com/*",
        "https://www.perplexity.ai/*",
        "https://chat.deepseek.com/*"
      ]
    }
  ]
}
```

### Key Decisions

| Decision | Reason |
|---|---|
| `"type": "module"` on service worker | Allows ES module imports in background.js |
| `wasm-unsafe-eval` in CSP | Required by ONNX Runtime Web to execute WebAssembly |
| `unlimitedStorage` declared upfront | Pro tier needs it; no harm declaring it free too |
| `run_at: "document_idle"` | Ensures the platform SPA has rendered before we inject |
| No `content_scripts` CSS entry | Sidebar is injected via JS shadow DOM to avoid style conflicts |

---

## Icon Specification

Create 4 PNG icons at sizes 16×16, 32×32, 48×48, 128×128.  
Design: A simple bridge silhouette or chain-link icon in a blue/teal colour scheme.  
Placeholder: Use any solid-colour PNG until real icons are designed.

---

## Stub File Content

Every stub file starts with a module-level comment describing its purpose. No logic yet — just a comment and an empty default export or empty event listener stub. This ensures the extension loads without JS parse errors.

Example stub (`content/content.js`):
```js
// ContextBridge — Content Script Entry Point
// Injected into all 5 AI platforms. Detects platform, initialises sidebar and auto-popup.
// Full implementation: Step 03

console.debug('[ContextBridge] content.js loaded on', window.location.hostname);
```

---

## popup.html Skeleton

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>ContextBridge</title>
  <link rel="stylesheet" href="popup.css" />
</head>
<body>
  <div id="cb-popup-root">
    <p>ContextBridge — loading…</p>
  </div>
  <script src="../content/sidebar.js" type="module"></script>
</body>
</html>
```

---

## sidebar.html Skeleton

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>ContextBridge Sidebar</title>
  <link rel="stylesheet" href="sidebar.css" />
</head>
<body>
  <div id="cb-sidebar-root">
    <p>ContextBridge Sidebar — loading…</p>
  </div>
</body>
</html>
```

---

## Validation Checklist

- [ ] Extension loads in Chrome via `chrome://extensions` → "Load unpacked" without errors
- [ ] Popup opens when clicking the toolbar icon
- [ ] No CSP errors in browser console
- [ ] All 5 host URLs match the manifest `host_permissions`
- [ ] `console.debug` log appears on each of the 5 AI platforms when navigating to them
- [ ] Folder structure exactly matches the spec above
