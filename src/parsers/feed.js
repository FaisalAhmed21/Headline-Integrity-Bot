const { XMLParser } = require('fast-xml-parser');

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '',
  removeNSPrefix: true,
  trimValues: true,
  parseTagValue: false,
  processEntities: false,
  htmlEntities: true
});

function extractTitle(raw) {
  if (typeof raw === 'string') {
    return raw.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  }

  if (!raw || typeof raw !== 'object') {
    return '';
  }

  if (raw['#text']) {
    return String(raw['#text']).trim();
  }

  if (raw.a) {
    const anchor = Array.isArray(raw.a) ? raw.a[0] : raw.a;
    if (typeof anchor === 'string') {
      return anchor.trim();
    }
    return String(anchor['#text'] || anchor.text || '').trim();
  }

  return String(raw).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function cleanGoogleNewsTitle(title, sourceName) {
  let cleaned = title.trim();
  const suffixes = [
    ` - ${sourceName}`,
    ` – ${sourceName}`,
    ` | ${sourceName}`
  ];

  for (const suffix of suffixes) {
    if (cleaned.endsWith(suffix)) {
      cleaned = cleaned.slice(0, -suffix.length).trim();
      break;
    }
  }

  return cleaned;
}

async function fetchFeed(feedUrl) {
  const response = await fetch(feedUrl, {
    headers: {
      'user-agent': 'HeadlineIntegrityChecker/1.0 (+https://github.com/)'
    },
    signal: AbortSignal.timeout(30000)
  });

  if (!response.ok) {
    throw new Error(`Feed request failed with ${response.status} ${response.statusText}`);
  }

  const xml = await response.text();
  const parsed = parser.parse(xml);
  return normalizeFeed(parsed);
}

function normalizeFeed(parsed) {
  const channel = parsed.rss ? parsed.rss.channel : parsed.feed;
  const rawItems = channel && (channel.item || channel.entry) ? channel.item || channel.entry : [];
  const items = Array.isArray(rawItems) ? rawItems : [rawItems];

  return items
    .filter(Boolean)
    .map((item) => {
      const link = item.link?.href || item.link || item.guid?.['#text'] || item.guid || item.id || item.url;
      return {
        title: extractTitle(item.title),
        link: String(link || '').trim(),
        publishedAt: String(item.pubDate || item.published || item.updated || '').trim(),
        summary: String(item.description || item.summary || '').trim(),
        sourceLabel: item.source?.['#text'] || item.source || null
      };
    })
    .filter((item) => item.title && item.link);
}

function prepareFeedItem(item, source) {
  const title = source.googleNews
    ? cleanGoogleNewsTitle(item.title, source.googleNewsSourceName || source.name)
    : item.title;

  return {
    ...item,
    rssTitle: title
  };
}

module.exports = {
  fetchFeed,
  prepareFeedItem,
  cleanGoogleNewsTitle,
  extractTitle
};
