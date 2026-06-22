// ContextBridge — Background Service Worker
// Central message router, expiry manager, model manager, and storage coordinator.

import {
  getAllHandoffs,
  getPendingHandoffs,
  createHandoff,
  deleteHandoff,
  updateHandoff,
  purgeExpired,
  getStorageUsage,
} from './storage/handoff-store.js';

import {
  isModelCached,
  CACHE_NAME,
  MODEL_BASE_URL,
  MODEL_FILES,
} from './summarizer/summarizer.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SUPPORTED_ORIGINS = [
  'https://chatgpt.com',
  'https://claude.ai',
  'https://gemini.google.com',
  'https://www.perplexity.ai',
  'https://chat.deepseek.com',
];

const DEFAULT_SETTINGS = {
  tier: 'pro',
  modelStatus: 'not-downloaded',
  onboardingComplete: false,
  suppressedPlatforms: [],
  handoffExpiry: 7 * 24 * 60 * 60 * 1000, // 7 days in ms
  maxHandoffs: Infinity,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isSupportedUrl(url) {
  if (!url) return false;
  try {
    const origin = new URL(url).origin;
    return SUPPORTED_ORIGINS.includes(origin);
  } catch {
    return false;
  }
}

function ok(data) {
  return { success: true, data, error: null };
}

function err(message) {
  return { success: false, data: null, error: message };
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

async function getSettings() {
  const result = await chrome.storage.local.get('cb_settings');
  return result.cb_settings ?? { ...DEFAULT_SETTINGS };
}

async function saveSettings(settings) {
  await chrome.storage.local.set({ cb_settings: settings });
}

// ---------------------------------------------------------------------------
// Badge
// ---------------------------------------------------------------------------

async function updateBadge() {
  try {
    const handoffs = await getPendingHandoffs();
    const count = handoffs.length;
    await chrome.action.setBadgeText({ text: count > 0 ? String(count) : '' });
    await chrome.action.setBadgeBackgroundColor({ color: '#3B82F6' });
  } catch {
    // Badge update is non-critical — swallow errors
  }
}

// ---------------------------------------------------------------------------
// Expiry Manager
// ---------------------------------------------------------------------------

async function checkAndPurgeExpiredHandoffs() {
  try {
    const purged = await purgeExpired();
    if (purged > 0) {
      console.log(`[ContextBridge] Purged ${purged} expired handoff(s)`);
      await updateBadge();
    }
    return purged;
  } catch (e) {
    console.error('[ContextBridge] Expiry check failed:', e.message);
    return 0;
  }
}

// ---------------------------------------------------------------------------
// Model Manager
// ---------------------------------------------------------------------------

/**
 * Broadcast a message to all active content script tabs on supported platforms.
 * Non-fatal — tabs without a content script receiver are silently skipped.
 * @param {object} message
 */
async function broadcastToMatchingTabs(message) {
  try {
    const tabs = await chrome.tabs.query({
      url: SUPPORTED_ORIGINS.map(o => `${o}/*`),
    });
    await Promise.allSettled(
      tabs.map(tab => chrome.tabs.sendMessage(tab.id, message).catch(() => {}))
    );
  } catch {
    // Non-critical broadcast — swallow errors
  }
}

/**
 * Fetch a URL with streaming byte-level progress callbacks.
 * @param {string} url
 * @param {function(number, number, number): void} onProgress  (percent, received, total)
 * @returns {Promise<Response>}  A new Response wrapping the fully-downloaded blob
 */
async function fetchWithProgress(url, onProgress) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} downloading ${url}`);
  }

  const contentLength = +response.headers.get('Content-Length') || 0;
  const reader = response.body.getReader();
  let received = 0;
  const chunks = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    const percent = contentLength > 0
      ? Math.round((received / contentLength) * 100)
      : -1;
    onProgress(percent, received, contentLength);
  }

  const blob = new Blob(chunks);
  return new Response(blob, { headers: response.headers });
}

/**
 * Returns the current model status by cross-checking the Cache API.
 * Heals the persisted modelStatus in settings if the cache was externally cleared.
 * @returns {Promise<'ready'|'not-downloaded'|'downloading'|'error'>}
 */
async function getModelStatus() {
  const cached = await isModelCached();
  if (cached) return 'ready';

  // Cache was cleared — heal the persisted status so the UI reflects reality
  const settings = await getSettings();
  if (settings.modelStatus === 'ready') {
    await saveSettings({ ...settings, modelStatus: 'not-downloaded' });
  }
  return settings.modelStatus === 'downloading' ? 'downloading' : 'not-downloaded';
}

/**
 * Download and cache all model files, broadcasting byte-level progress to
 * all matching content script tabs.
 * If all files are already cached, returns immediately with { status: 'ready' }.
 * @param {string} _tier   Reserved for future tier-based model selection
 * @returns {Promise<{ status: 'ready' | 'started' }>}
 */
async function downloadModel(_tier) {
  // Skip download if all files are already cached
  if (await isModelCached()) {
    console.log('[ContextBridge] downloadModel: already cached — skipping download');
    const settings = await getSettings();
    await saveSettings({ ...settings, modelStatus: 'ready' });
    return { status: 'ready' };
  }

  // Update persisted status before starting
  const settings = await getSettings();
  await saveSettings({ ...settings, modelStatus: 'downloading' });
  await broadcastToMatchingTabs({ type: 'CB_MODEL_DOWNLOAD_START' });

  const cache = await caches.open(CACHE_NAME);

  // Per-file byte tracking for combined progress across all files
  const fileReceived = new Array(MODEL_FILES.length).fill(0);
  const fileSizes    = new Array(MODEL_FILES.length).fill(0);

  try {
    for (let i = 0; i < MODEL_FILES.length; i++) {
      const fileName = MODEL_FILES[i];
      const url = MODEL_BASE_URL + fileName;
      console.log(`[ContextBridge] downloadModel: fetching ${fileName} (${i + 1}/${MODEL_FILES.length})`);

      const response = await fetchWithProgress(url, (filePercent, received, total) => {
        fileReceived[i] = received;
        if (total > 0) fileSizes[i] = total;

        // Combine byte counts across all files for a single overall percent
        const totalReceived = fileReceived.reduce((a, b) => a + b, 0);
        const totalSize = fileSizes.reduce((a, b) => a + b, 0);
        const overallPercent = totalSize > 0
          ? Math.round((totalReceived / totalSize) * 100)
          : filePercent;

        broadcastToMatchingTabs({
          type: 'CB_MODEL_DOWNLOAD_PROGRESS',
          percent: overallPercent,
          fileName,
          fileIndex: i,
          fileCount: MODEL_FILES.length,
        }).catch(() => {});
      });

      // Cache the file using its bare name as the key (matches what isModelCached expects)
      await cache.put(fileName, response);
      console.log(`[ContextBridge] downloadModel: cached ${fileName}`);
    }

    // All files downloaded successfully
    await saveSettings({ ...settings, modelStatus: 'ready' });
    await broadcastToMatchingTabs({ type: 'CB_MODEL_DOWNLOAD_COMPLETE' });
    console.log('[ContextBridge] downloadModel: all model files cached');
    return { status: 'ready' };

  } catch (e) {
    console.error('[ContextBridge] downloadModel failed:', e.message);
    await saveSettings({ ...settings, modelStatus: 'error' });
    await broadcastToMatchingTabs({ type: 'CB_MODEL_DOWNLOAD_ERROR', error: e.message });
    throw e;
  }
}

// ---------------------------------------------------------------------------
// Message Router
// ---------------------------------------------------------------------------

async function handleMessage(message, _sender) {
  if (message.type !== 'CB_ACTION') return null;

  const { action, payload } = message;

  switch (action) {
    case 'PING':
      return ok({ alive: true });

    case 'GET_HANDOFFS': {
      const handoffs = await getAllHandoffs();
      return ok({ handoffs });
    }

    case 'SAVE_HANDOFF': {
      const settings = await getSettings();
      const maxHandoffs = settings.tier === 'free' ? 5 : (settings.maxHandoffs ?? Infinity);
      if (maxHandoffs !== Infinity) {
        const handoffs = await getAllHandoffs();
        if (handoffs.length >= maxHandoffs) {
          const toDelete = handoffs.length - maxHandoffs + 1;
          for (let i = 0; i < toDelete; i++) {
            await deleteHandoff(handoffs[i].id);
            console.log(`[ContextBridge] Quota limit reached (${maxHandoffs}). Purged oldest handoff: ${handoffs[i].id}`);
          }
        }
      }
      const handoff = await createHandoff(payload.handoff);
      await updateBadge();
      return ok({ id: handoff?.id ?? null });
    }

    case 'DELETE_HANDOFF': {
      await deleteHandoff(payload.id);
      await updateBadge();
      return ok({ deleted: true });
    }

    case 'MARK_INJECTED': {
      await updateHandoff(payload.id, { status: 'injected' });
      await updateBadge();
      return ok({ updated: true });
    }

    case 'GET_STORAGE_USAGE': {
      const usedBytes = await getStorageUsage();
      return ok({ usedBytes });
    }

    case 'GET_MODEL_STATUS': {
      const status = await getModelStatus();
      return ok({ status });
    }

    case 'DOWNLOAD_MODEL': {
      const result = await downloadModel(payload?.tier ?? 'pro');
      return ok(result);
    }

    case 'PURGE_EXPIRED': {
      const purged = await checkAndPurgeExpiredHandoffs();
      return ok({ purged });
    }

    case 'GET_SETTINGS': {
      const settings = await getSettings();
      return ok({ settings });
    }

    case 'SAVE_SETTINGS': {
      await saveSettings(payload.settings);
      return ok({ saved: true });
    }

    default:
      return err(`Unknown action: ${action}`);
  }
}

// ---------------------------------------------------------------------------
// Event Listeners
// ---------------------------------------------------------------------------

// Message router — return true to signal async response
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender)
    .then(response => {
      if (response !== null) sendResponse(response);
    })
    .catch(e => {
      sendResponse(err(e.message));
    });
  return true; // keep the message channel open for async response
});

// First install + extension update
chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  if (reason === 'install') {
    await chrome.storage.local.set({
      cb_onboarding_complete: false,
      cb_settings: { ...DEFAULT_SETTINGS },
    });
    console.log('[ContextBridge] First install — onboarding pending');
    // Step 13 will open the onboarding tab here
  }
  await checkAndPurgeExpiredHandoffs();
  await updateBadge();
});

// Browser startup (service worker restart)
chrome.runtime.onStartup.addListener(async () => {
  console.log('[ContextBridge] onStartup — running expiry check');
  await checkAndPurgeExpiredHandoffs();
  await updateBadge();
});

// Tab navigation — notify content script when a supported platform loads
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete') return;
  if (!isSupportedUrl(tab.url)) return;

  chrome.tabs.sendMessage(tabId, { type: 'CB_TAB_ACTIVATED' }).catch(() => {
    // Content script may not be ready yet — safe to ignore
  });
});

console.log('[ContextBridge] background.js loaded');
