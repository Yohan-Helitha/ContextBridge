// ContextBridge — Platform Scrapers
// Per-platform DOM selectors and scrape logic for all 5 supported AI platforms.
// All scraping is read-only DOM access. No platform APIs or credentials are used.
// Full implementation: Step 05

export function getScraperForPlatform(platform) {
  console.debug('[ContextBridge] scrapers stub — platform:', platform);
  return null;
}

export const SCRAPER_VERSIONS = {
  chatgpt:    '1.0.0',
  claude:     '1.0.0',
  gemini:     '1.0.0',
  perplexity: '1.0.0',
  deepseek:   '1.0.0',
};
