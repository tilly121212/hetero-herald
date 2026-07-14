// COMMAND: npm run reset
// Wipes the REBUILDABLE cache (season DBs, history.json, players.json) so you can do a
// clean rebuild. Everything it deletes can be regenerated from Sleeper in ~two commands
// (build-history + sync-season).
//
// IMPORTANT: this NEVER deletes retained trade-value data. Those weekly FantasyCalc
// snapshots are irreplaceable — FantasyCalc only serves CURRENT values, so a wiped
// snapshot is gone forever. Any file matching a trade-value pattern is preserved.

import { existsSync, readdirSync, rmSync, statSync } from 'node:fs';
import { createInterface } from 'node:readline';

const CACHE = './data-cache';

// Files/patterns that must be PRESERVED (irreplaceable trade-value history).
const PRESERVE = [
  /trade-?values?/i,      // e.g. trade-values.json, tradeValues-*.json
  /value-?snapshots?/i,   // e.g. value-snapshots.json
  /fantasycalc.*history/i,
  /revisionist-?graded/i, // which trades Revisionist has already covered (graded-once-ever)
  /gradetrade-?graded/i,  // which trades Grade the Trade has already covered (graded-once-ever)
  /controversy-?used/i,   // which reader submissions have already run (single-use takes)
];
const isProtected = (name) => PRESERVE.some(rx => rx.test(name));

function plan() {
  if (!existsSync(CACHE)) return { toDelete: [], preserved: [] };
  const entries = readdirSync(CACHE);
  const toDelete = [], preserved = [];
  for (const name of entries) {
    if (isProtected(name)) preserved.push(name);
    else toDelete.push(name);
  }
  return { toDelete, preserved };
}

function confirm(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(res => rl.question(question, ans => { rl.close(); res(ans.trim().toLowerCase()); }));
}

async function run() {
  const { toDelete, preserved } = plan();

  if (!toDelete.length) {
    console.log('Nothing to reset — the cache is already clean' + (preserved.length ? ` (preserving ${preserved.length} trade-value file(s)).` : '.'));
    return;
  }

  console.log('\nThis will DELETE the following rebuildable cache files:');
  toDelete.forEach(f => console.log('   \u2717 ' + f));
  if (preserved.length) {
    console.log('\nThese trade-value files will be PRESERVED (irreplaceable):');
    preserved.forEach(f => console.log('   \u2713 ' + f));
  }
  console.log('\nAfter reset, rebuild with:  npm run build-history   then   npm run sync-season');

  const ans = await confirm('\nType "y" to confirm the reset (anything else cancels): ');
  if (ans !== 'y' && ans !== 'yes') {
    console.log('Reset cancelled. Nothing was deleted.');
    return;
  }

  let deleted = 0;
  for (const name of toDelete) {
    try {
      const p = `${CACHE}/${name}`;
      rmSync(p, { recursive: statSync(p).isDirectory(), force: true });
      deleted++;
    } catch (e) { console.log(`   (couldn't delete ${name}: ${e.message})`); }
  }
  console.log(`\nReset complete — deleted ${deleted} item(s)${preserved.length ? `, preserved ${preserved.length} trade-value file(s)` : ''}.`);
  console.log('Now run:  npm run build-history   then   npm run sync-season');
}

run().catch(e => { console.error(e); process.exit(1); });
