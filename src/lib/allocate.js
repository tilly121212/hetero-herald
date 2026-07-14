// Story allocation. A newspaper doesn't run the same team as the star of five
// different articles. Once a team "anchors" a section (is its primary subject),
// it's spent for anchoring elsewhere — it can still be MENTIONED, but the next
// section picks a different primary subject from its ranked candidates.
//
// This runs BEFORE the writer, so each section prompt is told who its subject is
// and which teams are already taken.

export function allocateStories(sectionsInPriorityOrder) {
  // sectionsInPriorityOrder: [{ id, candidates:[{roster_id, score, ...}, ...] }, ...]
  // Higher-priority sections choose first (lede first, then GOW, upset, etc.).
  const claimed = new Set();
  const assignment = {};

  for (const section of sectionsInPriorityOrder) {
    // pick highest-scoring candidate whose PRIMARY subject isn't already claimed
    let chosen = null;
    for (const c of section.candidates) {
      const subjects = c.subjects ?? [c.roster_id]; // a game has 2 subjects
      const anyClaimed = subjects.some(s => claimed.has(s));
      if (!anyClaimed) { chosen = c; break; }
    }
    // fallback: if every candidate collides, take the top one anyway (better to
    // repeat than to leave a section empty), but flag it so the writer can angle differently.
    if (!chosen && section.candidates.length) {
      chosen = { ...section.candidates[0], collision: true };
    }
    if (chosen) {
      assignment[section.id] = chosen;
      for (const s of (chosen.subjects ?? [chosen.roster_id])) claimed.add(s);
    }
  }
  return assignment; // { sectionId -> chosen candidate }
}

// Convenience: given an assignment, produce the "already covered" list a given
// section's writer prompt should avoid featuring (but may reference in passing).
export function coveredBefore(sectionId, sectionsInPriorityOrder, assignment) {
  const covered = new Set();
  for (const section of sectionsInPriorityOrder) {
    if (section.id === sectionId) break;
    const a = assignment[section.id];
    if (a) for (const s of (a.subjects ?? [a.roster_id])) covered.add(s);
  }
  return [...covered];
}
