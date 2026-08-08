const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');
const { classifyHeadlineComparison } = require('../src/qa/compare');
const { defaults } = require('../src/config');

async function main() {
  const SQL = await initSqlJs({
    locateFile: (fileName) => path.join(process.cwd(), 'node_modules', 'sql.js', 'dist', fileName)
  });
  const db = new SQL.Database(fs.readFileSync('data/headlines.sqlite'));

  const result = db.exec(`
    SELECT source_name, status, rss_title, live_title, similarity
    FROM headline_checks
    WHERE status IN ('MAJOR_EDIT', 'MINOR_EDIT')
      AND live_title IS NOT NULL
      AND live_title != 'Google News'
      AND source_name IN ('Dhaka Tribune', 'BBC News', 'BBC Sport')
    ORDER BY source_name, id DESC
  `);

  if (!result.length) {
    console.log('No test rows found.');
    return;
  }

  const cols = result[0].columns;
  const rows = result[0].values.map((v) => Object.fromEntries(v.map((x, i) => [cols[i], x])));

  const seen = new Set();
  const thresholds = {
    matchThreshold: defaults.matchThreshold,
    minorEditThreshold: defaults.minorEditThreshold
  };

  console.log('=== Drift sub-classification test (latest per source/article) ===\n');

  let allPass = true;

  for (const row of rows) {
    const key = `${row.source_name}::${row.rss_title}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);

    const classified = classifyHeadlineComparison(row.rss_title, row.live_title, thresholds);
    const expected =
      row.source_name === 'Dhaka Tribune' ? 'CONTENT_CHANGE' : 'STYLE_SHORTENING';
    const pass = classified.driftSubtype === expected;
    allPass = allPass && pass;

    console.log(`${pass ? 'PASS' : 'FAIL'} | ${row.source_name} (expected ${expected}, got ${classified.driftSubtype})`);
    console.log(`  status: ${classified.status} | similarity: ${classified.similarity}`);
    console.log(`  RSS:  "${row.rss_title}"`);
    console.log(`  Live: "${row.live_title}"`);
    console.log('');
  }

  console.log(allPass ? 'All targeted cases classified correctly.' : 'Some cases misclassified — review heuristic.');
}

main();
