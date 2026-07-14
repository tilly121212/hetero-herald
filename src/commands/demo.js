// COMMAND: npm run demo -- --week 6
//          npm run demo -- --review
//          npm run demo -- --week 1 --images ./images --form https://forms.gle/xxx
//
// Generates a full demo issue WITHOUT needing live APIs. Uses the real 2025 data
// baked in where it exists; invents plausible data for anything missing so EVERY
// section fills. This is your "is the paper working?" button.

import { broadsheetTemplate } from '../render/template.js';
import { buildIdentity } from '../lib/identity.js';
import { pickImages } from '../lib/images.js';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';

// ---- real 2025 league identity (from the data you provided) ----
const OWNERS = [
  ['864641755818123264','The Flamboyant Commish'],['995484661767995392','Golf Fag'],
  ['569698151514042368','Arizona Queer'],['864697124502278144','Reigning Defending King 💩'],
  ['863137302027800576','Top3prediction'],['864946666447425536','Chase down Ass up'],
  ['863914764680704000','Egbuka Matata'],['1000144324413304832','MAHOMES & MAAUTO'],
  ['1093665332700471296','Lil Azz Boyz'],['864723492489297920','Solid team, but I’m gay.'],
  ['862579569788575744','Im not gay anymore'],['458772086781898752','Bear and Twink Law Firm'],
  ['726642056419704832','LGBTQ Fan- that’s gay'],['446192431474405376','Merry Men'],
];
const users   = OWNERS.map(([id,n]) => ({ user_id:id, metadata:{ team_name:n } }));
const rosters = OWNERS.map(([id],i) => ({ roster_id:i+1, owner_id:id }));
const identity = buildIdentity(users, rosters, { name:'Hetero Heroes', season:'2025' });
const NAMES = OWNERS.map(([,n]) => n);

// ---- tiny deterministic RNG so a given week always demos the same ----
function rng(seed){let a=0;for(const c of seed)a=(a*31+c.charCodeAt(0))>>>0;return()=>{a=(a*1664525+1013904223)>>>0;return a/4294967296;};}

// ---- invent a plausible week of scores (fills sections when no real data) ----
function inventWeek(week){
  const r = rng('wk'+week);
  const scored = NAMES.map((name,i)=>({ rid:i+1, name, pts:+(70+r()*110).toFixed(2) }))
    .sort((a,b)=>b.pts-a.pts);
  // pair them into 7 games (1v2,3v4,...) just for demo shape
  const games=[];
  for(let i=0;i<scored.length;i+=2){
    const [a,b]=[scored[i],scored[i+1]];
    const [w,l]=a.pts>=b.pts?[a,b]:[b,a];
    games.push({winner:w.rid,loser:l.rid,winnerPts:w.pts,loserPts:l.pts,margin:+(w.pts-l.pts).toFixed(1),
      winnerName:w.name,loserName:l.name});
  }
  return { scored, games, top:scored[0], bottom:scored[scored.length-1],
    closest:[...games].sort((a,b)=>a.margin-b.margin)[0],
    blowout:[...games].sort((a,b)=>b.margin-a.margin)[0] };
}

// ---- build the section content object the template expects ----
function buildSections({ week, review, formLink }){
  if (review) return reviewSections();
  const W = inventWeek(week);
  const gow = W.closest; // closest game = game of the week for demo
  const ups = W.blowout;

  const rankLine = (r,i)=>{
    const arrow = i<4?' ▲':(i>9?' ▼':' —');
    const red = i===13?' style="color:#8a2018"':'';
    return `<p${red}><b>${i+1}. ${r.name}${arrow}</b> — ${['A statement.','Quietly lethal.','Buyer beware.','Overrated, discuss.','Fine. Just fine.','Frisky.','Living dangerously.','On the bubble.','Needs help.','Trending down.','Concerning.','Dire.','A mess.','See obituary.'][i]||'—'} (${r.pts})</p>`;
  };

  return {
    lead:{
      edition:`Week ${week}`, kicker:'Game of the Week · Photo Finish',
      hed:`${gow.winnerName} Survives ${gow.loserName} by ${gow.margin}`,
      dek:`The week's tightest game came down to the wire, while ${W.top.name} posted a league-high ${W.top.pts} and ${W.bottom.name} bottomed out at ${W.bottom.pts}.`,
      bodyHtml:`<p class="drop">In a week that promised little and delivered less for most of you, ${gow.winnerName} and ${gow.loserName} at least had the decency to make it close. ${gow.margin} points was the difference.</p><p>${W.top.name} led all scorers with ${W.top.pts}. At the other end, ${W.bottom.name} managed just ${W.bottom.pts} — a number this paper will not dignify with analysis.</p><p>The rest of the slate unfolded predictably, which is to say cruelly. Full accounting below.</p>`,
      pull:`Somebody scored ${W.top.pts} and somebody scored ${W.bottom.pts}. That gap is the whole story of this league.`,
      quotes:[{quote:`Put ${W.top.pts} on the board and they still act surprised. Stay mad.`,attribution:W.top.name}],
      sideBoxHtml:`<div class="box"><div class="box-h">Final · Game of the Week</div><div class="stat-line"><span>${gow.winnerName}</span><b>${gow.winnerPts}</b></div><div class="stat-line"><span>${gow.loserName}</span><b>${gow.loserPts}</b></div><div class="stat-line" style="border:none;margin-top:6px"><span>Margin</span><b>${gow.margin}</b></div></div><div class="box"><div class="box-h">Weather · Week ${week}</div><p><b>High:</b> ${W.top.pts}.</p><p><b>Low:</b> ${W.bottom.pts}, cellar advisory.</p><p><b>Spread:</b> ${(W.top.pts-W.bottom.pts).toFixed(1)} pts.</p></div>`,
    },
    controversy:{ mode:'invented', tag:'Manufactured Outrage',
      bodyHtml:`<p class="drop">No letters again, so the Herald will supply the paranoia. How, exactly, did ${W.bottom.name} score a suspiciously precise ${W.bottom.pts}? This reporter has a theory and no evidence.</p><p>A source who cannot be named, reached, or confirmed to exist suggests ${W.bottom.name} is tanking for draft position via an elaborate scheme involving a benched star, a burner phone, and a betting syndicate that allegedly operates out of the league chat with read-receipts disabled. Meanwhile ${W.top.name}'s ${W.top.pts} is, frankly, TOO good — the kind of number a man posts when the fix is in.</p><p>We are just asking questions. We demand a special prosecutor, a forensic audit of every waiver claim, and a commissioner who is not personally implicated. None of this will happen. Print it anyway.</p>`,
      backPageCaption:`That's Week ${week}. The scores are final, the excuses eternal.` },
    rivalry:{ tag:'Multi-Year · The Long Memory',
      bodyHtml:`<p class="drop">This week's grudge with history: ${W.games[1].winnerName} vs. ${W.games[1].loserName}, who have a habit of ruining each other's weeks. ${W.games[1].winnerName} took the latest round ${W.games[1].winnerPts} to ${W.games[1].loserPts}.</p><p style="font-style:italic;color:#5b5142;font-size:13.5px">Full all-time series appears here once prior seasons finish loading into the archive.</p>`,
      boxHtml:`<div class="box"><div class="box-h">All-Time Series</div><div class="stat-line"><span>${W.games[1].winnerName.split(' ')[0]} ↔ ${W.games[1].loserName.split(' ')[0]}</span><b>lead ·'25</b></div></div>` },
    upset:{ tag:'Cinderella', bodyHtml:`<p class="drop">${ups.winnerName} took ${ups.loserName} to the woodshed, ${ups.winnerPts} to ${ups.loserPts} — a ${ups.margin}-point demolition that nobody saw coming and ${ups.loserName} will not soon forget.</p><p>A beating this thorough demands acknowledgment. Consider it acknowledged.</p>` },
    benchReport:{ tag:'Blotter', boxHtml:`<div class="box"><div class="box-h">Grand Larceny</div><p><b>${W.scored[3].name}</b> — left an estimated <b>${(15+rng('b'+week)()*30).toFixed(1)}</b> on the bench. The crime is not losing. The crime is losing with points in your pocket.</p></div><p style="font-size:12.5px;font-style:italic;color:#5b5142">Player-level charges filed once the roster wire clears.</p>` },
    luck:{ tag:'Fortune', boxHtml:`<div class="box"><div class="box-h">Robbed</div><p><b>${W.games[2].loserName}</b> — scored ${W.games[2].loserPts} and still lost. Cosmic injustice, week ${week} edition.</p></div><div class="box"><div class="box-h">Blessed</div><p><b>${ups.winnerName}</b> — a ${ups.margin}-point win. A blowout spends the same as a squeaker.</p></div>`,
      quotes:[{quote:`Scored ${W.games[2].loserPts} and got nothing. I want a recount.`,attribution:W.games[2].loserName}] },
    powerRankings:{ tag:`Week ${week} · Op-Ed`, bodyHtml:W.scored.map(rankLine).join('') },
    standings:{ hed:`After Week ${week}`, tableHtml:standingsFromScored(W.scored) },
    tradeWinds:{ tag:'Rumor Mill · Unconfirmed, Unbothered',
      bodyHtml:`<p class="drop">Sources close to the situation — in a 14-man league, everyone is close to the situation — say at least one roster is quietly shopping to fix a hole ${W.bottom.name}'s week made painfully clear.</p>`,
      boxHtml:`<div class="box"><div class="box-h">Rumor Format</div><p style="font-style:italic">“League sources indicate <b>[Team]</b> is gauging the market for a <b>RB</b>. Eyebrows raised.”</p></div>`,
      quotes:[{quote:"I've seen the roster. I'd be picking up the phone.",attribution:'a source familiar with the matter'}] },
    tradeDesk:{ tag:'Front Office · Values via FantasyCalc',
      tradesHtml:`<div class="box"><div class="box-h">This Week's Trades</div><p style="font-style:italic;color:#5b5142">Quiet week on the wire. Cowardice, or strategy? Yes.</p></div>`,
      stalenessHtml:`<div class="box"><div class="box-h">Staleness Watch</div><div class="stat-line"><span>${NAMES[6]}</span><b style="color:#8a2018">104 days ❄</b></div><div class="stat-line"><span>${NAMES[13]}</span><b>41 days</b></div></div>`,
      tiersHtml:`<div class="box"><div class="box-h">Trader Tiers <span style="color:var(--stamp)">ALL-TIME</span></div><div class="stat-line"><span><b>S</b> · ${NAMES[3]}</span><b>23</b></div><div class="stat-line"><span style="color:#8a2018"><b>F</b> · ${NAMES[6]}</span><b>0</b></div></div>`,
      footnote:'Demo figures. Live values via FantasyCalc (dynasty / 1QB / half-PPR).',
      agingHtml:`<p class="lede-line">Ten weeks ago, ${NAMES[2]} looked like a bandit for landing a star back. He has since cratered — and this is a rebuild year for them anyway, so the raw value only tells half the story. Funny how these things age.</p>
      <div class="aging-verdict">Looked like <b>${NAMES[2]}</b> then · Looks like <b>${NAMES[13]}</b> now</div>
      <div class="aging-cards">
        <div class="aging-card">
          <div class="team-name">${NAMES[2]}</div>
          <div class="got">received: Star RB</div>
          <div class="val-row"><span>Value then</span><span>Value now</span></div>
          <div class="val-nums"><span class="v-then">8,000</span><span class="v-arrow">→</span><span class="v-now down">3,000</span></div>
          <div class="delta down">▼ 5,000 (injury)</div>
        </div>
        <div class="aging-card">
          <div class="team-name">${NAMES[13]}</div>
          <div class="got">received: Steady WR</div>
          <div class="val-row"><span>Value then</span><span>Value now</span></div>
          <div class="val-nums"><span class="v-then">7,500</span><span class="v-arrow">→</span><span class="v-now">7,000</span></div>
          <div class="delta">— 500 (held firm)</div>
        </div>
      </div>` },
    ...(week>=6 ? { playoffRace:playoffRaceDemo(W,week) } : {}),
    ...(week>=10 ? { obituary:{ hed:`In Memoriam: ${W.bottom.name}'s Playoff Hopes`, text:`Pronounced mathematically dead in Week ${week}. Cause: a chronic inability to score, most recently ${W.bottom.pts}. Survived by a high draft pick it did nothing to earn. The Herald lowers its flag briefly, then returns to teams that show up.` } } : {}),
  };
}

function standingsFromScored(scored){
  const rows = scored.map((s,i)=>{
    const cls = i<7?'champ':(i===13?'cellar':'');
    const res = i%3===1?`<td class="movement" style="color:#8a2018">L</td>`:`<td>W</td>`;
    return `<tr class="${cls}"><td>${s.name}</td><td>${s.pts}</td>${res}</tr>`;
  }).join('');
  return `<table><caption>Week scores · sorted high to low</caption><thead><tr><th>Team</th><th>Pts</th><th></th></tr></thead><tbody>${rows}</tbody></table>`;
}

function playoffRaceDemo(W,week){
  const s=W.scored;
  const row=(t)=>`<div class="scenario"><span class="team">${t.name}</span><span>In the hunt with ${14-week} to play. Win and you're likely safe; slip and the bubble swallows you.</span></div>`;
  const tier=(title,cls,teams,seedFrom=1)=>`<div class="race-tier ${cls}"><h4>${title}</h4>${teams.map((t,i)=>`<p><span class="seed">${cls==='clinched'?'z':(cls==='eliminated'?'✗':seedFrom+i)}</span> ${t.name} <b>${(10-i>0?10-i:1)}-${i}</b></p>`).join('')}</div>`;
  return {
    tiersHtml:`<div class="race-tiers">${tier('✓ Clinched','clinched',[s[0]])}${tier('In the Seats','contending',s.slice(1,7),2)}${tier('On the Bubble','bubble',s.slice(7,13),8)}${tier('✝ Eliminated','eliminated',[s[13]])}</div>`,
    scenariosHtml:s.slice(5,9).map(row).join(''),
  };
}

function reviewSections(){
  // real 2025 final results
  return {
    lead:{ edition:'Season 2025 · Final', kicker:'Championship · The Upset for the Ages',
      hed:'Arizona Queer Steals a Crown Nobody Handed Them',
      dek:'The fifth-best team in the regular season walks out with the only trophy that counts, toppling a Lil Azz Boyz juggernaut that looked unbeatable for four months and mortal for one Sunday.',
      bodyHtml:'<p class="drop">Here is how a dynasty is supposed to end: with the best team hoisting the trophy. What happened this year was larceny in broad daylight, and I have the box scores to prove it.</p><p>Lil Azz Boyz went 11-3, scored 1,754, and boasted the league\'s highest ceiling at 2,124 optimal points. On paper, a coronation. On the field, Arizona Queer went 9-5, finished fifth, and beat them anyway.</p><p>That is the whole story of fantasy football in one sentence, and it is why I keep covering a league that rewards the hot hand over the good team every single time.</p>',
      pull:'The best team all year is not the same as the best team on the last day. Ask the Boyz.',
      quotes:[{quote:"Rings beat regular seasons. Enjoy the view from second.",attribution:'Arizona Queer'}],
      sideBoxHtml:'<div class="champ-plate"><div class="crown">★ 2025 League Champion ★</div><div class="champ-name">Arizona Queer</div><div class="champ-note">9–5 · def. Lil Azz Boyz in the Final</div></div><br><div class="box"><div class="box-h">The Podium</div><div class="stat-line"><span>🥇 Champion</span><b>Arizona Queer</b></div><div class="stat-line"><span>🥈 Runner-Up</span><b>Lil Azz Boyz</b></div><div class="stat-line"><span>🥉 Third</span><b>Chase down Ass up</b></div></div>',
    },
    controversy:{ mode:'invented', tag:'Season of Suspicion',
      bodyHtml:'<p class="drop">A champion crowned, and this paper has questions. How does the fifth seed win it all? This reporter has a theory and a wall covered in string.</p><p>Arizona Queer\'s title run was, allegedly, too clean. Sources this paper invented moments ago suggest a season-long conspiracy: favorable matchups, a benched-points scheme, and a betting cartel that cashed out the moment the confetti fell. Lil Azz Boyz, the 11-3 favorite, "lost" the final — and we use quotation marks with intent. We demand an asterisk, an inquiry, and a rematch nobody will grant. Print it anyway.</p>',
      backPageCaption:'That\'s the season. See you in the offseason, where the real damage is done.' },
    rivalry:{ tag:'Season Series', bodyHtml:'<p class="drop">The rivalry of the year: Lil Azz Boyz vs. Arizona Queer, decided on the biggest stage. The regular-season king met the postseason assassin, and the assassin won. A series that will define the offseason.</p>',
      boxHtml:'<div class="box"><div class="box-h">Title Game</div><div class="stat-line"><span>Arizona Queer</span><b>W</b></div><div class="stat-line"><span>Lil Azz Boyz</span><b>L</b></div></div>' },
    upset:{ tag:'The Title', bodyHtml:'<p class="drop">The championship itself was the upset of the year — the 5-seed over the 11-3 wagon. Enough said, though Malloy will say more all offseason.</p>' },
    benchReport:{ tag:'Season Blotter', boxHtml:'<div class="box"><div class="box-h">Repeat Offender</div><p><b>Lil Azz Boyz</b> — a league-worst 370 points left on the bench across the season. The best roster, the worst manager of it. Nearly won anyway. Terrifying.</p></div>' },
    luck:{ tag:'Season Fortune', boxHtml:'<div class="box"><div class="box-h">Unluckiest Man</div><p><b>Top3prediction</b> — a league-high 1,790 points and a seventh-place finish. Scored like a champion, seeded like a fraud.</p></div>' },
    powerRankings:{ tag:'Final · Op-Ed', bodyHtml:[
      ['Arizona Queer','Rings beat records. Champions.'],['Lil Azz Boyz','2,124 of ceiling, one final of excuses.'],
      ['Merry Men','7-game streak into the bracket wall.'],['Egbuka Matata','Named after a rookie, mostly worked.'],
      ['Flamboyant Commish','Best seed, third-place game. Cursed.'],['Chase down Ass up','Quietly excellent all year.'],
      ['Top3prediction','Top scorer, seventh place. Tragic.'],['Reigning Def. King 💩','.500 and a lot of emoji.'],
      ['LGBTQ Fan- that\'s gay','Middle of the pack, middle of the road.'],['Solid team, but I\'m gay.','5-9. The name overpromised.'],
      ['Golf Fag','4-10. Long offseason.'],['MAHOMES & MAAUTO','4-10. Neither showed.'],
      ['Bear and Twink Law Firm','3-11. Case dismissed.'],['Im not gay anymore','1-13. See obituary.'],
    ].map(([n,d],i)=>`<p${i===13?' style="color:#8a2018"':''}><b>${i+1}. ${n}</b> — ${d}</p>`).join('') },
    standings:{ hed:'Final Standings', tableHtml:`<table><caption>2025 final · by wins then PF</caption><thead><tr><th>Team</th><th>Rec</th><th></th></tr></thead><tbody>
      <tr><td>Flamboyant Commish</td><td>11-3</td><td>1</td></tr><tr class="champ"><td>Lil Azz Boyz</td><td>11-3</td><td>2</td></tr>
      <tr><td>Merry Men</td><td>11-3</td><td>3</td></tr><tr><td>Egbuka Matata</td><td>10-4</td><td>4</td></tr>
      <tr class="champ"><td>Arizona Queer ★</td><td>9-5</td><td>5</td></tr><tr><td>Chase down Ass up</td><td>9-5</td><td>6</td></tr>
      <tr><td>Top3prediction</td><td>8-6</td><td>7</td></tr><tr><td>Reigning Def. King 💩</td><td>7-7</td><td>8</td></tr>
      <tr><td>LGBTQ Fan</td><td>5-9</td><td>9</td></tr><tr><td>Solid team, but…</td><td>5-9</td><td>10</td></tr>
      <tr><td>Golf Fag</td><td>4-10</td><td>11</td></tr><tr><td>MAHOMES & MAAUTO</td><td>4-10</td><td>12</td></tr>
      <tr><td>Bear & Twink Law</td><td>3-11</td><td>13</td></tr><tr class="cellar"><td>Im not gay anymore</td><td>1-13</td><td>14</td></tr>
    </tbody></table>` },
    obituary:{ hed:'In Memoriam: The 2025 Campaign of "Im not gay anymore"', text:'Finished 1-13, closing on a nine-game losing streak that showed neither mercy nor a pulse. Set the fewest optimal points in the league — even the bench gave up. Survived by a top-three draft pick and a fanbase of zero. Rest easy; the offseason cannot go worse.' },
  };
}

// ---- main ----
function parseArgs(){
  const a = process.argv.slice(2); const o = { week:1, review:false, images:'./images', form:'' };
  for(let i=0;i<a.length;i++){
    if(a[i]==='--week') o.week=+a[++i];
    else if(a[i]==='--review') o.review=true;
    else if(a[i]==='--images') o.images=a[++i];
    else if(a[i]==='--form') o.form=a[++i];
  }
  return o;
}

const opts = parseArgs();
const imgsRaw = pickImages({ season:'2025', week:opts.review?99:opts.week, count:5, dir:opts.images });
// demo files are written to ./demo-output/, so image paths (relative to that file)
// need to climb one level back up to the real images folder.
const imgs = imgsRaw.map(p => p.startsWith('./') ? '../' + p.slice(2) : '../' + p);
const sections = buildSections({ week:opts.week, review:opts.review, formLink:opts.form });
const html = broadsheetTemplate({
  leagueName:'Hetero Heroes', season:'2025', week:opts.week, isReview:opts.review,
  s:sections, identity, images:imgs, issueNo:opts.review?'REVIEW':opts.week, formLink:opts.form,
});

if(!existsSync('./demo-output')) mkdirSync('./demo-output');
const file = opts.review ? './demo-output/2025-review.html' : `./demo-output/2025-week-${opts.week}.html`;
writeFileSync(file, html);
console.log(`✓ Demo generated: ${file}`);
console.log(`  ${opts.review?'Year-end review edition':`Week ${opts.week}`} · ${Object.keys(sections).length} sections · ${imgs.length} images`);
console.log(`  Open it in your browser to view.`);
