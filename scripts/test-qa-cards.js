require('dotenv').config();
const { sendNewsCards, sendBulletinHeader } = require('../src/bots/telegram');
const { defaults } = require('../src/config');

const mockItems = [
  {
    sourceName: 'The Daily Star',
    rssTitle: 'Bangladesh team returns home after historic win',
    liveTitle: '🧪 TEST DATA: Bangladesh team returns home after historic win',
    ogImage: 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c', // random valid image
    readTime: 3,
    link: 'https://www.thedailystar.net/news/bangladesh/1',
    driftStatus: 'MATCH',
    driftSubtype: null,
    driftSimilarity: 1.0
  },
  {
    sourceName: 'Dhaka Tribune',
    rssTitle: 'Saudi Arabia, Turkiye and Pakistan to sign defense deal',
    liveTitle: '🧪 TEST DATA: Saudi Arabia, Turkiye, Pakistan to sign defense',
    ogImage: 'https://images.unsplash.com/photo-1504711434969-e33886168f5c',
    readTime: 2,
    link: 'https://www.dhakatribune.com/world/1',
    driftStatus: 'MINOR_EDIT',
    driftSubtype: 'STYLE_SHORTENING',
    driftSimilarity: 0.857,
    excerpt: 'The three nations are set to finalize a landmark defense cooperation framework agreements during the upcoming summit in Riyadh.'
  },
  {
    sourceName: 'BBC Sport',
    rssTitle: 'Article that went missing from site',
    liveTitle: '🧪 TEST DATA: Article that went missing from site',
    ogImage: null,
    readTime: null,
    link: 'https://www.bbc.co.uk/sport/football/missing-article-url',
    driftStatus: 'NOT_FOUND',
    driftSubtype: null,
    driftSimilarity: null
  }
];

(async function main() {
  try {
    console.log('Sending Bulletin Header...');
    const headerResult = await sendBulletinHeader(defaults.botToken, defaults.chatId, mockItems, new Date().toISOString());
    console.log('\n--- BULLETIN HEADER RESPONSE ---');
    console.log(JSON.stringify(headerResult, null, 2));

    console.log('\nSending Cards (silently)...');
    const cardResults = await sendNewsCards(defaults.botToken, defaults.chatId, mockItems);
    
    console.log('\n--- MATCH CARD RESPONSE ---');
    console.log(JSON.stringify(cardResults[0], null, 2));

    console.log('\n--- MINOR_EDIT CARD RESPONSE ---');
    console.log(JSON.stringify(cardResults[1], null, 2));

    console.log('\n--- NOT_FOUND CARD RESPONSE ---');
    console.log(JSON.stringify(cardResults[2], null, 2));

  } catch (err) {
    console.error('Test run failed:', err);
  }
})();
