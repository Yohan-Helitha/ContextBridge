# Step 05 — Chat Scrapers (All 5 Platforms)

**Phase:** Core Mechanics  
**Status:** Not Started  
**Depends On:** Step 03 (platform detection), Step 04 (handoff model)  

---

## Objective

Implement `platforms/scrapers.js` with a scraper for each of the 5 target platforms. Each scraper extracts the full conversation as a normalized array of `{ role, text }` message objects. At the end of this step, scraping works reliably on all 5 platforms and the output is ready to feed into the summarizer.

---

## Files Modified

| File | Action |
|---|---|
| `platforms/scrapers.js` | Full implementation — all 5 platform scrapers |
| `content/content.js` | Import scraper and expose `scrapeCurrentChat()` |

---

## Normalized Message Format

Every scraper must produce output in this exact format regardless of platform:

```js
/**
 * @typedef {Object} Message
 * @property {'user' | 'assistant'} role
 * @property {string} text         - Plain text, HTML tags stripped
 * @property {number} index        - 0-based position in conversation
 */
```

---

## Public API

```js
// Returns scraper for the current platform, or null if unsupported
export function getScraperForPlatform(platform)  → Scraper | null

// Each Scraper object:
{
  scrapeMessages()      → Message[]          // scrape current visible chat
  getChatTitle()        → string             // page/chat title
  getHistoryList()      → HistoryItem[]      // for "pick a past chat" flow
  navigateToHistory(url) → Promise<void>     // navigate + wait for load
}
```

---

## Platform 1: ChatGPT

**URL:** `https://chatgpt.com/*`

### Message Scraping

```js
// Primary selector
const turns = document.querySelectorAll('[data-message-author-role]');

// For each turn:
const role = el.getAttribute('data-message-author-role'); // 'user' or 'assistant'
const text = el.querySelector('.markdown, .whitespace-pre-wrap')?.innerText?.trim() ?? '';
```

### Chat Title

```js
document.title.replace(' - ChatGPT', '').trim()
// OR: document.querySelector('nav [data-testid="conversation-title"]')?.innerText
```

### History List

```js
// Left sidebar conversation list
const items = document.querySelectorAll('nav li[data-testid]');
// Each item: { title: el.innerText, url: el.querySelector('a')?.href }
```

### Known Fragility Points

- ChatGPT frequently updates its class names and data attributes.
- The `.markdown` class may change — always use `data-message-author-role` as the anchor, not class names.
- Long messages may be truncated with a "Show more" button — check for this and click it before scraping if detected.

---

## Platform 2: Claude

**URL:** `https://claude.ai/*`

### Message Scraping

```js
// Claude uses alternating structure — detect by container class
const userMessages = document.querySelectorAll('[data-testid="user-message"]');
const assistantMessages = document.querySelectorAll('.font-claude-message');

// Preferred: query by the conversation turn container
const turns = document.querySelectorAll('[data-testid="conversation-turn-user"], [data-testid="conversation-turn-assistant"]');
```

### Speaker Detection

```js
// Check the data-testid attribute of the turn wrapper
const role = el.dataset.testid.includes('user') ? 'user' : 'assistant';
const text = el.querySelector('p, .prose')?.innerText?.trim() ?? '';
```

### Chat Title

```js
document.querySelector('[data-testid="chat-menu-trigger"]')?.innerText?.trim()
// OR document.title
```

### Known Fragility Points

- Claude's DOM updates aggressively with new model releases.
- The `.font-claude-message` class is a functional class, more stable than layout classes.
- Stream rendering: content may still be generating — check for a "stop" button and warn the user if a message is still streaming.

---

## Platform 3: Gemini

**URL:** `https://gemini.google.com/*`

### Message Scraping

```js
// Gemini uses custom web components
const turns = document.querySelectorAll('conversation-turn');

// Within each turn:
const isUser = turn.querySelector('.user-query-text') !== null;
const role = isUser ? 'user' : 'assistant';
const text = isUser
  ? turn.querySelector('.user-query-text')?.innerText?.trim()
  : turn.querySelector('.model-response-text, .markdown')?.innerText?.trim();
```

### Chat Title

```js
document.querySelector('.conversation-title')?.innerText?.trim()
// OR document.title
```

### Known Fragility Points

- Gemini uses Angular-based web components — selectors target the component tag names which are more stable than class names.
- Multi-modal content (images) is ignored — only text nodes are extracted.
- Gemini may load lazily — ensure turns are in the DOM before scraping (add a short `waitForElement` poll).

---

## Platform 4: Perplexity

**URL:** `https://www.perplexity.ai/*`

### Message Scraping

```js
// Perplexity has user queries and AI answers in separate DOM structures
const userQueries = document.querySelectorAll('[data-testid="query-text"], .font-display');
const answers = document.querySelectorAll('.prose.dark\\:prose-invert');

// Interleave them by DOM position order
const allElements = [...document.querySelectorAll(
  '[data-testid="query-text"], .prose.dark\\:prose-invert'
)].sort((a, b) => a.compareDocumentPosition(b) & 4 ? -1 : 1);
```

### Speaker Detection

```js
// After sorting by DOM order, alternate: first element is user, second assistant, etc.
// OR check parent container class
const isUser = el.closest('[data-testid="user-query"]') !== null;
```

### Chat Title

```js
document.title.replace(' | Perplexity', '').trim()
```

### Known Fragility Points

- Perplexity's UI varies significantly between search mode and assistant mode.
- Some answers include source citations in `.prose` — these should be stripped or noted.
- Position-based detection is less reliable than role attributes; validate with 5+ real conversations.

---

## Platform 5: DeepSeek

**URL:** `https://chat.deepseek.com/*`

### Message Scraping

```js
// DeepSeek uses role-based classes similar to ChatGPT
const turns = document.querySelectorAll('.dad65929, [class*="message"]');

// Check for role indicator
const isUser = el.closest('[class*="human"], [class*="user"]') !== null
             || el.querySelector('[class*="user-icon"]') !== null;
const role = isUser ? 'user' : 'assistant';
const text = el.querySelector('[class*="markdown"], [class*="content"]')?.innerText?.trim() ?? '';
```

### Chat Title

```js
document.querySelector('.ds-conversations-list [aria-selected="true"]')?.innerText?.trim()
// OR document.title
```

### Known Fragility Points

- DeepSeek uses hashed/obfuscated class names (like `.dad65929`) — these **will change** with deployments.
- Prefer structural selectors: look for role attributes, aria attributes, or positional patterns instead of hashed classes.
- DeepSeek has a "thinking" mode with `<think>` tags in output — strip these from scraped text.

---

## Shared Utilities

```js
// Strip HTML tags and collapse whitespace
function extractText(el) {
  const html = el?.innerHTML ?? '';
  const temp = document.createElement('div');
  temp.innerHTML = html;
  // Remove code block labels but keep code content
  temp.querySelectorAll('button, .copy-button').forEach(b => b.remove());
  return temp.innerText?.replace(/\s+/g, ' ')?.trim() ?? '';
}

// Wait for an element to appear (for slow-loading platforms)
function waitForElement(selector, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const el = document.querySelector(selector);
    if (el) return resolve(el);
    const observer = new MutationObserver(() => {
      const el = document.querySelector(selector);
      if (el) { observer.disconnect(); resolve(el); }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    setTimeout(() => { observer.disconnect(); reject(new Error('Timeout')); }, timeout);
  });
}
```

---

## Scraper Versioning

Each platform scraper exports a `version` string that is bumped on every selector change:

```js
export const SCRAPER_VERSIONS = {
  chatgpt:    '1.0.0',
  claude:     '1.0.0',
  gemini:     '1.0.0',
  perplexity: '1.0.0',
  deepseek:   '1.0.0',
};
```

This version is stored in the handoff object for debugging.

---

## CI Selector Validation (Planned)

A GitHub Actions workflow will run weekly:
1. Launch a headless browser (Playwright)
2. Navigate to each platform's main URL
3. Run `scrapeMessages()` and verify `messages.length > 0`
4. Alert on failure via GitHub Issues

This is **not** implemented in this step but the scraper API is designed to support it.

---

## Validation Checklist

- [ ] Scraping a real ChatGPT conversation returns correctly alternating `user`/`assistant` messages
- [ ] Scraping a real Claude conversation returns correctly alternating messages
- [ ] Scraping a real Gemini conversation returns text content (not empty strings)
- [ ] Scraping a real Perplexity conversation interleaves queries and answers correctly
- [ ] DeepSeek scraper returns messages (note: class names will need updating if hashes changed)
- [ ] `extractText()` strips HTML tags but preserves code content
- [ ] `getChatTitle()` returns a non-empty string on all 5 platforms
- [ ] Scraping an empty/new chat returns `[]` without throwing
- [ ] Output on each platform is an array of `{ role, text, index }` objects with no empty `text` values
