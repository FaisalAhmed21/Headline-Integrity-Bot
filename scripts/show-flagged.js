const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');
const { headlineSimilarity, classifyHeadlineComparison } = require('../src/qa/compare');
const { defaults } = require('../src/config');

async function main() {
  const SQL = await initSqlJs({
    locateFile: (fileName) => path.join(process.cwd(), 'node_modules', 'sql.js', 'dist', fileName)
  });
  const db = new SQL.Database(fs.readFileSync('data/headlines.sqlite'));

  const result = db.exec(`
    SELECT source_name, status, rss_title, live_title, similarity, run_at
    FROM headline_checks
    WHERE status IN ('MAJOR_EDIT', 'MINOR_EDIT')
    ORDER BY id DESC
    LIMIT 20
  `);

  if (!result.length) {
    console.log('No flagged results found.');
    return;
  }

  const sourcesWanted = new Set(['Dhaka Tribune', 'BBC News', 'BBC Sport']);
  const rows = result[0].values.filter(([sourceName]) => sourcesWanted.has(sourceName));

  // Keep most recent per source
  const latest = new Map();
  for (const row of rows) {
    const [sourceName] = row;
    if (!latest.has(sourceName)) {
      latest.set(sourceName, row);
    }
  }

  console.log('=== MAJOR_EDIT / MINOR_EDIT: RSS vs Live ===\n');

  for (const [sourceName, row] of latest) {
    const [, status, rssTitle, liveTitle, similarity] = row;
    const recalc = headlineSimilarity(rssTitle, liveTitle);
    const classified = classifyHeadlineComparison(rssTitle, liveTitle, {
      matchThreshold: defaults.matchThreshold,
      minorEditThreshold: defaults.minorEditThreshold
    });

    console.log(`--- ${sourceName} (stored: ${status}, now: ${classified.status}) ---`);
    console.log(`RSS title:   "${rssTitle}"`);
    console.log(`Live title:  "${liveTitle}"`);
    console.log(`Similarity:  ${recalc} (was ${similarity ?? 'n/a'} in last DB run)`);
    console.log('');
  }
}

main();
