// R113 categorization pass — analyze remaining FAIL cases and re-tag with
// more specific ai_status/ai_reason so user can triage:
//   - web_not_supported: M cases stuck at "Real Map Available Build with EAS"
//   - needs_seeded_data: V/D showing "No hikes yet" / "Cairn not found"
//   - needs_real_gps: cases requiring GPS movement beyond stationary injection
//   - stale_test: cases whose expect describes UI that no longer exists (e.g. AR)
//   - needs_deep_interaction: multi-tap flows the runner can't automate cheaply

const fs = require('fs');
const DATA_JSON = 'C:/ClaudeCodeProjects/Cairn/docs/feature-map/flows/data.json';

const CATEGORIES = [
  {
    tag: 'web_not_supported',
    label: 'Web build cannot render — needs real iOS device',
    match: (row) => {
      const reason = row.ai_reason || '';
      // M cases stuck on placeholder text
      if (reason.includes('Real Map Available')) return true;
      if (reason.includes('Build with EAS to enable Mapbox')) return true;
      if (reason.includes('Real Map (EAS Build)')) return true;
      return false;
    },
  },
  {
    tag: 'needs_seeded_data',
    label: 'Case expects existing hikes/marks/friends — test user has none',
    match: (row) => {
      const reason = row.ai_reason || '';
      const body = reason;
      // V cases: "No hikes yet / Start hiking"
      if (body.includes('No hikes yet')) return true;
      // D cases: "Cairn not found"
      if (body.includes('Cairn not found')) return true;
      // F case F10: expected friend "Alice" but body shows empty state
      if (body.includes('Cairn is better with trail companions') && body.includes('Alice')) return true;
      return false;
    },
  },
  {
    tag: 'plant_flow_wall',
    label: 'Plant flow stuck at "Where\'s your cairn?" step — needs Confirm+form interaction',
    match: (row) => {
      const reason = row.ai_reason || '';
      return row.id.startsWith('C') && reason.includes("Where's your cairn?");
    },
  },
  {
    tag: 'stale_test_case',
    label: 'Test case describes UI that no longer exists in current app',
    match: (row) => {
      // A tab is intentionally cut (AR 暂不做)
      if (row.id.startsWith('A')) return true;
      return false;
    },
  },
  {
    tag: 'expects_chinese_but_app_english',
    label: 'Case expects Chinese text but app UI is English',
    match: (row) => {
      const tokens = extractExpectedTokens(row.expect);
      // If more than half of tokens are pure Chinese, flag
      const chinese = tokens.filter(t => /^[\u4e00-\u9fa5\s,.!?:;()"\u2014\u2013]{2,}$/.test(t));
      return chinese.length > 0 && chinese.length >= Math.ceil(tokens.length * 0.5);
    },
  },
  {
    tag: 'needs_deep_interaction',
    label: 'Case needs multi-step user interaction runner cannot automate cheaply',
    match: (row) => {
      // Fallback for K/R hike/run in-progress states, S sub-screens, L verification code entry
      const reason = row.ai_reason || '';
      if (row.id.startsWith('K') || row.id.startsWith('R')) {
        if (reason.includes('Free Run') || reason.includes('Enable GPS')) return true;
      }
      if (row.id.startsWith('S') && reason.includes('Edit name')) return true;
      if (row.id.startsWith('L') && (reason.includes('Verify Email') || reason.includes('Verification'))) return true;
      return false;
    },
  },
];

function extractExpectedTokens(expect) {
  const tokens = [];
  const patterns = [
    /\u201c([^\u201c\u201d]{2,80})\u201d/g,
    /\u2018([^\u2018\u2019]{2,80})\u2019/g,
    /"([^"]{2,80})"/g,
    /'([^']{2,80})'/g,
  ];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(expect || '')) !== null) tokens.push(m[1].trim());
  }
  return tokens;
}

const data = JSON.parse(fs.readFileSync(DATA_JSON, 'utf8'));

const counts = {};
let reCategorized = 0;
for (const screen of data.screens) {
  for (const row of screen.rows) {
    if (row.ai_status !== 'fail') continue;
    for (const cat of CATEGORIES) {
      if (cat.match(row)) {
        row.ai_status = 'needs_manual';
        row.ai_reason = `[${cat.tag}] ${cat.label}. Original: ${(row.ai_reason || '').slice(0, 200)}`;
        counts[cat.tag] = (counts[cat.tag] || 0) + 1;
        reCategorized++;
        break;
      }
    }
  }
}

fs.writeFileSync(DATA_JSON, JSON.stringify(data, null, 2));

console.log(`Re-categorized ${reCategorized} fail cases:`);
for (const [tag, n] of Object.entries(counts)) {
  console.log(`  ${tag}: ${n}`);
}

const totals = { pass: 0, fail: 0, needs_manual: 0, untested: 0 };
for (const s of data.screens) for (const r of s.rows) {
  totals[r.ai_status || 'untested'] = (totals[r.ai_status || 'untested'] || 0) + 1;
}
console.log('\nFinal totals:', JSON.stringify(totals, null, 2));
