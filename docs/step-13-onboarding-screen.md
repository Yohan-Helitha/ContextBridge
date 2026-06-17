# Step 13 — Onboarding Screen

**Phase:** UI & Integration  
**Status:** Not Started  
**Depends On:** Step 06 (model download), Step 12 (popup UI)  

---

## Objective

Build the one-time onboarding experience shown on first extension install. It explains the product in 3 steps, then triggers the ONNX model download with a progress bar. At the end of this step, a fresh install guides the user to a working, model-ready extension.

---

## Files Modified

| File | Action |
|---|---|
| `ui/onboarding.html` | New file — full onboarding page |
| `ui/onboarding.css` | New file — onboarding styles |
| `ui/onboarding.js` | New file — onboarding logic |
| `manifest.json` | Add onboarding.html to web_accessible_resources |
| `background.js` | Open onboarding tab on first install |

---

## Trigger

Onboarding opens automatically as a new tab on first install:

```js
// background.js — chrome.runtime.onInstalled
chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === 'install') {
    chrome.tabs.create({ url: chrome.runtime.getURL('ui/onboarding.html') });
  }
});
```

It is never shown again once `cb_onboarding_complete` is set to `true` in storage.

---

## Onboarding Layout — 3 Steps

The onboarding is a single-page flow with 3 cards and a final download step.

```
+------------------------------------------+
|         [ContextBridge Logo]             |
|    Your AI session memory bridge.        |
+------------------------------------------+

  Step 1 of 3                    [>]

  [Bridge icon]
  Hit a context limit?
  
  When an AI chat runs out of memory,
  ContextBridge saves exactly where you
  were — so you never lose your progress.

  [ Next ]
```

```
  Step 2 of 3               [<]  [>]

  [Summary icon]
  Your conversation, summarized locally.

  Our built-in AI model reads your chat
  and creates a structured summary —
  entirely on your device. Nothing leaves
  your browser.

  [ Next ]
```

```
  Step 3 of 3               [<]  [>]

  [Inject icon]
  Continue on any AI platform.

  Open ChatGPT, Gemini, Perplexity or
  DeepSeek and ContextBridge will ask
  if you want to continue — one click
  to inject your context.

  [ Get Started ]
```

```
  Almost ready!

  [ Downloading your summarizer... ]
  [████████████████░░░░░░░░░░] 62%
  encoder_model_quantized.onnx  · 214MB / 350MB

  This is a one-time download (~380MB).
  It will never be re-downloaded unless
  you reinstall the extension.

  [ Skip for now ]
```

---

## Step Navigation Logic

```js
let currentStep = 1;
const TOTAL_STEPS = 3;

function showStep(n) {
  document.querySelectorAll('.cb-step').forEach((el, i) => {
    el.style.display = i + 1 === n ? 'block' : 'none';
  });
  updateProgressDots(n);
}

document.getElementById('btn-next').addEventListener('click', () => {
  if (currentStep < TOTAL_STEPS) {
    currentStep++;
    showStep(currentStep);
  } else {
    showDownloadScreen();
  }
});
```

---

## Download Screen Logic

```js
async function showDownloadScreen() {
  document.getElementById('step-download').style.display = 'block';
  document.getElementById('step-main').style.display = 'none';

  // Check if already downloaded
  const statusResp = await chrome.runtime.sendMessage({
    type: 'CB_ACTION', action: 'GET_MODEL_STATUS'
  });
  
  if (statusResp.data.status === 'ready') {
    markOnboardingComplete();
    return;
  }

  // Start download
  await chrome.runtime.sendMessage({
    type: 'CB_ACTION', action: 'DOWNLOAD_MODEL', payload: { tier: 'pro' }
  });

  // Listen for progress
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'CB_MODEL_DOWNLOAD_PROGRESS') {
      updateProgressBar(message.percent);
      updateProgressLabel(message.fileName, message.received, message.total);
    }
    if (message.type === 'CB_MODEL_DOWNLOAD_COMPLETE') {
      markOnboardingComplete();
    }
    if (message.type === 'CB_MODEL_DOWNLOAD_ERROR') {
      showDownloadError(message.error);
    }
  });
}

function markOnboardingComplete() {
  chrome.storage.local.set({ cb_onboarding_complete: true });
  // Show success screen
  document.getElementById('step-download').innerHTML = `
    <div class="cb-success">
      <span class="cb-checkmark">✓</span>
      <h2>You're all set!</h2>
      <p>ContextBridge is ready. Open any supported AI platform to begin.</p>
      <button id="btn-finish">Open ChatGPT</button>
    </div>
  `;
  document.getElementById('btn-finish')?.addEventListener('click', () => {
    chrome.tabs.create({ url: 'https://chatgpt.com' });
    window.close();
  });
}
```

---

## "Skip for now" Behaviour

```js
document.getElementById('btn-skip-download').addEventListener('click', () => {
  // Mark onboarding complete even without model
  chrome.storage.local.set({ cb_onboarding_complete: true });
  // User can trigger download later from popup or sidebar
  window.close();
});
```

If the user skips the model download:
- The extension installs without the model.
- On any attempt to summarize, the sidebar shows: "Summarizer not ready — download the model first." with a button to trigger the download.

---

## Progress Bar Component

```js
function updateProgressBar(percent) {
  const bar = document.getElementById('cb-download-bar-fill');
  bar.style.width = `${percent}%`;
  document.getElementById('cb-download-percent').textContent = `${percent}%`;
}

function updateProgressLabel(fileName, received, total) {
  const mb = n => (n / 1024 / 1024).toFixed(1);
  document.getElementById('cb-download-file').textContent =
    `${fileName}  ·  ${mb(received)}MB / ${mb(total)}MB`;
}
```

---

## Retry on Download Failure

```js
function showDownloadError(errorMessage) {
  document.getElementById('cb-download-progress').style.display = 'none';
  document.getElementById('cb-download-error').style.display = 'block';
  document.getElementById('cb-error-message').textContent = errorMessage;
}

document.getElementById('btn-retry-download').addEventListener('click', () => {
  document.getElementById('cb-download-error').style.display = 'none';
  document.getElementById('cb-download-progress').style.display = 'block';
  showDownloadScreen(); // re-trigger download
});
```

---

## Onboarding CSS Principles

- Full-page centered layout with max-width 600px
- Clean white/off-white background with subtle card shadow
- Progress dots at top (Step 1 of 3)
- Large readable font (18px body)
- Prominent CTA buttons in brand blue (#3B82F6)
- Responsive — works at any browser window size
- No external resources (fonts, images loaded inline as data URIs or SVG)

---

## Validation Checklist

- [ ] Onboarding tab opens automatically on first install
- [ ] Onboarding does NOT open on extension update (only on `reason === 'install'`)
- [ ] All 3 steps display correctly with Next/Back navigation
- [ ] "Get Started" on step 3 triggers download screen
- [ ] Download progress bar updates in real time
- [ ] Correct file name and MB progress shown during download
- [ ] On download complete — success screen shown
- [ ] On download error — error shown with retry button
- [ ] Retry successfully re-starts the download
- [ ] "Skip for now" closes onboarding without downloading
- [ ] `cb_onboarding_complete` is set to `true` after completion or skip
- [ ] Onboarding page is never shown again after `cb_onboarding_complete === true`
