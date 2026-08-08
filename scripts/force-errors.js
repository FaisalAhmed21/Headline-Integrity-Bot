require('dotenv').config();
const { fetchLiveArticle, closeBrowser } = require('../src/parsers/scraper');
const { sendNewsCards } = require('../src/bots/telegram');
const { defaults } = require('../src/config');

async function main() {
  try {
    console.log('Testing 404 NOT_FOUND path...');
    const notFoundUrl = 'https://www.bbc.co.uk/news/this-page-does-not-exist-for-sure-12345';
    const liveNotFound = await fetchLiveArticle(notFoundUrl, { pageTimeoutMs: 30000 });
    console.log('Scraper returned status:', liveNotFound.status);

    console.log('\nTesting FETCH_ERROR (Timeout) path...');
    const timeoutUrl = 'https://www.thedailystar.net/news/bangladesh/1';
    // Force a timeout by giving it only 1ms
    const liveTimeout = await fetchLiveArticle(timeoutUrl, { pageTimeoutMs: 1 });
    console.log('Scraper returned status:', liveTimeout.status);

    const newItems = [];

    // Process NOT_FOUND exactly as index.js does
    if (liveNotFound.status === 'NOT_FOUND') {
      newItems.push({
        sourceName: 'BBC News',
        rssTitle: 'A Fake 404 News Story',
        liveTitle: null,
        ogImage: null,
        excerpt: null,
        readTime: null,
        link: notFoundUrl,
        driftStatus: 'NOT_FOUND',
        driftSubtype: null,
        driftSimilarity: null
      });
    }

    // Process FETCH_ERROR exactly as index.js does
    if (liveTimeout.status === 'FETCH_ERROR') {
      newItems.push({
        sourceName: 'The Daily Star',
        rssTitle: 'A Fake Timeout News Story',
        liveTitle: null,
        ogImage: null,
        excerpt: null,
        readTime: null,
        link: timeoutUrl,
        driftStatus: 'FETCH_ERROR',
        driftSubtype: null,
        driftSimilarity: null
      });
    }

    console.log('\nSending Cards (silently) to Telegram...');
    const cardResults = await sendNewsCards(defaults.botToken, defaults.chatId, newItems);
    
    console.log('\n--- NOT_FOUND CARD RESPONSE ---');
    console.log(JSON.stringify(cardResults[0], null, 2));

    console.log('\n--- FETCH_ERROR CARD RESPONSE ---');
    console.log(JSON.stringify(cardResults[1], null, 2));

  } catch (err) {
    console.error('Test failed:', err);
  } finally {
    await closeBrowser();
  }
}

main();
