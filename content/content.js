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
// detectPlatform, sendToBackgroundWithRetry, getSidebarShadowRoot
