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
// Model Manager (stub — full implementation in Step 06)
// ---------------------------------------------------------------------------

function getModelStatus() {
  // Step 06 will check the Cache API for actual model files.
  // For now, delegate to settings.
  return chrome.storage.local.get('cb_settings').then(result => {
    return result.cb_settings?.modelStatus ?? 'not-downloaded';
  });
}

async function downloadModel(tier) {
  // Full implementation: Step 06
  console.log(`[ContextBridge] downloadModel stub — tier: ${tier}`);
  return { started: true };
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
