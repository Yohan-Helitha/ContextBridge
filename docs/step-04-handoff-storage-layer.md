# Step 04 — Handoff Storage Layer

**Phase:** Core Mechanics  
**Status:** Complete  
**Depends On:** Step 02 (background worker message protocol)  

---

## Objective

Implement the complete `storage/handoff-store.js` module. This is the single source of truth for all handoff CRUD operations, expiry logic, and storage quota management. At the end of this step, handoffs can be created, read, updated, deleted, and expired correctly — all logic is tested in isolation via the background console.

---

## Files Modified

| File | Action |
|---|---|
| `storage/handoff-store.js` | Full implementation |
| `background.js` | Import and wire handoff-store into message handlers |

---

## Handoff Data Model (Full)

```js
/**
 * @typedef {Object} Handoff
 * @property {string}   id               - UUID v4
 * @property {string}   sourcePlatform   - 'chatgpt' | 'claude' | 'gemini' | 'perplexity' | 'deepseek'
 * @property {string}   chatTitle        - Title scraped from the platform
 * @property {string}   rawSummary       - Raw text output from ONNX model
 * @property {Object}   structuredSummary
 * @property {string}   structuredSummary.topic
 * @property {string}   structuredSummary.covered
 * @property {string}   structuredSummary.lastPoint
 * @property {string[]} structuredSummary.openThreads
 * @property {string}   structuredSummary.continueFrom
 * @property {string}   injectedPrompt   - Final natural-language prompt for injection
 * @property {string}   createdAt        - ISO 8601 UTC string
 * @property {string}   expiresAt        - ISO 8601 UTC string
 * @property {'pending'|'injected'|'expired'|'dismissed'} status
 */
```

---

## Public API

```js
// Create a new handoff — generates id, createdAt, expiresAt
export async function createHandoff(data)       → Handoff

// Get a single handoff by id
export async function getHandoff(id)            → Handoff | null

// Get all handoffs (all statuses)
export async function getAllHandoffs()          → Handoff[]

// Get only pending handoffs (status === 'pending')
export async function getPendingHandoffs()      → Handoff[]

// Update specific fields on a handoff
export async function updateHandoff(id, patch)  → Handoff

// Delete a handoff by id
export async function deleteHandoff(id)         → void

// Purge all expired handoffs — returns count deleted
export async function purgeExpired()            → number

// Get total storage usage in bytes
export async function getStorageUsage()         → number

// Get storage usage as a percentage of soft limit (8MB)
export async function getStoragePercent()       → number
```

---

## Storage Layout

Each handoff is stored as a flat key:

```
chrome.storage.local key:   'cb_handoff_{uuid}'
chrome.storage.local value: Handoff object (JSON-serializable)
```

An index tracks ordering (needed for "oldest first" purge):

```
chrome.storage.local key:   'cb_handoff_index'
chrome.storage.local value: string[]  (array of ids, oldest first)
```

### Why flat keys instead of one big array?

`chrome.storage.local` reads/writes are atomic per key. Storing handoffs as individual keys means:
- Deleting one handoff does not require reading and rewriting the entire collection.
- The index is the only shared key that needs careful concurrent update.
- This matches the pattern recommended in the Chrome Extensions documentation.

---

## UUID Generation

```js
function generateId() {
  return crypto.randomUUID(); // Web Crypto API — available in service workers and content scripts
}
```

---

## Expiry Calculation

```js
// Pro tier: 7 days
const EXPIRY_MS = 7 * 24 * 60 * 60 * 1000;

function calcExpiresAt(createdAt) {
  return new Date(new Date(createdAt).getTime() + EXPIRY_MS).toISOString();
}
```

---

## createHandoff() Logic

```
1. Validate required fields are present: sourcePlatform, rawSummary, structuredSummary
2. Generate id = crypto.randomUUID()
3. Set createdAt = new Date().toISOString()
4. Set expiresAt = calcExpiresAt(createdAt)
5. Set status = 'pending'
6. Write handoff to 'cb_handoff_{id}'
7. Append id to 'cb_handoff_index' (read-modify-write)
8. Return the full handoff object
```

---

## Free Tier Quota Management

Although individual CRUD operations are isolated in `storage/handoff-store.js`, the quota limit enforcement for the free tier (maximum of 5 active handoffs) is handled by the background service worker during the `SAVE_HANDOFF` message flow.

### Logic in background.js:
1. Load current settings: `getSettings()`
2. Determine if the user is on the `'free'` tier (max limit: 5 handoffs)
3. If the tier is free and `getAllHandoffs()` returns 5 or more handoffs:
   a. Identify the oldest handoff (first element in the index-ordered array).
   b. Call `deleteHandoff(oldestHandoff.id)` to remove it from storage and the index.
4. Proceed to call `createHandoff()` for the new handoff.

---

## purgeExpired() Logic

```
1. Load 'cb_handoff_index' → list of ids
2. Batch-read all handoffs: chrome.storage.local.get([...keys])
3. Identify expired: expiresAt < Date.now() OR status === 'expired'
4. For each expired handoff:
   a. Delete key 'cb_handoff_{id}'
   b. Remove from index
5. Write updated index back
6. Return count
```

---

## Storage Usage Calculation

```js
async function getStorageUsage() {
  return new Promise((resolve) => {
    chrome.storage.local.getBytesInUse(null, resolve);
  });
}

// Soft limit for warning banner: 8MB
const STORAGE_WARN_BYTES = 8 * 1024 * 1024;
```

---

## Index Integrity

The index (`cb_handoff_index`) must always reflect exactly the ids that have live keys. Rules:

- `createHandoff` → append to index
- `deleteHandoff` → remove from index  
- `purgeExpired` → remove all purged ids from index
- On `getAllHandoffs`, cross-check index against actual keys — if a key is missing (data corruption), remove it from the index silently and log a warning.

---

## Validation Checklist

- [x] `createHandoff()` stores correct object with UUID, timestamps, status = 'pending'
- [x] `getPendingHandoffs()` only returns status = 'pending' items
- [x] `purgeExpired()` removes handoffs whose `expiresAt` is in the past
- [x] `deleteHandoff()` removes both the key and the index entry
- [x] `getStorageUsage()` returns a number (bytes)
- [x] Index remains consistent after multiple creates and deletes
- [x] Creating a 6th handoff on free tier — oldest is purged (this logic lives in background.js which calls `getAllHandoffs` + `deleteHandoff` — document the interaction here even though enforcement is in background.js)
- [x] All functions are importable as ES module exports from background.js
