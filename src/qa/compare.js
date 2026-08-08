const { distance } = require('fastest-levenshtein');

const STOP_WORDS = new Set([
  'a', 'an', 'the', 'of', 'at', 'in', 'on', 'for', 'to', 'and', 'or', 'but',
  'is', 'are', 'was', 'were', 'be', 'been', 'being', 'by', 'with', 'as',
  'its', 'it', 'that', 'this', 'from', 'have', 'has', 'had', 'will', 'would',
  'could', 'should', 'may', 'might', 'can', 'not', 'no', 'nor', 'so', 'if',
  'than', 'then', 'into', 'over', 'after', 'before', 'about', 'between',
  'through', 'during', 'out', 'up', 'down', 'off'
]);

const TEMPORAL_PATTERN =
  /\b(today|tomorrow|yesterday|tonight|now|soon|monday|tuesday|wednesday|thursday|friday|saturday|sunday|january|february|march|april|may|june|july|august|september|october|november|december)\b/gi;

const SYNONYM_GROUPS = [
  ['abuse', 'assault', 'harassment', 'molestation', 'rape'],
  ['teen', 'teenage', 'teenagers', 'teens'],
  ['woman', 'women', 'female', 'girl', 'girls'],
  ['man', 'men', 'male', 'boy', 'boys'],
  ['say', 'says', 'said', 'tell', 'tells', 'told']
];

const SYNONYMS = new Map();
for (const group of SYNONYM_GROUPS) {
  for (const word of group) {
    SYNONYMS.set(word, new Set(group));
  }
}

function normalizeHeadline(text) {
  return String(text || '')
    .normalize('NFKC')
    .replace(/[\u2018\u2019\u201C\u201D]/g, '"')
    .replace(/\s*&\s*/g, ' and ')
    .replace(/\s*\/\s*/g, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function headlineSimilarity(a, b) {
  const left = normalizeHeadline(a);
  const right = normalizeHeadline(b);

  if (!left && !right) {
    return 1;
  }

  if (!left || !right) {
    return 0;
  }

  if (left === right) {
    return 1;
  }

  const maxLen = Math.max(left.length, right.length);
  const minLen = Math.min(left.length, right.length);
  const dist = distance(left, right);
  let similarity = Math.max(0, 1 - dist / maxLen);

  // One headline is an abbreviated prefix of the other (e.g. live h1 shorter than RSS).
  // Word substitution at the tail (e.g. "today" → "by Wednesday") does not qualify.
  if (minLen >= 20 && (left.startsWith(right) || right.startsWith(left))) {
    similarity = Math.max(similarity, minLen / maxLen);
  }

  return similarity;
}

function significantWords(text) {
  return normalizeHeadline(text)
    .split(' ')
    .filter((word) => word.length > 2 && !STOP_WORDS.has(word));
}

function extractTemporalTokens(text) {
  const normalized = normalizeHeadline(text);
  const matches = normalized.match(TEMPORAL_PATTERN) || [];
  return new Set(matches);
}

function extractNumbers(text) {
  const normalized = normalizeHeadline(text);
  const matches = normalized.match(/\b\d+(?:\.\d+)?\b/g) || [];
  return new Set(matches);
}

function wordMatchesRss(word, rssWords) {
  if (rssWords.has(word)) {
    return true;
  }

  const synonyms = SYNONYMS.get(word);
  if (synonyms) {
    for (const synonym of synonyms) {
      if (rssWords.has(synonym)) {
        return true;
      }
    }
  }

  for (const rssWord of rssWords) {
    if (rssWord.length >= 4 && word.length >= 4 && (rssWord.startsWith(word) || word.startsWith(rssWord))) {
      return true;
    }
  }

  return false;
}

function hasTemporalConflict(rssTitle, liveTitle) {
  const rssTemporal = extractTemporalTokens(rssTitle);
  const liveTemporal = extractTemporalTokens(liveTitle);

  if (rssTemporal.size === 0 && liveTemporal.size === 0) {
    return false;
  }

  if (rssTemporal.size > 0 && liveTemporal.size > 0) {
    for (const token of rssTemporal) {
      if (!liveTemporal.has(token)) {
        return true;
      }
    }
    for (const token of liveTemporal) {
      if (!rssTemporal.has(token)) {
        return true;
      }
    }
  }

  for (const token of liveTemporal) {
    if (!rssTemporal.has(token) && rssTemporal.size > 0) {
      return true;
    }
  }

  return false;
}

function hasNumberConflict(rssTitle, liveTitle) {
  const rssNumbers = extractNumbers(rssTitle);
  const liveNumbers = extractNumbers(liveTitle);

  if (rssNumbers.size === 0 && liveNumbers.size === 0) {
    return false;
  }

  if (rssNumbers.size === 0 || liveNumbers.size === 0) {
    return rssNumbers.size > 0 || liveNumbers.size > 0;
  }

  for (const value of rssNumbers) {
    if (!liveNumbers.has(value)) {
      return true;
    }
  }

  for (const value of liveNumbers) {
    if (!rssNumbers.has(value)) {
      return true;
    }
  }

  return false;
}

function classifyDriftSubtype(rssTitle, liveTitle) {
  if (hasTemporalConflict(rssTitle, liveTitle)) {
    return 'CONTENT_CHANGE';
  }

  if (hasNumberConflict(rssTitle, liveTitle)) {
    return 'CONTENT_CHANGE';
  }

  const rssNorm = normalizeHeadline(rssTitle);
  const liveNorm = normalizeHeadline(liveTitle);
  const rssWords = new Set(significantWords(rssTitle));
  const liveWords = significantWords(liveTitle);

  if (liveWords.length === 0) {
    return 'UNCERTAIN';
  }

  const matched = liveWords.filter((word) => wordMatchesRss(word, rssWords)).length;
  const coverage = matched / liveWords.length;
  const isShorter = liveNorm.length <= rssNorm.length * 0.92;
  const isPrefix =
    (rssNorm.startsWith(liveNorm) || liveNorm.startsWith(rssNorm)) &&
    Math.min(liveNorm.length, rssNorm.length) >= 20;

  if ((isShorter || isPrefix) && coverage >= 0.55) {
    return 'STYLE_SHORTENING';
  }

  if (coverage >= 0.5 && liveNorm.length < rssNorm.length) {
    return 'STYLE_SHORTENING';
  }

  return 'UNCERTAIN';
}

function classifyHeadlineComparison(rssTitle, liveTitle, thresholds) {
  const similarity = headlineSimilarity(rssTitle, liveTitle);

  if (similarity >= thresholds.matchThreshold) {
    return { status: 'MATCH', similarity, driftSubtype: null };
  }

  const driftSubtype = classifyDriftSubtype(rssTitle, liveTitle);

  if (similarity >= thresholds.minorEditThreshold) {
    return { status: 'MINOR_EDIT', similarity, driftSubtype };
  }

  return { status: 'MAJOR_EDIT', similarity, driftSubtype };
}

module.exports = {
  normalizeHeadline,
  headlineSimilarity,
  classifyDriftSubtype,
  classifyHeadlineComparison
};
