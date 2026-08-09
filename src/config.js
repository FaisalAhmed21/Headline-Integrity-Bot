/**
 * Verified RSS sources for headline integrity checking.
 * Substitutes are documented inline where direct publisher feeds are unavailable.
 */

const sources = [
  {
    id: 'prothom-alo',
    name: 'Prothom Alo',
    feedUrl: 'https://www.prothomalo.com/feed',
    directFeed: true
  },
  {
    id: 'daily-star',
    name: 'The Daily Star',
    feedUrl: 'https://www.thedailystar.net/frontpage/rss.xml',
    directFeed: true,
    notes: 'Main /rss.xml exceeds XML entity limits; frontpage category feed verified working.'
  },
  {
    id: 'dhaka-tribune',
    name: 'Dhaka Tribune',
    feedUrl: 'https://www.dhakatribune.com/feed/',
    directFeed: true
  },
  {
    id: 'guardian-world',
    name: 'The Guardian',
    feedUrl: 'https://www.theguardian.com/world/rss',
    directFeed: true,
    notes: 'Replaces bdnews24 (dead feed). Provides reliable, high-quality international news coverage.'
  },
  {
    id: 'al-jazeera',
    name: 'Al Jazeera',
    feedUrl: 'https://www.aljazeera.com/xml/rss/all.xml',
    directFeed: true
  },
  {
    id: 'bbc-sport',
    name: 'BBC Sport',
    feedUrl: 'https://feeds.bbci.co.uk/sport/rss.xml?edition=uk',
    directFeed: true
  }
];

const defaults = {
  dbPath: process.env.DB_PATH || 'data/headlines.sqlite',
  botToken: process.env.BOT_TOKEN || '',
  chatId: process.env.CHAT_ID || '',
  maxItemsPerFeed: Number(process.env.MAX_ITEMS_PER_FEED || 10),
  requestDelayMs: Number(process.env.REQUEST_DELAY_MS || 2500),
  pageTimeoutMs: Number(process.env.PAGE_TIMEOUT_MS || 60000),
  dryRun: String(process.env.DRY_RUN || '').toLowerCase() === 'true' || process.argv.includes('--dry-run'),
  minorEditThreshold: Number(process.env.MINOR_EDIT_THRESHOLD || 0.85),
  matchThreshold: Number(process.env.MATCH_THRESHOLD || 0.95)
};

module.exports = {
  sources,
  defaults
};
