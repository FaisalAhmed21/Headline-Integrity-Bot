const fs = require('fs');
const path = require('path');
const initSqlJs = require('sql.js');

const schema = `
  CREATE TABLE IF NOT EXISTS check_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_at TEXT NOT NULL,
    sources_checked INTEGER NOT NULL DEFAULT 0,
    items_checked INTEGER NOT NULL DEFAULT 0,
    flagged_count INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS headline_checks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_at TEXT NOT NULL,
    source_id TEXT NOT NULL,
    source_name TEXT NOT NULL,
    item_link TEXT NOT NULL,
    resolved_url TEXT,
    rss_title TEXT NOT NULL,
    live_title TEXT,
    live_author TEXT,
    live_published TEXT,
    live_updated TEXT,
    status TEXT NOT NULL,
    similarity REAL,
    drift_subtype TEXT,
    error_message TEXT,
    rss_published_at TEXT
  );

  CREATE TABLE IF NOT EXISTS headline_history (
    source_id TEXT NOT NULL,
    item_link TEXT NOT NULL,
    rss_title TEXT NOT NULL,
    live_title TEXT,
    first_seen_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL,
    last_status TEXT NOT NULL,
    last_similarity REAL,
    PRIMARY KEY (source_id, item_link)
  );

  CREATE TABLE IF NOT EXISTS drift_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_id TEXT NOT NULL,
    item_link TEXT NOT NULL,
    previous_live_title TEXT,
    current_live_title TEXT NOT NULL,
    previous_rss_title TEXT,
    current_rss_title TEXT NOT NULL,
    seen_at TEXT NOT NULL,
    drift_type TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_headline_checks_run_at ON headline_checks(run_at);
  CREATE INDEX IF NOT EXISTS idx_headline_checks_source ON headline_checks(source_id, item_link);

  CREATE TABLE IF NOT EXISTS sent_articles (
    url TEXT PRIMARY KEY,
    published_at TEXT
  );
`;

async function openDatabase(dbPath) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  const SQL = await initSqlJs({
    locateFile: (fileName) => path.join(process.cwd(), 'node_modules', 'sql.js', 'dist', fileName)
  });

  let database;
  if (fs.existsSync(dbPath)) {
    database = new SQL.Database(fs.readFileSync(dbPath));
  } else {
    database = new SQL.Database();
  }

  database.exec(schema);
  migrateSchema(database);

  return {
    database,
    save() {
      fs.writeFileSync(dbPath, Buffer.from(database.export()));
    },
    close() {
      database.close();
    }
  };
}

function runQuery(database, sql, params = []) {
  const statement = database.prepare(sql);
  statement.bind(params);
  const rows = [];

  while (statement.step()) {
    rows.push(statement.getAsObject());
  }

  statement.free();
  return rows;
}

function runExec(database, sql, params = []) {
  const statement = database.prepare(sql);
  statement.run(params);
  statement.free();
}

function tableColumns(database, tableName) {
  return runQuery(database, `PRAGMA table_info(${tableName})`).map((row) => row.name);
}

function migrateSchema(database) {
  const headlineColumns = tableColumns(database, 'headline_checks');
  if (headlineColumns.length > 0 && !headlineColumns.includes('drift_subtype')) {
    database.exec('ALTER TABLE headline_checks ADD COLUMN drift_subtype TEXT');
  }

  const driftColumns = tableColumns(database, 'drift_events');

  if (driftColumns.length > 0 && !driftColumns.includes('previous_live_title')) {
    database.exec(`
      ALTER TABLE drift_events RENAME TO drift_events_legacy;
      CREATE TABLE drift_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source_id TEXT NOT NULL,
        item_link TEXT NOT NULL,
        previous_live_title TEXT,
        current_live_title TEXT NOT NULL,
        previous_rss_title TEXT,
        current_rss_title TEXT NOT NULL,
        seen_at TEXT NOT NULL,
        drift_type TEXT NOT NULL
      );
    `);
  }
}

function recordCheckRun(handle, summary) {
  runExec(
    handle.database,
    `INSERT INTO check_runs (run_at, sources_checked, items_checked, flagged_count)
     VALUES (?, ?, ?, ?)`,
    [summary.runAt, summary.sourcesChecked, summary.itemsChecked, summary.flaggedCount]
  );
}

function recordHeadlineCheck(handle, entry) {
  runExec(
    handle.database,
    `INSERT INTO headline_checks (
      run_at, source_id, source_name, item_link, resolved_url,
      rss_title, live_title, live_author, live_published, live_updated,
      status, similarity, drift_subtype, error_message, rss_published_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      entry.runAt,
      entry.sourceId,
      entry.sourceName,
      entry.itemLink,
      entry.resolvedUrl || null,
      entry.rssTitle,
      entry.liveTitle || null,
      entry.liveAuthor || null,
      entry.livePublished || null,
      entry.liveUpdated || null,
      entry.status,
      entry.similarity ?? null,
      entry.driftSubtype || null,
      entry.errorMessage || null,
      entry.rssPublishedAt || null
    ]
  );

  const existing = runQuery(
    handle.database,
    'SELECT * FROM headline_history WHERE source_id = ? AND item_link = ?',
    [entry.sourceId, entry.itemLink]
  )[0];

  if (!existing) {
    runExec(
      handle.database,
      `INSERT INTO headline_history (
        source_id, item_link, rss_title, live_title,
        first_seen_at, last_seen_at, last_status, last_similarity
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        entry.sourceId,
        entry.itemLink,
        entry.rssTitle,
        entry.liveTitle || null,
        entry.runAt,
        entry.runAt,
        entry.status,
        entry.similarity ?? null
      ]
    );
    return { drift: null };
  }

  const liveDrift =
    entry.liveTitle &&
    existing.live_title &&
    entry.liveTitle !== existing.live_title &&
    entry.status !== 'FETCH_ERROR';

  const rssDrift = entry.rssTitle !== existing.rss_title;

  if (liveDrift) {
    runExec(
      handle.database,
      `INSERT INTO drift_events (
        source_id, item_link, previous_live_title, current_live_title,
        previous_rss_title, current_rss_title, seen_at, drift_type
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        entry.sourceId,
        entry.itemLink,
        existing.live_title,
        entry.liveTitle,
        existing.rss_title,
        entry.rssTitle,
        entry.runAt,
        'live_headline_change'
      ]
    );
  } else if (rssDrift) {
    runExec(
      handle.database,
      `INSERT INTO drift_events (
        source_id, item_link, previous_live_title, current_live_title,
        previous_rss_title, current_rss_title, seen_at, drift_type
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        entry.sourceId,
        entry.itemLink,
        existing.live_title || null,
        entry.liveTitle || existing.live_title || null,
        existing.rss_title,
        entry.rssTitle,
        entry.runAt,
        'rss_title_change'
      ]
    );
  }

  runExec(
    handle.database,
    `UPDATE headline_history
     SET rss_title = ?, live_title = COALESCE(?, live_title), last_seen_at = ?,
         last_status = ?, last_similarity = ?
     WHERE source_id = ? AND item_link = ?`,
    [
      entry.rssTitle,
      entry.liveTitle || null,
      entry.runAt,
      entry.status,
      entry.similarity ?? null,
      entry.sourceId,
      entry.itemLink
    ]
  );

  return {
    drift: liveDrift
      ? { type: 'live_headline_change', previousTitle: existing.live_title }
      : rssDrift
        ? { type: 'rss_title_change', previousTitle: existing.rss_title }
        : null
  };
}

function hasArticleBeenSent(handle, url) {
  const result = runQuery(
    handle.database,
    'SELECT 1 FROM sent_articles WHERE url = ?',
    [url]
  );
  return result.length > 0;
}

function recordArticleSent(handle, url, publishedAt) {
  runExec(
    handle.database,
    'INSERT OR IGNORE INTO sent_articles (url, published_at) VALUES (?, ?)',
    [url, publishedAt || new Date().toISOString()]
  );
}

module.exports = {
  openDatabase,
  recordCheckRun,
  recordHeadlineCheck,
  hasArticleBeenSent,
  recordArticleSent
};
