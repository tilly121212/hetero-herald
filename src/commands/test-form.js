// COMMAND: npm run test-form -- --csv "https://docs.google.com/.../pub?output=csv"
//          npm run test-form            (uses SUBMISSIONS_CSV env var)
//          npm run test-form -- --week 5 --since-days 7
//
// Verifies the Google Form -> Sheet -> CSV pipeline works BEFORE you rely on it.
// Shows: can it reach the CSV? how many submissions? which are in this week's
// window? which one would be featured? It never writes anything — safe to run
// anytime to sanity-check that league submissions are flowing.

import { fetchSubmissions, pickSubmission, planControversy } from '../lib/controversy.js';

function args(){
  const a = process.argv.slice(2); const o = { csv:process.env.SUBMISSIONS_CSV||'', week:null, sinceDays:7 };
  for(let i=0;i<a.length;i++){
    if(a[i]==='--csv') o.csv=a[++i];
    else if(a[i]==='--week') o.week=+a[++i];
    else if(a[i]==='--since-days') o.sinceDays=+a[++i];
  }
  return o;
}

async function run(){
  const o = args();
  console.log('\n=== HERALD · Form Submission Test ===\n');

  if(!o.csv){
    console.log('✗ No CSV URL provided.');
    console.log('  Pass one with:  npm run test-form -- --csv "YOUR_PUBLISHED_CSV_URL"');
    console.log('  Or set the SUBMISSIONS_CSV environment variable.\n');
    console.log('  Where to get the URL: in your responses Google Sheet →');
    console.log('  File → Share → Publish to web → (responses tab) → CSV → Publish.\n');
    process.exit(1);
  }

  console.log('Fetching:', o.csv.slice(0, 70) + (o.csv.length>70?'...':''));
  const sinceMs = Date.now() - o.sinceDays*864e5;

  let all;
  try {
    all = await fetchSubmissions(o.csv, {}); // no window: see everything
  } catch(e){
    console.log('\n✗ Could not read the CSV:', e.message);
    console.log('  Check that the sheet is Published to web as CSV (not just shared).\n');
    process.exit(1);
  }

  console.log(`\n✓ CSV reachable. Total valid submissions found: ${all.length}\n`);
  if(all.length === 0){
    console.log('  (No submissions yet — the form works, nobody has written in.)');
    console.log('  The paper will MANUFACTURE controversy this week. That is expected.\n');
    return;
  }

  // show all, marking which are in this week's window
  console.log('All submissions:');
  all.forEach((s,i)=>{
    const fresh = s.tsMs >= sinceMs;
    console.log(`  ${i+1}. [${fresh?'THIS WEEK':'  older  '}] ${s.name}: "${s.take.slice(0,60)}${s.take.length>60?'...':''}"`);
    if(s.week) console.log(`         (tagged week: ${s.week})`);
  });

  // now the windowed set the generator would actually use
  const scoped = await fetchSubmissions(o.csv, { sinceMs, weekTag:o.week });
  console.log(`\nIn this week's window (last ${o.sinceDays} days${o.week?`, week ${o.week}`:''}): ${scoped.length}`);

  const plan = planControversy(scoped, { biggestBlowout:{margin:40} }, { season:'2025', week:o.week||1 });
  if(plan.mode === 'submitted'){
    console.log('\n✓ Controversy Corner WOULD FEATURE:');
    console.log(`   "${plan.submission.take}"`);
    console.log(`   — ${plan.submission.name}`);
    console.log('\n  (One picked at random from the window. Re-runs pick the same one per week.)');
  } else {
    console.log('\n→ No fresh submissions in window. Controversy Corner would INVENT drama instead.');
    console.log('  (This is the correct fallback behavior.)');
  }
  console.log('\n=== test complete ===\n');
}

run().catch(e=>{ console.error(e); process.exit(1); });
