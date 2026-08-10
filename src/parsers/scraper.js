const { chromium } = require('playwright');

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

let browserPromise = null;

function getBrowser() {
  if (!browserPromise) {
    browserPromise = chromium.launch({ headless: true });
  }
  return browserPromise;
}

async function closeBrowser() {
  if (browserPromise) {
    const browser = await browserPromise;
    await browser.close();
    browserPromise = null;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function extractArticle(page) {
  return page.evaluate(() => {
    const pickText = (value) => String(value || '').replace(/\s+/g, ' ').trim();

    const headlineSelectors = [
      'article h1',
      'main h1',
      'h1',
      '[data-testid="headline"]',
      '.story-headline',
      '.article-title'
    ];

    let headline = '';
    for (const selector of headlineSelectors) {
      const element = document.querySelector(selector);
      const text = pickText(element?.textContent);
      if (text.length >= 8) {
        headline = text;
        break;
      }
    }

    if (!headline) {
      headline = pickText(
        document.querySelector('meta[property="og:title"]')?.content ||
          document.querySelector('meta[name="twitter:title"]')?.content
      );
    }

    const author =
      pickText(document.querySelector('[rel="author"]')?.textContent) ||
      pickText(document.querySelector('.author')?.textContent) ||
      pickText(document.querySelector('.byline')?.textContent) ||
      pickText(document.querySelector('meta[name="author"]')?.content) ||
      pickText(document.querySelector('meta[property="article:author"]')?.content) ||
      null;

    const published =
      document.querySelector('time[datetime]')?.getAttribute('datetime') ||
      document.querySelector('meta[property="article:published_time"]')?.content ||
      document.querySelector('meta[name="pubdate"]')?.content ||
      document.querySelector('meta[name="date"]')?.content ||
      pickText(document.querySelector('time')?.textContent) ||
      null;

    const updated =
      document.querySelector('meta[property="article:modified_time"]')?.content ||
      document.querySelector('time[datetime][itemprop="dateModified"]')?.getAttribute('datetime') ||
      null;

    // Image: og:image → twitter:image → null. Never a generic/logo/fallback image.
    let ogImage =
      document.querySelector('meta[property="og:image"]')?.content ||
      document.querySelector('meta[name="twitter:image"]')?.content ||
      null;

    if (ogImage && !ogImage.startsWith('http')) ogImage = null;

    // Extract main article text for excerpt and read time.
    // IMPORTANT: intentionally no fallback to 'main p' or all-p — those grabs
    // boilerplate (footers, sidebars, related-articles widgets) that appears on
    // every page and produces identical excerpts across different articles.
    let articleText = '';
    const textSelectors = [
      'article p',
      '.article-body p',
      '.story-body p',
      '.story__content p',
      '.article__body p',
      '.post-content p',
      '[class*="article-content"] p',
      '[class*="story-content"] p',
      '[itemprop="articleBody"] p'
    ];

    // Ancestor tags that indicate a paragraph is NOT article content
    const boilerplateAncestors = ['nav', 'footer', 'aside', 'header',
      '.related', '.sidebar', '.widget', '.ad', '.advertisement',
      '.comments', '.social-share', '.newsletter'];

    function isBoilerplate(el) {
      let node = el.parentElement;
      while (node && node !== document.body) {
        const tag = node.tagName ? node.tagName.toLowerCase() : '';
        const cls = (node.className || '').toLowerCase();
        if (boilerplateAncestors.some(b => tag === b || cls.includes(b.replace('.', '')))) {
          return true;
        }
        node = node.parentElement;
      }
      return false;
    }

    let paragraphs = [];
    for (const selector of textSelectors) {
      const nodes = Array.from(document.querySelectorAll(selector))
        .filter(n => !isBoilerplate(n));
      if (nodes.length > 0) {
        const cleaned = nodes.map(n => pickText(n.textContent)).filter(t => t.length > 40);
        if (cleaned.length > 0) {
          paragraphs = cleaned;
          articleText = cleaned.join(' ');
          break;
        }
      }
    }

    let excerpt = null;
    let readTime = null;

    if (articleText) {
      const words = articleText.split(/\s+/).filter(Boolean).length;
      readTime = Math.max(1, Math.ceil(words / 238));
      const firstTwo = paragraphs.slice(0, 2).join('\n\n');
      excerpt = firstTwo.length > 450 ? firstTwo.slice(0, 447) + '...' : firstTwo;
    }

    return {
      headline,
      author,
      published,
      updated,
      ogImage,
      excerpt,
      readTime,
      finalUrl: window.location.href,
      httpStatus: null
    };
  });
}

/**
 * Playwright QA checks — runs after the page is loaded and extracted.
 * Returns { passed: true } or { passed: false, reason: 'QA_*', message: '...' }
 */
async function runQaChecks(page, extracted) {
  // QA 1: Paywall / Cookie Wall / Login Gate detection
  const isBlocked = await page.evaluate(() => {
    const blockSignals = [
      ...Array.from(document.querySelectorAll(
        '[class*="paywall"], [id*="paywall"], [class*="subscribe"], ' +
        '[class*="login-gate"], [class*="registration-wall"]'
      )),
    ];
    for (const el of blockSignals) {
      const rect = el.getBoundingClientRect();
      if (rect.width > 200 && rect.height > 150) return true;
    }
    const isPaywalled = document.querySelector('meta[property="isAccessibleForFree"][content="False"]');
    if (isPaywalled) return true;
    return false;
  });

  if (isBlocked) {
    return { passed: false, reason: 'QA_BLOCKED', message: 'Paywall, cookie wall, or login gate detected' };
  }

  // QA 2: Headline plausibility
  const headline = extracted.headline || '';
  const badHeadlinePhrases = /^(sign in|log in|subscribe|page not found|404|access denied|error|home)$/i;
  if (headline.length < 10 || badHeadlinePhrases.test(headline.trim())) {
    return { passed: false, reason: 'QA_BAD_HEADLINE', message: `Headline failed plausibility check: "${headline}"` };
  }

  // QA 3: Excerpt quality (soft check — doesn't block, just nulls the excerpt)
  if (extracted.excerpt && extracted.excerpt.length < 60) {
    extracted.excerpt = null;
  }

  // QA 4: Image pre-validation via HEAD request (prevents sendPhoto crashes on dead image URLs)
  if (extracted.ogImage) {
    try {
      const imgResp = await fetch(extracted.ogImage, { method: 'HEAD', signal: AbortSignal.timeout(5000) });
      if (!imgResp.ok) {
        extracted.ogImage = null;
      }
    } catch {
      extracted.ogImage = null;
    }
  }

  return { passed: true };
}

async function fetchLiveArticle(url, options) {
  const browser = await getBrowser();
  const context = await browser.newContext({
    userAgent: USER_AGENT,
    locale: 'en-US',
    extraHTTPHeaders: {
      'accept-language': 'en-US,en;q=0.9',
      accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
    }
  });
  const page = await context.newPage();

  // Block unnecessary resources to massively speed up parsing and avoid 30s domcontentloaded timeouts
  await page.route('**/*', (route) => {
    const resourceType = route.request().resourceType();
    if (['image', 'media', 'font', 'stylesheet', 'script'].includes(resourceType)) {
      route.abort();
    } else {
      route.continue();
    }
  });

  try {
    let response = null;
    try {
      response = await page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: options.pageTimeoutMs
      });
    } catch (gotoErr) {
      if (gotoErr.message.includes('Timeout')) {
        console.log(`  [WARN] Goto timed out, proceeding with extraction for ${url}`);
      } else {
        throw gotoErr;
      }
    }

    await sleep(1000);

    const status = response ? response.status() : 200;
    const extracted = await extractArticle(page);

    if (status === 404 || status === 410) {
      return {
        status: 'NOT_FOUND',
        liveTitle: null,
        liveAuthor: null,
        livePublished: null,
        liveUpdated: null,
        ogImage: null,
        excerpt: null,
        readTime: null,
        resolvedUrl: page.url(),
        errorMessage: `HTTP ${status}`
      };
    }

    if (!response && !extracted.headline) {
      return {
        status: 'FETCH_ERROR',
        liveTitle: null,
        liveAuthor: extracted.author,
        livePublished: extracted.published,
        liveUpdated: extracted.updated,
        ogImage: null,
        excerpt: null,
        readTime: null,
        resolvedUrl: page.url(),
        errorMessage: 'No response received and extraction failed'
      };
    } else if (response && !response.ok()) {
      return {
        status: 'FETCH_ERROR',
        liveTitle: extracted.headline || null,
        liveAuthor: extracted.author,
        livePublished: extracted.published,
        liveUpdated: extracted.updated,
        ogImage: null,
        excerpt: null,
        readTime: null,
        resolvedUrl: page.url(),
        errorMessage: `HTTP ${status}`
      };
    }

    if (!extracted.headline) {
      return {
        status: 'FETCH_ERROR',
        liveTitle: null,
        liveAuthor: extracted.author,
        livePublished: extracted.published,
        liveUpdated: extracted.updated,
        ogImage: null,
        excerpt: null,
        readTime: null,
        resolvedUrl: page.url(),
        errorMessage: 'Could not extract headline from page'
      };
    }

    // Run QA checks
    const qa = await runQaChecks(page, extracted);
    if (!qa.passed) {
      console.log(`  [QA] ${qa.reason} for ${url}: ${qa.message}`);
      return {
        status: qa.reason,
        liveTitle: null,
        liveAuthor: null,
        livePublished: null,
        liveUpdated: null,
        ogImage: null,
        excerpt: null,
        readTime: null,
        resolvedUrl: page.url(),
        errorMessage: qa.message
      };
    }

    return {
      status: 'OK',
      liveTitle: extracted.headline,
      liveAuthor: extracted.author,
      livePublished: extracted.published,
      liveUpdated: extracted.updated,
      ogImage: extracted.ogImage || null,
      excerpt: extracted.excerpt || null,
      readTime: extracted.readTime || null,
      resolvedUrl: page.url(),
      errorMessage: null
    };
  } catch (error) {
    const message = String(error.message || error);
    const notFound = /404|410|not found/i.test(message);

    return {
      status: notFound ? 'NOT_FOUND' : 'FETCH_ERROR',
      liveTitle: null,
      liveAuthor: null,
      livePublished: null,
      liveUpdated: null,
      ogImage: null,
      excerpt: null,
      readTime: null,
      resolvedUrl: page.url() || url,
      errorMessage: message
    };
  } finally {
    await context.close();
  }
}

module.exports = {
  fetchLiveArticle,
  closeBrowser,
  sleep
};
