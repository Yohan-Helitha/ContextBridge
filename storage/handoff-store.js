// ContextBridge — Handoff Storage Layer
// CRUD operations, expiry logic, and quota management for handoff objects.
// All data is stored in chrome.storage.local under 'cb_' namespaced keys.
//
// Storage layout:
//   'cb_handoff_{uuid}'    → Handoff object
//   'cb_handoff_index'     → string[] of ids, oldest-first ordering

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const KEY_INDEX = 'cb_handoff_index';
const KEY_PREFIX = 'cb_handoff_';

/** 7-day expiry for Pro tier */
const EXPIRY_MS = 7 * 24 * 60 * 60 * 1000;

/** Soft storage limit: warn at 8 MB */
const STORAGE_WARN_BYTES = 8 * 1024 * 1024;

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

function handoffKey(id) {
  return `${KEY_PREFIX}${id}`;
}

function generateId() {
  return crypto.randomUUID();
}

function calcExpiresAt(createdAt) {
  return new Date(new Date(createdAt).getTime() + EXPIRY_MS).toISOString();
}

/**
 * Read the id index from storage. Returns [] if missing.
 * @returns {Promise<string[]>}
 */
async function readIndex() {
  const result = await chrome.storage.local.get(KEY_INDEX);
  return result[KEY_INDEX] ?? [];
}

/**
 * Write the id index back to storage.
 * @param {string[]} index
 */
async function writeIndex(index) {
  await chrome.storage.local.set({ [KEY_INDEX]: index });
}

/**
 * Validate that required fields are present before creating a handoff.
 * @param {Object} data
 */
function validateHandoffData(data) {
  if (!data || typeof data !== 'object') {
    throw new Error('Handoff data must be an object');
  }
  if (!data.sourcePlatform) {
    throw new Error('Missing required field: sourcePlatform');
  }
  if (!data.rawSummary) {
    throw new Error('Missing required field: rawSummary');
  }
  if (!data.structuredSummary || typeof data.structuredSummary !== 'object') {
    throw new Error('Missing required field: structuredSummary');
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Create a new handoff — generates id, createdAt, expiresAt, sets status = 'pending'.
 * @param {Object} data - Partial handoff (sourcePlatform, rawSummary, structuredSummary required)
 * @returns {Promise<import('./handoff-store.js').Handoff>}
 */
export async function createHandoff(data) {
  validateHandoffData(data);

  const id = generateId();
  const createdAt = new Date().toISOString();
  const expiresAt = calcExpiresAt(createdAt);

  /** @type {import('./handoff-store.js').Handoff} */
  const handoff = {
    ...data,
    id,
    createdAt,
    expiresAt,
    status: 'pending',
  };

  // Write handoff object under its own key
  await chrome.storage.local.set({ [handoffKey(id)]: handoff });

  // Append id to index (read-modify-write)
  const index = await readIndex();
  index.push(id);
  await writeIndex(index);

  console.log(`[ContextBridge] handoff-store: created handoff ${id}`);
  return handoff;
}

/**
 * Get a single handoff by id. Returns null if not found.
 * @param {string} id
 * @returns {Promise<import('./handoff-store.js').Handoff | null>}
 */
export async function getHandoff(id) {
  const result = await chrome.storage.local.get(handoffKey(id));
  return result[handoffKey(id)] ?? null;
}

/**
 * Get all handoffs across all statuses.
 * Cross-checks index against actual keys and self-heals on data corruption.
 * @returns {Promise<import('./handoff-store.js').Handoff[]>}
 */
export async function getAllHandoffs() {
  const index = await readIndex();
  if (index.length === 0) return [];

  const keys = index.map(handoffKey);
  const result = await chrome.storage.local.get(keys);

  const handoffs = [];
  const validIds = [];

  for (const id of index) {
    const handoff = result[handoffKey(id)];
    if (handoff) {
      handoffs.push(handoff);
      validIds.push(id);
    } else {
      // Data corruption — key missing but id is in the index
      console.warn(`[ContextBridge] handoff-store: index references missing key for id=${id} — removing from index`);
    }
  }

  // Self-heal the index if we found orphaned ids
  if (validIds.length !== index.length) {
    await writeIndex(validIds);
  }

  return handoffs;
}

/**
 * Get only handoffs with status === 'pending'.
 * @returns {Promise<import('./handoff-store.js').Handoff[]>}
 */
export async function getPendingHandoffs() {
  const all = await getAllHandoffs();
  return all.filter(h => h.status === 'pending');
}

/**
 * Update specific fields on a handoff.
 * @param {string} id
 * @param {Partial<import('./handoff-store.js').Handoff>} patch
 * @returns {Promise<import('./handoff-store.js').Handoff>}
 */
export async function updateHandoff(id, patch) {
  const existing = await getHandoff(id);
  if (!existing) {
    throw new Error(`Handoff not found: ${id}`);
  }

  const updated = { ...existing, ...patch, id }; // id is immutable
  await chrome.storage.local.set({ [handoffKey(id)]: updated });
  return updated;
}

/**
 * Delete a handoff by id. Removes both the key and the index entry.
 * No-op if handoff does not exist.
 * @param {string} id
 * @returns {Promise<void>}
 */
export async function deleteHandoff(id) {
  await chrome.storage.local.remove(handoffKey(id));

  const index = await readIndex();
  const newIndex = index.filter(existingId => existingId !== id);
  if (newIndex.length !== index.length) {
    await writeIndex(newIndex);
  }

  console.log(`[ContextBridge] handoff-store: deleted handoff ${id}`);
}

/**
 * Purge all expired handoffs (expiresAt in the past OR status === 'expired').
 * @returns {Promise<number>} Count of handoffs deleted
 */
export async function purgeExpired() {
  const index = await readIndex();
  if (index.length === 0) return 0;

  const keys = index.map(handoffKey);
  const result = await chrome.storage.local.get(keys);

  const now = Date.now();
  const toDelete = [];
  const survivingIds = [];

  for (const id of index) {
    const handoff = result[handoffKey(id)];
    if (!handoff) {
      // Missing key — skip (index will be cleaned up by getAllHandoffs later)
      continue;
    }

    const isExpiredByTime = new Date(handoff.expiresAt).getTime() < now;
    const isExpiredByStatus = handoff.status === 'expired';

    if (isExpiredByTime || isExpiredByStatus) {
      toDelete.push(handoffKey(id));
    } else {
      survivingIds.push(id);
    }
  }

  if (toDelete.length > 0) {
    await chrome.storage.local.remove(toDelete);
    await writeIndex(survivingIds);
    console.log(`[ContextBridge] handoff-store: purged ${toDelete.length} expired handoff(s)`);
  }

  return toDelete.length;
}

/**
 * Get total storage usage for all chrome.storage.local keys in bytes.
 * @returns {Promise<number>}
 */
export async function getStorageUsage() {
  return new Promise((resolve) => {
    chrome.storage.local.getBytesInUse(null, resolve);
  });
}

/**
 * Get storage usage as a percentage of the soft limit (8 MB).
 * @returns {Promise<number>} 0–100+
 */
export async function getStoragePercent() {
  const bytes = await getStorageUsage();
  return Math.round((bytes / STORAGE_WARN_BYTES) * 100);
}
