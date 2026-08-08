function esc(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function bold(text) { return `<b>${text}</b>`; }
function italic(text) { return `<i>${text}</i>`; }
function code(text) { return `<code>${esc(text)}</code>`; }

function truncate(text, max = 160) {
  const value = String(text || '');
  return value.length <= max ? value : `${value.slice(0, max - 1)}\u2026`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Returns the time-of-day bulletin label based on Bangladesh Standard Time (UTC+6).
 */
function getBulletinLabel(date) {
  const bstHour = (date.getUTCHours() + 6) % 24;
  if (bstHour >= 5 && bstHour < 12) return { emoji: '\uD83C\uDF05', label: 'Morning Bulletin' };
  if (bstHour >= 12 && bstHour < 16) return { emoji: '\u2600\uFE0F', label: 'Noon Bulletin' };
  if (bstHour >= 16 && bstHour < 21) return { emoji: '\uD83C\uDF07', label: 'Evening Bulletin' };
  return { emoji: '\uD83C\uDF19', label: 'Night Bulletin' };
}

/**
 * Builds the QA line for the Telegram card based on real drift comparison results.
 * Never silently defaults — UNAVAILABLE is shown explicitly.
 */
function buildQaLine(item) {
  const { driftStatus, driftSubtype, rssTitle } = item;

  if (!driftStatus || driftStatus === 'UNAVAILABLE') {
    return '\uD83D\uDD0E <i>QA: drift check unavailable</i>';
  }

  if (driftStatus === 'MATCH') {
    return '\uD83D\uDD0E QA: \u2705 Matches RSS claim';
  }

  const subtypeLabel = driftSubtype ? ` (${driftSubtype.replace(/_/g, ' ').toLowerCase()})` : '';

  if (driftStatus === 'MINOR_EDIT') {
    const rssSnippet = rssTitle ? esc(truncate(rssTitle, 120)) : '(no RSS title)';
    return `\uD83D\uDD0E QA: \u26A0\uFE0F Minor edit detected${subtypeLabel}\n<i>RSS said: \u201C${rssSnippet}\u201D</i>`;
  }

  if (driftStatus === 'MAJOR_EDIT') {
    const rssSnippet = rssTitle ? esc(truncate(rssTitle, 120)) : '(no RSS title)';
    return `\uD83D\uDD0E QA: \uD83D\uDEA8 Major edit detected${subtypeLabel}\n<i>RSS said: \u201C${rssSnippet}\u201D</i>`;
  }

  if (driftStatus === 'NOT_FOUND') {
    return '\uD83D\uDD0E QA: \u26A0\uFE0F Article not found at claimed URL';
  }

  if (driftStatus === 'FETCH_ERROR') {
    return '\uD83D\uDD0E QA: \u26A0\uFE0F Playwright failed to load the page (timeout, network error, or block)';
  }

  return `\uD83D\uDD0E <i>QA: ${esc(driftStatus)}</i>`;
}

function buildPhotoCaption(item) {
  const readTimeStr = item.readTime ? ` \u23F1\uFE0F ${item.readTime} min read` : '';

  const lines = [
    `\uD83D\uDCF0 <b>${esc(item.sourceName)}</b>${readTimeStr}`,
    '',
    `<b>${esc(truncate(item.liveTitle || item.rssTitle, 200))}</b>`,
    '',
    buildQaLine(item)
  ];

  if (item.excerpt) {
    lines.push('', esc(item.excerpt));
  }

  return truncate(lines.join('\n'), 1020);
}

function buildTextCard(item) {
  return buildPhotoCaption(item);
}

async function sendTelegramPhoto(botToken, chatId, photoUrl, caption, articleUrl, silent = false) {
  const body = {
    chat_id: chatId,
    photo: photoUrl,
    caption: caption,
    parse_mode: 'HTML',
    disable_notification: silent,
    reply_markup: { inline_keyboard: [[{ text: '\uD83D\uDD17 Read Article', url: articleUrl }]] }
  };

  const response = await fetch(`https://api.telegram.org/bot${botToken}/sendPhoto`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Telegram sendPhoto failed: ${response.status} ${response.statusText} ${text}`);
  }

  return JSON.parse(text);
}

async function _sendMessageRaw(botToken, chatId, text, articleUrl, silent = false) {
  const body = {
    chat_id: chatId,
    text: truncate(text, 3900),
    parse_mode: 'HTML',
    disable_web_page_preview: true,
    disable_notification: silent
  };

  if (articleUrl) {
    body.reply_markup = { inline_keyboard: [[{ text: '\uD83D\uDD17 Read Article', url: articleUrl }]] };
  }

  const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });

  const textResp = await response.text();
  if (!response.ok) {
    throw new Error(`Telegram sendMessage failed: ${response.status} ${response.statusText} ${textResp}`);
  }
  return JSON.parse(textResp);
}

/**
 * Sends the Bulletin Header message WITH full notification (the one ping).
 */
async function sendBulletinHeader(botToken, chatId, newItems, runAt) {
  if (!botToken || !chatId) return { skipped: true };

  const { emoji, label } = getBulletinLabel(new Date(runAt));
  const total = newItems.length;

  const counts = {};
  for (const item of newItems) {
    counts[item.sourceName] = (counts[item.sourceName] || 0) + 1;
  }
  const sourceLines = Object.entries(counts)
    .map(([name, n]) => `  \u2022 ${esc(name)} \u2014 ${n} article${n > 1 ? 's' : ''}`)
    .join('\n');

  const bstDate = new Date(new Date(runAt).getTime() + 6 * 60 * 60 * 1000);
  const timeStr = bstDate.toUTCString().replace(/.*(\d{2}:\d{2}:\d{2}).*/, '$1') + ' BST';

  const text = `${emoji} <b>${label}</b>\n${italic(timeStr)}\n\n${bold(`${total} new article${total !== 1 ? 's' : ''}`)}\n${sourceLines}`;

  const result = await _sendMessageRaw(botToken, chatId, text, null, false);
  console.log(`[telegram] Bulletin header sent: ${label} (${total} articles)`);
  return result;
}

async function sendNewsCards(botToken, chatId, newItems) {
  if (!botToken || !chatId) return { skipped: true, reason: 'BOT_TOKEN or CHAT_ID not configured' };

  const results = [];
  for (const item of newItems) {
    const articleUrl = item.link || '';
    let result;

    if (item.ogImage) {
      try {
        const caption = buildPhotoCaption(item);
        result = await sendTelegramPhoto(botToken, chatId, item.ogImage, caption, articleUrl, true);
        result._deliveryMethod = 'sendPhoto';
        console.log(`[telegram] sendPhoto (silent) success for ${articleUrl}`);
      } catch (photoErr) {
        console.warn(`[telegram] sendPhoto failed for ${articleUrl}: ${photoErr.message} \u2014 falling back to text`);
        const text = buildTextCard(item);
        result = await _sendMessageRaw(botToken, chatId, text, articleUrl, true);
        result._deliveryMethod = 'sendMessage (photo-fallback)';
        console.log(`[telegram] sendMessage (silent fallback) success for ${articleUrl}`);
      }
    } else {
      const text = buildTextCard(item);
      result = await _sendMessageRaw(botToken, chatId, text, articleUrl, true);
      result._deliveryMethod = 'sendMessage (no-image)';
      console.log(`[telegram] sendMessage (silent no-image) success for ${articleUrl}`);
    }

    results.push(result);
    await sleep(1500);
  }
  return results;
}

function buildRunFailureMessage(runAt, errorMessage) {
  const runDate = new Date(runAt);
  const dateStr = runDate.toUTCString().replace(' GMT', ' UTC');
  return `\uD83D\uDCA5 ${bold('News Bot \u2014 RUN FAILED')}\n${italic(esc(dateStr))}\n\n${bold('Error:')} ${code(truncate(errorMessage, 400))}`;
}

async function sendFailureMessage(botToken, chatId, message) {
  return _sendMessageRaw(botToken, chatId, message, null, false);
}

module.exports = {
  sendBulletinHeader,
  sendNewsCards,
  sendFailureMessage,
  buildRunFailureMessage
};
