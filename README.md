# News Headline Watcher

An automated news aggregation and headline integrity monitoring system. This project continuously polls major news sources, extracts article contents using a headless browser, and delivers them via Telegram while simultaneously verifying that publisher headlines haven't been silently manipulated.

## Core Features

This project serves two distinct, equally important features in a unified pipeline:

### Feature 1: Article Delivery (Bulletin Format)
The bot acts as a high-quality news aggregator. It fetches new articles and delivers them to a private Telegram chat in a clean, readable format. 
- **Bulletin Header:** A single notification (e.g., "🌙 Night Bulletin") is sent announcing the number of new articles.
- **Silent Delivery:** Following the header, individual article cards are sent silently to avoid spamming phone notifications.
- **Rich Cards:** Each article card extracts the publisher's main image (`og:image`), the live headline, a clean excerpt from the article body, and an estimated read time.
- **NOT_FOUND Behavior:** If an article is missing (404), scraping and image extraction are skipped entirely, and a text-only card is sent noting the missing status.
- **Test Output:** Test scripts like `test-qa-cards.js` strictly prefix their output with `🧪 TEST DATA:` to prevent confusion with real pipeline runs.

### Feature 2: Headline Drift Verification (QA)
Before delivering any article, the system performs a quality assurance check against the original RSS feed.
- It compares the headline claimed in the RSS feed against the actual live `<h1>` headline extracted by Playwright from the article page using fuzzy string matching.
- **MATCH:** The live headline accurately reflects the RSS claim.
- **MINOR_EDIT:** The publisher tweaked the headline (similarity 0.85–0.95).
- **MAJOR_EDIT:** The publisher significantly rewrote the headline after publication (similarity below 0.85).
- **NOT_FOUND:** The article was removed or returns a 404/410 error.
- **FETCH_ERROR:** Playwright failed to load the page (timeout, network error, block).

**Drift Sub-classifications:**
When an edit is detected, it is further sub-classified to understand the publisher's intent:
- **STYLE_SHORTENING:** Words were dropped from the RSS title (usually stop-words or conjunctions) to fit the live page, but the core nouns/verbs remain.
- **CONTENT_CHANGE:** The actual nouns, verbs, or named entities changed, suggesting a factual update or rewrite.
- **UNCERTAIN:** The change is too complex to confidently classify.

This drift status is appended to the bottom of every article card delivered to Telegram.

## Active Sources
The current configuration (`src/config.js`) monitors the following 6 sources:

| Source | Method | Link |
|--------|--------|------|
| **Prothom Alo** | Direct RSS | [https://www.prothomalo.com/feed](https://www.prothomalo.com/feed) |
| **The Daily Star** | Direct RSS | [https://www.thedailystar.net/frontpage/rss.xml](https://www.thedailystar.net/frontpage/rss.xml) |
| **Dhaka Tribune** | Direct RSS | [https://www.dhakatribune.com/feed/](https://www.dhakatribune.com/feed/) |
| **The Guardian** | Direct RSS | [https://www.theguardian.com/world/rss](https://www.theguardian.com/world/rss) |
| **Al Jazeera** | Direct RSS | [https://www.aljazeera.com/xml/rss/all.xml](https://www.aljazeera.com/xml/rss/all.xml) |
| **BBC Sport** | Direct RSS | [https://feeds.bbci.co.uk/sport/rss.xml?edition=uk](https://feeds.bbci.co.uk/sport/rss.xml?edition=uk) |

## Architecture & Folder Structure

The project has been refactored into a modular structure:

```text
src/
├── bots/
│   └── telegram.js      # Handles Telegram API formatting, UI rendering, and message delivery
├── parsers/
│   ├── feed.js          # RSS feed fetching and normalization
│   ├── google-news.js   # Decodes Base64 Google News redirect URLs
│   └── scraper.js       # Playwright DOM extraction (images, excerpts, timestamps)
├── qa/
│   └── compare.js       # Fuzzy string comparison and headline drift classification
├── config.js            # Source lists and threshold configurations
├── db.js                # SQLite schema and history tracking
└── index.js             # Main pipeline orchestrator
```

## Setup & Configuration

Configure the bot using the following environment variables (or rely on defaults in `src/config.js`):

| Variable | Description | Default |
|----------|-------------|---------|
| `BOT_TOKEN` | Telegram Bot API token | *(Required)* |
| `CHAT_ID` | Telegram Chat ID for delivery | *(Required)* |
| `DB_PATH` | Path to the SQLite database | `data/headlines.sqlite` |
| `MAX_ITEMS_PER_FEED` | Max articles to process per source per run | `10` |
| `REQUEST_DELAY_MS` | Delay between processing articles to prevent rate-limiting | `2500` |
| `PAGE_TIMEOUT_MS` | Timeout for Playwright page loads | `60000` |
| `MINOR_EDIT_THRESHOLD` | Levenshtein similarity threshold for minor drift | `0.85` |
| `MATCH_THRESHOLD` | Levenshtein similarity threshold for a perfect match | `0.95` |

## Deployment (GitHub Actions)
The project is fully automated via GitHub Actions (`.github/workflows/news-bot.yml`).
- Runs on a **cron schedule every 6 hours**.
- Executes the full `node src/index.js` pipeline.
- Automatically commits and pushes the updated SQLite database (`data/headlines.sqlite`) back to the repository to maintain historical drift state between runs.

## Known Issues & Design Decisions
- **Source Filtering & Bot-Blocking:** 
  - *bdnews24* was dropped because its Google News substitute returned topic/tag aggregation pages instead of real articles. It was replaced with The Guardian.
  - *Reuters (HTTP 401)* and *ESPN Cricinfo (HTTP 403)* actively blocked headless browsers. They were also removed to adhere strictly to a six-source limit.
- **Excerpt Boilerplate Contamination:** Initial versions pulled footer/sidebar/newsletter text instead of real article body text. Fixed via strict DOM selectors (excluding `<nav>`, `<footer>`, `<aside>`, etc.) combined with a cross-article text deduplication fallback.
- **Strict Image Policy:** Images strictly follow `og:image` → `twitter:image` → `null`. Explicitly, **no generic/logo/stock-photo fallbacks are permitted**. Supplying an unrelated image on a news article is considered worse than no image because it misrepresents the source content.

