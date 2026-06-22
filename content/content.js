// ContextBridge — Content Script Entry Point
// Injected into all 5 AI platforms. Detects platform, initialises sidebar and auto-popup.

// Stubs — replaced by full implementations in Steps 09 and 10.
// Using inline stubs here to avoid ES module import issues in content scripts
// before a build step is introduced (Step 15).
function initSidebar(platform, shadowRoot) {
  console.log('[ContextBridge] sidebar stub — platform:', platform);
}
function initAutoPopup(platform, handoffs, shadowRoot) {
  console.log('[ContextBridge] autopopup stub — platform:', platform, '| pending handoffs:', handoffs.length);
}

// ---------------------------------------------------------------------------
// Scraper — Step 05
// ---------------------------------------------------------------------------

// Lazily loaded so content scripts don't block on module parse at startup.
let _scraperModule = null;
async function getScraperModule() {
  if (!_scraperModule) {
    _scraperModule = await import(chrome.runtime.getURL('platforms/scrapers.js'));
  }
  return _scraperModule;
}

/**
 * Scrape the current page's chat conversation using the platform-specific scraper.
 * Returns a normalised Message[] array. Exposed on window for console testing.
 * @returns {Promise<import('../platforms/scrapers.js').Message[]>}
 */
async function scrapeCurrentChat() {
  const platform = detectPlatform();
  if (!platform) {
    console.warn('[ContextBridge] scrapeCurrentChat: not on a supported platform');
    return [];
  }
  try {
    const { getScraperForPlatform } = await getScraperModule();
    const scraper = getScraperForPlatform(platform);
    if (!scraper) {
      console.warn('[ContextBridge] scrapeCurrentChat: no scraper for platform:', platform);
      return [];
    }
    const messages = await scraper.scrapeMessages();
    console.log(`[ContextBridge] scrapeCurrentChat: ${messages.length} messages scraped from ${platform}`);
    return messages;
  } catch (e) {
    console.error('[ContextBridge] scrapeCurrentChat error:', e.message);
    return [];
  }
}

// ---------------------------------------------------------------------------
// Platform Detection
// ---------------------------------------------------------------------------

const PLATFORMS = {
  'chatgpt.com':        'chatgpt',
  'claude.ai':          'claude',
  'gemini.google.com':  'gemini',
  'www.perplexity.ai':  'perplexity',
  'chat.deepseek.com':  'deepseek',
};

function detectPlatform() {
  return PLATFORMS[window.location.hostname] ?? null;
}

// ---------------------------------------------------------------------------
// Shadow DOM Host
// ---------------------------------------------------------------------------

let _shadowRoot = null;

function createSidebarHost() {
  // Only create once per page load
  if (document.getElementById('contextbridge-sidebar-host')) {
    return _shadowRoot;
  }
  const host = document.createElement('div');
  host.id = 'contextbridge-sidebar-host';
  host.style.cssText = 'position:fixed;top:0;right:0;z-index:2147483647;width:0;height:0;';
  const shadow = host.attachShadow({ mode: 'open' });
  document.body.appendChild(host);
  _shadowRoot = shadow;
  return shadow;
}

function getSidebarShadowRoot() {
  return _shadowRoot;
}

// ---------------------------------------------------------------------------
// Background Communication
// ---------------------------------------------------------------------------

async function sendToBackground(action, payload = null) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      { type: 'CB_ACTION', action, payload },
      (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        if (!response || !response.success) {
          reject(new Error(response?.error ?? 'Unknown error'));
          return;
        }
        resolve(response.data);
      }
    );
  });
}

// Retry once after 200ms — handles the case where the service worker is waking up
async function sendToBackgroundWithRetry(action, payload = null) {
  try {
    return await sendToBackground(action, payload);
  } catch (e) {
    if (e.message.includes('Could not establish connection') ||
        e.message.includes('Receiving end does not exist')) {
      await new Promise(r => setTimeout(r, 200));
      try {
        return await sendToBackground(action, payload);
      } catch (e2) {
        console.warn('[ContextBridge] Background unreachable after retry:', e2.message);
        return null;
      }
    }
    throw e;
  }
}

// ---------------------------------------------------------------------------
// Core Logic
// ---------------------------------------------------------------------------

let _sidebarInitialised = false;
let _autoPopupShownThisSession = false;

function openSidebar(platform, shadowRoot) {
  if (_sidebarInitialised) return;
  _sidebarInitialised = true;
  initSidebar(platform, shadowRoot);
}

async function recheckHandoffs(platform, shadowRoot) {
  try {
    await sendToBackgroundWithRetry('PURGE_EXPIRED');
    const data = await sendToBackgroundWithRetry('GET_HANDOFFS');
    const pending = (data?.handoffs ?? []).filter(h => h.status === 'pending');
    if (pending.length > 0 && !_autoPopupShownThisSession) {
      _autoPopupShownThisSession = true;
      initAutoPopup(platform, pending, shadowRoot);
    }
  } catch (e) {
    console.warn('[ContextBridge] recheckHandoffs error:', e.message);
  }
}

// ---------------------------------------------------------------------------
// SPA Navigation Detection
// ---------------------------------------------------------------------------

function watchSpaNavigation(platform, shadowRoot) {
  let lastTitle = document.title;

  // Title change observer — most reliable across all 5 platforms
  const observer = new MutationObserver(() => {
    if (document.title !== lastTitle) {
      lastTitle = document.title;
      console.log('[ContextBridge] SPA navigation detected →', window.location.pathname);
      recheckHandoffs(platform, shadowRoot);
    }
  });

  const titleEl = document.querySelector('head > title');
  if (titleEl) {
    observer.observe(titleEl, { childList: true, characterData: true, subtree: true });
  }
  // Also observe head in case <title> is added dynamically
  observer.observe(document.head, { childList: true });

  window.addEventListener('popstate', () => recheckHandoffs(platform, shadowRoot));
  window.addEventListener('hashchange', () => recheckHandoffs(platform, shadowRoot));
}

// ---------------------------------------------------------------------------
// Model Download Progress Panel (Step 06)
// ---------------------------------------------------------------------------

/**
 * Inject the download progress panel into the sidebar shadow root.
 * Returns a controller object for showing/updating/hiding the panel.
 * @param {ShadowRoot} shadowRoot
 */
function createModelDownloadPanel(shadowRoot) {
  // Inject sidebar.css so the panel picks up cb-download-* styles
  if (!shadowRoot.querySelector('link[data-cb-sidebar-css]')) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = chrome.runtime.getURL('ui/sidebar.css');
    link.dataset.cbSidebarCss = '1';
    shadowRoot.appendChild(link);
  }

  if (shadowRoot.getElementById('cb-model-download')) {
    // Panel already created — return existing controller
    return _makeDownloadPanelController(shadowRoot);
  }

  // Build download progress panel
  const panel = document.createElement('div');
  panel.id = 'cb-model-download';
  panel.className = 'cb-download-panel';
  panel.hidden = true;
  panel.innerHTML = `
    <div class="cb-download-header">
      <span class="cb-download-icon" aria-hidden="true">&#x2193;</span>
      <span class="cb-download-title">Downloading AI Model</span>
    </div>
    <p class="cb-download-subtitle">
      The summarization model is downloading once and will be cached locally.
    </p>
    <div class="cb-download-file-label" id="cb-download-file-name">Preparing download\u2026</div>
    <div class="cb-download-bar-track" role="progressbar"
         aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"
         aria-label="Model download progress">
      <div class="cb-download-bar-fill" id="cb-download-bar-fill"></div>
    </div>
    <div class="cb-download-meta">
      <span id="cb-download-percent">0%</span>
      <span id="cb-download-status">Starting\u2026</span>
    </div>
  `;

  // Build complete banner
  const completeBanner = document.createElement('div');
  completeBanner.id = 'cb-model-download-complete';
  completeBanner.className = 'cb-download-complete';
  completeBanner.hidden = true;
  completeBanner.innerHTML = `
    <span class="cb-download-complete-icon" aria-hidden="true">&#x2713;</span>
    <span>Model ready \u2014 summarization enabled</span>
  `;

  // Build error banner
  const errorBanner = document.createElement('div');
  errorBanner.id = 'cb-model-download-error';
  errorBanner.className = 'cb-download-error';
  errorBanner.hidden = true;
  errorBanner.innerHTML = `
    <span class="cb-download-error-icon" aria-hidden="true">&#x26A0;</span>
    <span id="cb-download-error-text">Download failed. Please try again.</span>
  `;

  shadowRoot.appendChild(panel);
  shadowRoot.appendChild(completeBanner);
  shadowRoot.appendChild(errorBanner);

  return _makeDownloadPanelController(shadowRoot);
}

function _makeDownloadPanelController(shadowRoot) {
  return {
    showProgress() {
      const panel = shadowRoot.getElementById('cb-model-download');
      const complete = shadowRoot.getElementById('cb-model-download-complete');
      const error = shadowRoot.getElementById('cb-model-download-error');
      if (complete) complete.hidden = true;
      if (error) error.hidden = true;
      if (panel) panel.hidden = false;
    },
    updateProgress(percent, fileName, fileIndex, fileCount) {
      const barFill = shadowRoot.getElementById('cb-download-bar-fill');
      const percentEl = shadowRoot.getElementById('cb-download-percent');
      const fileNameEl = shadowRoot.getElementById('cb-download-file-name');
      const statusEl = shadowRoot.getElementById('cb-download-status');
      const barTrack = shadowRoot.querySelector('.cb-download-bar-track');

      if (barFill) barFill.style.width = `${Math.max(0, Math.min(100, percent))}%`;
      if (percentEl) percentEl.textContent = percent >= 0 ? `${percent}%` : 'Downloading\u2026';
      if (fileNameEl) fileNameEl.textContent = fileName ?? 'Downloading\u2026';
      if (statusEl) statusEl.textContent = `File ${(fileIndex ?? 0) + 1} of ${fileCount ?? '?'}`;
      if (barTrack) barTrack.setAttribute('aria-valuenow', String(Math.max(0, percent)));
    },
    showComplete() {
      const panel = shadowRoot.getElementById('cb-model-download');
      const complete = shadowRoot.getElementById('cb-model-download-complete');
      if (panel) panel.hidden = true;
      if (complete) {
        complete.hidden = false;
        // Auto-dismiss after 4 seconds
        setTimeout(() => { if (complete) complete.hidden = true; }, 4000);
      }
    },
    showError(errorText) {
      const panel = shadowRoot.getElementById('cb-model-download');
      const error = shadowRoot.getElementById('cb-model-download-error');
      const errorTextEl = shadowRoot.getElementById('cb-download-error-text');
      if (panel) panel.hidden = true;
      if (errorTextEl && errorText) errorTextEl.textContent = errorText;
      if (error) error.hidden = false;
    },
  };
}

// Module-level reference so the message listener can update the panel
let _downloadPanelController = null;

// ---------------------------------------------------------------------------
// Message Listener
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener((message) => {
  const platform = detectPlatform();
  const shadowRoot = getSidebarShadowRoot();

  if (message.type === 'CB_OPEN_SIDEBAR' && platform && shadowRoot) {
    openSidebar(platform, shadowRoot);
  }

  if (message.type === 'CB_TAB_ACTIVATED' && platform && shadowRoot) {
    recheckHandoffs(platform, shadowRoot);
  }

  // Model download progress events (Step 06)
  if (shadowRoot) {
    if (message.type === 'CB_MODEL_DOWNLOAD_START') {
      _downloadPanelController = createModelDownloadPanel(shadowRoot);
      _downloadPanelController.showProgress();
    }

    if (message.type === 'CB_MODEL_DOWNLOAD_PROGRESS' && _downloadPanelController) {
      _downloadPanelController.updateProgress(
        message.percent,
        message.fileName,
        message.fileIndex,
        message.fileCount
      );
    }

    if (message.type === 'CB_MODEL_DOWNLOAD_COMPLETE' && _downloadPanelController) {
      _downloadPanelController.showComplete();
    }

    if (message.type === 'CB_MODEL_DOWNLOAD_ERROR' && _downloadPanelController) {
      _downloadPanelController.showError(message.error ?? 'Download failed. Please try again.');
    }
  }
});

// ---------------------------------------------------------------------------
// Boot Sequence
// ---------------------------------------------------------------------------

(async function boot() {
  try {
    const platform = detectPlatform();
    if (!platform) return; // Not a supported platform — exit silently

    console.log('[ContextBridge] content.js loaded on', window.location.hostname, '→', platform);

    const shadowRoot = createSidebarHost();

    // Verify background is alive (with retry for service worker wake-up)
    const ping = await sendToBackgroundWithRetry('PING');
    if (!ping) {
      console.warn('[ContextBridge] Background service worker did not respond — aborting boot');
      return;
    }

    // Check for pending handoffs and show auto-popup if any exist
    await recheckHandoffs(platform, shadowRoot);

    // Watch for SPA navigations (all 5 platforms are SPAs)
    watchSpaNavigation(platform, shadowRoot);

  } catch (e) {
    console.error('[ContextBridge] Boot error:', e.message);
  }
})();

// Exports available for console testing:
// detectPlatform, sendToBackgroundWithRetry, getSidebarShadowRoot, scrapeCurrentChat

// Expose scrapeCurrentChat on window for console testing (non-production helper)
if (typeof window !== 'undefined') {
  window.__contextBridge = window.__contextBridge ?? {};
  window.__contextBridge.scrapeCurrentChat = scrapeCurrentChat;
  window.__contextBridge.detectPlatform = detectPlatform;
}
