const { GoogleDecoder } = require('google-news-url-decoder');

const decoder = new GoogleDecoder();

function isGoogleNewsUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.hostname === 'news.google.com' && parsed.pathname.includes('/articles/');
  } catch {
    return false;
  }
}

function canonicalizePublisherUrl(url) {
  try {
    const parsed = new URL(url);
    if (parsed.pathname.includes('/amp/')) {
      parsed.pathname = parsed.pathname.replace('/amp/', '/');
    }
    return parsed.toString();
  } catch {
    return url;
  }
}

/**
 * Returns true when a resolved URL is a non-article page that should be skipped
 * (topic/tag indexes, category pages, bare root domains, etc.).
 *
 * @param {string} resolvedUrl - The URL after Google News decoding.
 * @param {object} source      - The source config entry from config.js.
 * @returns {boolean}
 */
function isNonArticleUrl(resolvedUrl, source) {
  if (!resolvedUrl) return false;

  let parsed;
  try {
    parsed = new URL(resolvedUrl);
  } catch {
    return false;
  }

  // Bare root domain — path is '/' or empty, with no meaningful article segment.
  const pathIsRoot = parsed.pathname === '/' || parsed.pathname === '';
  if (pathIsRoot) return true;

  // Source-specific pattern list declared in config (regex strings).
  if (source && Array.isArray(source.nonArticlePatterns)) {
    for (const pattern of source.nonArticlePatterns) {
      if (new RegExp(pattern, 'i').test(resolvedUrl)) {
        return true;
      }
    }
  }

  return false;
}

async function resolveArticleUrl(url) {
  if (!isGoogleNewsUrl(url)) {
    return { url: canonicalizePublisherUrl(url), resolvedVia: null, error: null };
  }

  try {
    const result = await decoder.decode(url);
    if (result.status && result.decoded_url) {
      return {
        url: canonicalizePublisherUrl(result.decoded_url),
        resolvedVia: 'google-news-decoder',
        error: null
      };
    }

    return {
      url,
      resolvedVia: null,
      error: result.message || 'Google News URL decode failed'
    };
  } catch (error) {
    return {
      url,
      resolvedVia: null,
      error: String(error.message || error)
    };
  }
}

module.exports = {
  isGoogleNewsUrl,
  isNonArticleUrl,
  resolveArticleUrl,
  canonicalizePublisherUrl
};
