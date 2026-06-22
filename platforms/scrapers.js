// ContextBridge — Platform Scrapers
// Per-platform DOM selectors and scrape logic for all 5 supported AI platforms.
// All scraping is read-only DOM access. No platform APIs or credentials are used.
//
// Each scraper implements:
//   scrapeMessages()       → Message[]         (normalized { role, text, index })
//   getChatTitle()         → string
//   getHistoryList()       → HistoryItem[]
//   navigateToHistory(url) → Promise<void>

// ---------------------------------------------------------------------------
// Scraper version registry — bump on every selector change
// ---------------------------------------------------------------------------

export const SCRAPER_VERSIONS = {
  chatgpt:    '1.0.0',
  claude:     '1.0.0',
  gemini:     '1.0.0',
  perplexity: '1.0.0',
  deepseek:   '1.0.0',
};

// ---------------------------------------------------------------------------
// Shared utilities
// ---------------------------------------------------------------------------

/**
 * Strip HTML tags and collapse whitespace.
 * Removes copy-buttons/labels but preserves code content.
 * @param {Element|null} el
 * @returns {string}
 */
function extractText(el) {
  if (!el) return '';
  const temp = document.createElement('div');
  temp.innerHTML = el.innerHTML ?? '';
  // Remove UI chrome that isn't conversation content
  temp.querySelectorAll('button, .copy-button, [aria-label="Copy code"]').forEach(b => b.remove());
  return (temp.innerText ?? '').replace(/\s+/g, ' ').trim();
}

/**
 * Wait for a CSS selector to appear in the DOM.
 * @param {string} selector
 * @param {number} [timeout=5000]
 * @returns {Promise<Element>}
 */
function waitForElement(selector, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(selector);
    if (existing) return resolve(existing);

    const observer = new MutationObserver(() => {
      const el = document.querySelector(selector);
      if (el) {
        observer.disconnect();
        resolve(el);
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    setTimeout(() => {
      observer.disconnect();
      reject(new Error(`waitForElement timed out: "${selector}"`));
    }, timeout);
  });
}

/**
 * Navigate to a URL and wait for the page to settle.
 * @param {string} url
 * @returns {Promise<void>}
 */
async function navigateTo(url) {
  window.location.href = url;
  await new Promise(r => setTimeout(r, 1500)); // allow SPA router to settle
}

/**
 * Normalise a raw messages array — filter empties and add 0-based index.
 * @param {{ role: 'user'|'assistant', text: string }[]} raw
 * @returns {import('./scrapers.js').Message[]}
 */
function normalise(raw) {
  return raw
    .filter(m => m.text.length > 0)
    .map((m, i) => ({ role: m.role, text: m.text, index: i }));
}

// ---------------------------------------------------------------------------
// Platform 1: ChatGPT
// ---------------------------------------------------------------------------

const chatgptScraper = {
  scrapeMessages() {
    // 'data-message-author-role' is the most stable anchor ChatGPT provides
    const turns = Array.from(document.querySelectorAll('[data-message-author-role]'));

    const raw = turns.map(el => {
      const role = el.getAttribute('data-message-author-role') === 'user' ? 'user' : 'assistant';
      // Try to click 'Show more' if it exists within this turn
      el.querySelector('[data-testid="show-more-button"]')?.click();
      const textEl = el.querySelector('.markdown, .whitespace-pre-wrap, [class*="prose"]');
      const text = extractText(textEl ?? el);
      return { role, text };
    });

    return normalise(raw);
  },

  getChatTitle() {
    // Prefer the explicit conversation title element in the sidebar
    const sidebarTitle = document.querySelector('nav [data-testid="conversation-title"]')?.innerText?.trim();
    if (sidebarTitle) return sidebarTitle;
    return document.title.replace(/\s*[-|]\s*ChatGPT\s*$/i, '').trim() || 'ChatGPT Chat';
  },

  getHistoryList() {
    const items = Array.from(document.querySelectorAll('nav li[data-testid]'));
    return items.map(el => ({
      title: el.innerText?.trim() ?? '',
      url: el.querySelector('a')?.href ?? '',
    })).filter(item => item.url);
  },

  async navigateToHistory(url) {
    await navigateTo(url);
  },
};

// ---------------------------------------------------------------------------
// Platform 2: Claude
// ---------------------------------------------------------------------------

const claudeScraper = {
  scrapeMessages() {
    // Prefer the conversation-turn data-testid pattern
    const turns = Array.from(document.querySelectorAll(
      '[data-testid="conversation-turn-user"], [data-testid="conversation-turn-assistant"]'
    ));

    if (turns.length > 0) {
      const raw = turns.map(el => {
        const role = el.dataset.testid?.includes('user') ? 'user' : 'assistant';
        const textEl = el.querySelector('p, .prose, [class*="prose"], .whitespace-pre-wrap');
        const text = extractText(textEl ?? el);
        return { role, text };
      });
      return normalise(raw);
    }

    // Fallback: pair user-message and claude-message elements in DOM order
    const allMessages = Array.from(document.querySelectorAll(
      '[data-testid="user-message"], .font-claude-message'
    )).sort((a, b) => a.compareDocumentPosition(b) & 4 ? -1 : 1);

    const raw = allMessages.map(el => {
      const isUser = el.dataset.testid === 'user-message';
      const role = isUser ? 'user' : 'assistant';
      const text = extractText(el);
      return { role, text };
    });

    return normalise(raw);
  },

  getChatTitle() {
    const triggerTitle = document.querySelector('[data-testid="chat-menu-trigger"]')?.innerText?.trim();
    if (triggerTitle) return triggerTitle;
    return document.title.replace(/\s*[-|]\s*Claude\s*$/i, '').trim() || 'Claude Chat';
  },

  getHistoryList() {
    const items = Array.from(document.querySelectorAll(
      '[data-testid="conversation-list"] a, nav a[href*="/chat/"]'
    ));
    return items.map(el => ({
      title: el.innerText?.trim() ?? '',
      url: el.href ?? '',
    })).filter(item => item.url);
  },

  async navigateToHistory(url) {
    await navigateTo(url);
  },
};

// ---------------------------------------------------------------------------
// Platform 3: Gemini
// ---------------------------------------------------------------------------

const geminiScraper = {
  async scrapeMessages() {
    // Gemini uses Angular custom elements — tag names are stable
    try {
      await waitForElement('conversation-turn', 3000);
    } catch {
      // No turns found within timeout — may be an empty chat
    }

    const turns = Array.from(document.querySelectorAll('conversation-turn'));

    const raw = turns.map(turn => {
      const userQueryEl = turn.querySelector('.user-query-text, [class*="user-query"]');
      const isUser = userQueryEl !== null;
      const role = isUser ? 'user' : 'assistant';
      const textEl = isUser
        ? userQueryEl
        : turn.querySelector('.model-response-text, .markdown, [class*="model-response"], [class*="response-container"]');
      const text = extractText(textEl ?? turn);
      return { role, text };
    });

    return normalise(raw);
  },

  getChatTitle() {
    const titleEl = document.querySelector('.conversation-title, [class*="conversation-title"]');
    if (titleEl?.innerText?.trim()) return titleEl.innerText.trim();
    return document.title.replace(/\s*[-|]\s*Gemini\s*$/i, '').trim() || 'Gemini Chat';
  },

  getHistoryList() {
    const items = Array.from(document.querySelectorAll(
      '.conversation-list-item a, [class*="conversation-item"] a, mat-list-item a'
    ));
    return items.map(el => ({
      title: el.innerText?.trim() ?? '',
      url: el.href ?? '',
    })).filter(item => item.url);
  },

  async navigateToHistory(url) {
    await navigateTo(url);
  },
};

// ---------------------------------------------------------------------------
// Platform 4: Perplexity
// ---------------------------------------------------------------------------

const perplexityScraper = {
  scrapeMessages() {
    // Perplexity separates queries and answers in distinct DOM nodes.
    // Interleave them by DOM position to reconstruct turn order.
    const allElements = Array.from(document.querySelectorAll(
      '[data-testid="query-text"], [data-testid="user-query"], .prose.dark\\:prose-invert'
    )).sort((a, b) => a.compareDocumentPosition(b) & 4 ? -1 : 1);

    const raw = allElements.map(el => {
      // A query is user; a prose answer is assistant
      const isUser =
        el.closest('[data-testid="user-query"]') !== null ||
        el.dataset.testid === 'query-text' ||
        el.dataset.testid === 'user-query';
      const role = isUser ? 'user' : 'assistant';
      const text = extractText(el);
      return { role, text };
    });

    return normalise(raw);
  },

  getChatTitle() {
    return document.title.replace(/\s*[-|]\s*Perplexity\s*$/i, '').trim() || 'Perplexity Chat';
  },

  getHistoryList() {
    const items = Array.from(document.querySelectorAll(
      '[class*="sidebar"] a[href*="/search/"], [class*="thread"] a'
    ));
    return items.map(el => ({
      title: el.innerText?.trim() ?? '',
      url: el.href ?? '',
    })).filter(item => item.url);
  },

  async navigateToHistory(url) {
    await navigateTo(url);
  },
};

// ---------------------------------------------------------------------------
// Platform 5: DeepSeek
// ---------------------------------------------------------------------------

/**
 * Strip <think>…</think> reasoning tags from DeepSeek output.
 * @param {string} text
 * @returns {string}
 */
function stripThinkTags(text) {
  return text.replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/\s+/g, ' ').trim();
}

const deepseekScraper = {
  scrapeMessages() {
    // Avoid hashed class names — use structural / aria / role selectors instead.
    // DeepSeek wraps each turn in a div that contains either a human or AI role indicator.
    let turns = Array.from(document.querySelectorAll(
      '[class*="human-message"], [class*="user-message"], [class*="assistant-message"], [class*="ai-message"]'
    ));

    if (turns.length === 0) {
      // Broader fallback: any div with a role-style attribute
      turns = Array.from(document.querySelectorAll('[data-role], [role="article"]'));
    }

    const raw = turns.map(el => {
      const isUser =
        el.closest('[class*="human"], [class*="user"]') !== null ||
        el.querySelector('[class*="user-icon"], [class*="human-icon"]') !== null ||
        el.getAttribute('data-role') === 'user';
      const role = isUser ? 'user' : 'assistant';
      const contentEl = el.querySelector('[class*="markdown"], [class*="content"], [class*="message-text"]');
      const raw = extractText(contentEl ?? el);
      const text = isUser ? raw : stripThinkTags(raw);
      return { role, text };
    });

    return normalise(raw);
  },

  getChatTitle() {
    // Active conversation in the sidebar is typically aria-selected
    const activeItem = document.querySelector(
      '.ds-conversations-list [aria-selected="true"], [class*="conversations"] [aria-selected="true"]'
    );
    if (activeItem?.innerText?.trim()) return activeItem.innerText.trim();
    return document.title.replace(/\s*[-|]\s*DeepSeek\s*$/i, '').trim() || 'DeepSeek Chat';
  },

  getHistoryList() {
    const items = Array.from(document.querySelectorAll(
      '.ds-conversations-list li a, [class*="conversations-list"] li a'
    ));
    return items.map(el => ({
      title: el.innerText?.trim() ?? '',
      url: el.href ?? '',
    })).filter(item => item.url);
  },

  async navigateToHistory(url) {
    await navigateTo(url);
  },
};

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

const SCRAPERS = {
  chatgpt:    chatgptScraper,
  claude:     claudeScraper,
  gemini:     geminiScraper,
  perplexity: perplexityScraper,
  deepseek:   deepseekScraper,
};

/**
 * Returns the scraper for the given platform identifier, or null if unsupported.
 * @param {'chatgpt'|'claude'|'gemini'|'perplexity'|'deepseek'} platform
 * @returns {typeof chatgptScraper | null}
 */
export function getScraperForPlatform(platform) {
  return SCRAPERS[platform] ?? null;
}
