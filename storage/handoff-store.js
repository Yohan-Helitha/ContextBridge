// ContextBridge — Handoff Storage Layer
// CRUD operations, expiry logic, and quota management for handoff objects.
// All data is stored in chrome.storage.local under 'cb_' namespaced keys.

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Key prefix for individual handoff records. */
const KEY_PREFIX = 'cb_handoff_';

/** Key for the ordered index array (oldest-first). */
const INDEX_KEY = 'cb_handoff_index';

/** Handoff TTL — 7 days in milliseconds (Pro tier). */
const EXPIRY_MS = 7 * 24 * 60 * 60 * 1000;

/** Soft storage limit for the warning banner — 8 MB. */
const STORAGE_WARN_BYTES = 8 * 1024 * 1024;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * @param {string} id
 * @returns {string}
 */
function handoffKey(id) {
  return `${KEY_PREFIX}${id}`;
}

/**
 * Generate a UUID v4 using the Web Crypto API.
 * Available in service workers and content scripts.
 * @returns {string}
 */
function generateId() {
  return crypto.randomUUID();
}

/**
 * Calculate an ISO 8601 expiry timestamp from a given creation timestamp.
 * @param {string} createdAt - ISO 8601 string
 * @returns {string} - ISO 8601 string
 */
function calcExpiresAt(createdAt) {
  return new Date(new Date(createdAt).getTime() + EXPIRY_MS).toISOString();
}

/**
 * Promisified chrome.storage.local.get for one or more keys.
 * @param {string | string[] | null} keys
 * @returns {Promise<Object>}
 */
function storageGet(keys) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(keys, (result) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(result);
      }
    });
  });
}

/**
 * Promisified chrome.storage.local.set.
 * @param {Object} items
 * @returns {Promise<void>}
 */
function storageSet(items) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set(items, () => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve();
      }
    });
  });
}

/**
 * Promisified chrome.storage.local.remove for one or more keys.
 * @param {string | string[]} keys
 * @returns {Promise<void>}
 */
function storageRemove(keys) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.remove(keys, () => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve();
      }
    });
  });
}

/**
 * Read the current index array from storage.
 * Always returns a plain array (empty if not yet written).
 * @returns {Promise<string[]>}
 */
async function readIndex() {
  const result = await storageGet(INDEX_KEY);
  return Array.isArray(result[INDEX_KEY]) ? result[INDEX_KEY] : [];
}

/**
 * Persist the index array to storage.
 * @param {string[]} index
 * @returns {Promise<void>}
 */
async function writeIndex(index) {
  await storageSet({ [INDEX_KEY]: index });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} Handoff
 * @property {string}   id
 * @property {string}   sourcePlatform   - 'chatgpt' | 'claude' | 'gemini' | 'perplexity' | 'deepseek'
 * @property {string}   chatTitle
 * @property {string}   rawSummary
 * @property {Object}   structuredSummary
 * @property {string}   structuredSummary.topic
 * @property {string}   structuredSummary.covered
 * @property {string}   structuredSummary.lastPoint
 * @property {string[]} structuredSummary.openThreads
 * @property {string}   structuredSummary.continueFrom
 * @property {string}   injectedPrompt
 * @property {string}   createdAt        - ISO 8601
 * @property {string}   expiresAt        - ISO 8601
 * @property {'pending'|'injected'|'expired'|'dismissed'} status
 */

/**
 * Create a new handoff record.
 * Validates required fields, generates id + timestamps, persists to storage.
 *
 * @param {Partial<Handoff>} data
 * @returns {Promise<Handoff>}
 */
export async function createHandoff(data) {
  if (!data || !data.sourcePlatform || !data.rawSummary || !data.structuredSummary) {
    throw new Error(
      '[ContextBridge] createHandoff: missing required fields (sourcePlatform, rawSummary, structuredSummary)'
    );
  }

  const id = generateId();
  const createdAt = new Date().toISOString();
  const expiresAt = calcExpiresAt(createdAt);

  /** @type {Handoff} */
  const handoff = {
    id,
    sourcePlatform: data.sourcePlatform,
    chatTitle: data.chatTitle ?? '',
    rawSummary: data.rawSummary,
    structuredSummary: {
      topic: data.structuredSummary.topic ?? '',
      covered: data.structuredSummary.covered ?? '',
      lastPoint: data.structuredSummary.lastPoint ?? '',
      openThreads: Array.isArray(data.structuredSummary.openThreads)
        ? data.structuredSummary.openThreads
        : [],
      continueFrom: data.structuredSummary.continueFrom ?? '',
    },
    injectedPrompt: data.injectedPrompt ?? '',
    createdAt,
    expiresAt,
    status: 'pending',
  };

  // Write handoff and update index atomically (two separate keys — see spec §Storage Layout).
  const index = await readIndex();
  index.push(id);

  await storageSet({
    [handoffKey(id)]: handoff,
    [INDEX_KEY]: index,
  });

  console.debug(`[ContextBridge] createHandoff: stored ${id}`);
  return handoff;
}

/**
 * Retrieve a single handoff by id.
 *
 * @param {string} id
 * @returns {Promise<Handoff|null>}
 */
export async function getHandoff(id) {
  const result = await storageGet(handoffKey(id));
  return result[handoffKey(id)] ?? null;
}

/**
 * Retrieve all handoffs in index order (oldest first).
 * Cross-checks the index against actual keys; removes stale index entries silently.
 *
 * @returns {Promise<Handoff[]>}
 */
export async function getAllHandoffs() {
  const index = await readIndex();
  if (index.length === 0) return [];

  const keys = index.map(handoffKey);
  const result = await storageGet(keys);

  const handoffs = [];
  const validIds = [];

  for (const id of index) {
    const handoff = result[handoffKey(id)];
    if (handoff) {
      handoffs.push(handoff);
      validIds.push(id);
    } else {
      // Data corruption — key missing; remove from index silently.
      console.warn(`[ContextBridge] getAllHandoffs: index entry ${id} has no corresponding key — removing from index`);
    }
  }

  // Repair index if we found orphans.
  if (validIds.length !== index.length) {
    await writeIndex(validIds);
  }

  return handoffs;
}

/**
 * Retrieve only handoffs whose status is 'pending'.
 *
 * @returns {Promise<Handoff[]>}
 */
export async function getPendingHandoffs() {
  const all = await getAllHandoffs();
  return all.filter((h) => h.status === 'pending');
}

/**
 * Apply a partial patch to an existing handoff.
 * Merges structuredSummary if provided.
 *
 * @param {string}          id
 * @param {Partial<Handoff>} patch
 * @returns {Promise<Handoff>}
 */
export async function updateHandoff(id, patch) {
  const existing = await getHandoff(id);
  if (!existing) {
    throw new Error(`[ContextBridge] updateHandoff: no handoff found for id ${id}`);
  }

  const updated = {
    ...existing,
    ...patch,
    id, // id is immutable
    createdAt: existing.createdAt, // createdAt is immutable
    structuredSummary: patch.structuredSummary
      ? { ...existing.structuredSummary, ...patch.structuredSummary }
      : existing.structuredSummary,
  };

  await storageSet({ [handoffKey(id)]: updated });
  console.debug(`[ContextBridge] updateHandoff: updated ${id}`);
  return updated;
}

/**
 * Delete a handoff by id — removes both the key and the index entry.
 *
 * @param {string} id
 * @returns {Promise<void>}
 */
export async function deleteHandoff(id) {
  const index = await readIndex();
  const newIndex = index.filter((i) => i !== id);

  await Promise.all([
    storageRemove(handoffKey(id)),
    writeIndex(newIndex),
  ]);

  console.debug(`[ContextBridge] deleteHandoff: removed ${id}`);
}

/**
 * Purge all expired handoffs.
 * A handoff is expired when its expiresAt is in the past OR its status is 'expired'.
 *
 * @returns {Promise<number>} - Count of deleted handoffs
 */
export async function purgeExpired() {
  const index = await readIndex();
  if (index.length === 0) return 0;

  const keys = index.map(handoffKey);
  const result = await storageGet(keys);

  const now = Date.now();
  const expiredIds = [];
  const survivingIds = [];

  for (const id of index) {
    const handoff = result[handoffKey(id)];
    if (!handoff) {
      // Orphaned index entry — treat as expired.
      expiredIds.push(id);
      continue;
    }
    const isTimeExpired = new Date(handoff.expiresAt).getTime() < now;
    const isStatusExpired = handoff.status === 'expired';
    if (isTimeExpired || isStatusExpired) {
      expiredIds.push(id);
    } else {
      survivingIds.push(id);
    }
  }

  if (expiredIds.length === 0) return 0;

  // Delete expired keys + update index in a single batch set.
  const removals = expiredIds.map(handoffKey);
  await Promise.all([
    storageRemove(removals),
    writeIndex(survivingIds),
  ]);

  console.log(`[ContextBridge] purgeExpired: removed ${expiredIds.length} handoff(s)`);
  return expiredIds.length;
}

/**
 * Get total chrome.storage.local usage in bytes.
 *
 * @returns {Promise<number>}
 */
export async function getStorageUsage() {
  return new Promise((resolve, reject) => {
    chrome.storage.local.getBytesInUse(null, (bytes) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(bytes);
      }
    });
  });
}

/**
 * Get storage usage as a percentage of the 8 MB soft limit.
 *
 * @returns {Promise<number>} - 0–100+ (can exceed 100 if over limit)
 */
export async function getStoragePercent() {
  const used = await getStorageUsage();
  return (used / STORAGE_WARN_BYTES) * 100;
}
