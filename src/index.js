require('dotenv').config();

const { sources, defaults } = require('./config');
const { classifyHeadlineComparison } = require('./qa/compare');
const { openDatabase, hasArticleBeenSent, recordArticleSent, recordHeadlineCheck } = require('./db');
const { fetchFeed, prepareFeedItem } = require('./parsers/feed');
const { resolveArticleUrl, isNonArticleUrl } = require('./parsers/google-news');
const { fetchLiveArticle, closeBrowser, sleep } = require('./parsers/scraper');
const {
  sendBulletinHeader,
  sendNewsCards,
  sendFailureMessage,
  buildRunFailureMessage
} = require('./bots/telegram');

async function checkSource(source, runAt, database) {
  const result = {
    id: source.id,
    name: source.name,
    checked: 0,
    newCount: 0,
    skipped: 0,
    feedError: null,
    newItems: []
  };

  let items;
  try {
    items = await fetchFeed(source.feedUrl);
  } catch (error) {
    result.feedError = error.message;
    return result;
  }

  const limitedItems = items.slice(0, defaults.maxItemsPerFeed).map((item) => prepareFeedItem(item, source));
  // Boilerplate guard: track excerpts seen this source run.
  // If the same text appears on a second article it's a shared page element, not article content.
  const seenExcerpts = new Set();

  for (const item of limitedItems) {
    result.checked += 1;

    const resolved = await resolveArticleUrl(item.link);
    const articleUrl = resolved.url;

    if (isNonArticleUrl(articleUrl, source)) {
      result.skipped += 1;
      console.log(`  [SKIP] Non-article URL: ${articleUrl}`);
      await sleep(defaults.requestDelayMs);
      continue;
    }

    if (hasArticleBeenSent(database, articleUrl)) {
      result.skipped += 1;
      continue;
    }

    let live;
    try {
      live = await fetchLiveArticle(articleUrl, {
        pageTimeoutMs: defaults.pageTimeoutMs
      });
    } catch (error) {
      console.error(`  [ERROR] Scraping failed for ${articleUrl}:`, error.message);
      await sleep(defaults.requestDelayMs);
      continue;
    }

    if (live.status === 'NOT_FOUND' || live.status === 'FETCH_ERROR' ||
        live.status === 'QA_BLOCKED' || live.status === 'QA_BAD_HEADLINE') {
      console.error(`  [QA] ${live.status} detected: ${live.errorMessage}`);
      
      let mappedStatus = live.status;
      if (mappedStatus === 'QA_BLOCKED' || mappedStatus === 'QA_BAD_HEADLINE') {
        mappedStatus = 'FETCH_ERROR';
      }

      // Feature 2: record in DB for drift history
      recordHeadlineCheck(database, {
        runAt,
        sourceId: source.id,
        sourceName: source.name,
        itemLink: item.link,
        resolvedUrl: articleUrl,
        rssTitle: item.rssTitle,
        liveTitle: null,
        liveAuthor: null,
        livePublished: null,
        liveUpdated: null,
        status: mappedStatus,
        similarity: null,
        driftSubtype: null,
        errorMessage: live.errorMessage,
        rssPublishedAt: item.publishedAt
      });

      // Feature 1: deliver as a text-only card
      result.newCount += 1;
      result.newItems.push({
        sourceName: source.name,
        rssTitle: item.rssTitle,
        liveTitle: null,
        ogImage: null,
        excerpt: null,
        readTime: null,
        link: item.link,
        driftStatus: mappedStatus,
        driftSubtype: null,
        driftSimilarity: null
      });

      await sleep(defaults.requestDelayMs);
      continue;
    }

    // Feature 2: Run headline drift comparison (RSS title vs live title)
    let driftStatus = 'UNAVAILABLE';
    let driftSubtype = null;
    let driftSimilarity = null;

    if (item.rssTitle && live.liveTitle) {
      try {
        const comparison = classifyHeadlineComparison(item.rssTitle, live.liveTitle, {
          matchThreshold: defaults.matchThreshold,
          minorEditThreshold: defaults.minorEditThreshold
        });
        driftStatus = comparison.status;
        driftSubtype = comparison.driftSubtype;
        driftSimilarity = comparison.similarity;
      } catch (compareErr) {
        console.error(`  [DRIFT] Comparison failed for ${articleUrl}: ${compareErr.message}`);
        driftStatus = 'UNAVAILABLE';
      }
    } else if (!item.rssTitle) {
      driftStatus = 'UNAVAILABLE';
    }

    // Feature 2: Store drift result in DB for historical tracking
    recordHeadlineCheck(database, {
      runAt,
      sourceId: source.id,
      sourceName: source.name,
      itemLink: item.link,
      resolvedUrl: live.resolvedUrl || articleUrl,
      rssTitle: item.rssTitle,
      liveTitle: live.liveTitle,
      liveAuthor: live.liveAuthor,
      livePublished: live.livePublished,
      liveUpdated: live.liveUpdated,
      status: driftStatus === 'UNAVAILABLE' ? 'UNCERTAIN' : driftStatus,
      similarity: driftSimilarity,
      driftSubtype,
      errorMessage: null,
      rssPublishedAt: item.publishedAt
    });

    console.log(`  [DRIFT] ${driftStatus}${driftSubtype ? ' / ' + driftSubtype : ''} (sim=${driftSimilarity?.toFixed(3) ?? 'n/a'}) for ${articleUrl}`);

    // Boilerplate dedup: null any excerpt already seen from this source in this run
    let excerpt = live.excerpt || null;
    if (excerpt) {
      if (seenExcerpts.has(excerpt)) {
        console.log(`  [EXCERPT] Duplicate text detected — likely boilerplate, nulling excerpt for ${articleUrl}`);
        excerpt = null;
      } else {
        seenExcerpts.add(excerpt);
      }
    }

    // Feature 1 + 2 combined: article card carries both content and QA metadata
    result.newCount += 1;
    result.newItems.push({
      sourceName: source.name,
      rssTitle: item.rssTitle,
      liveTitle: live.liveTitle,
      ogImage: live.ogImage || null,
      excerpt,
      readTime: live.readTime || null,
      link: live.resolvedUrl || articleUrl,
      driftStatus,
      driftSubtype,
      driftSimilarity
    });

    recordArticleSent(database, articleUrl, item.publishedAt);
    database.save();

    await sleep(defaults.requestDelayMs);
  }

  return result;
}

async function main() {
  const runAt = new Date().toISOString();
  let database = null;
  const sourceResults = [];

  try {
    database = await openDatabase(defaults.dbPath);

    for (const source of sources) {
      console.log(`Checking ${source.name}...`);
      const sourceResult = await checkSource(source, runAt, database);
      sourceResults.push(sourceResult);

      const statusLine = sourceResult.feedError
        ? `${source.name}: feed error — ${sourceResult.feedError}`
        : `${source.name}: ${sourceResult.checked} checked, ${sourceResult.newCount} new articles` +
          (sourceResult.skipped > 0 ? `, ${sourceResult.skipped} skipped (already sent/non-article)` : '');

      console.log(statusLine);
      await sleep(defaults.requestDelayMs);
    }

    const successfulSources = sourceResults.filter((item) => !item.feedError);
    const totalNew = sourceResults.reduce((sum, item) => sum + item.newCount, 0);

    if (successfulSources.length === 0) {
      throw new Error('All RSS feeds failed — no sources could be checked.');
    }

    if (!defaults.dryRun) {
      if (totalNew === 0) {
        console.log('No new articles found this run.');
      } else {
        const allNewItems = sourceResults.flatMap((r) => r.newItems);
        await sendBulletinHeader(defaults.botToken, defaults.chatId, allNewItems, runAt);
        await new Promise(r => setTimeout(r, 2000));
        const cardResults = await sendNewsCards(defaults.botToken, defaults.chatId, allNewItems);
        const photoCount = Array.isArray(cardResults) ? cardResults.filter((r) => r._deliveryMethod === 'sendPhoto').length : 0;
        const textCount = Array.isArray(cardResults) ? cardResults.length - photoCount : 0;
        console.log(`Telegram: bulletin sent, then ${photoCount} silent photo card(s), ${textCount} silent text card(s)`);
      }
    } else {
      console.log(`Dry run — Telegram delivery skipped. Found ${totalNew} new articles.`);
    }
  } catch (error) {
    console.error('Run failed:', error.message);

    if (!defaults.dryRun) {
      try {
        await sendFailureMessage(
          defaults.botToken,
          defaults.chatId,
          buildRunFailureMessage(runAt, error.message)
        );
      } catch (telegramError) {
        console.error('Failed to send Telegram error alert:', telegramError.message);
      }
    }

    process.exitCode = 1;
  } finally {
    await closeBrowser();
    if (database) {
      database.save();
      database.close();
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
