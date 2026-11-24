// A talk-track section's `say` holds one paragraph per blank line. These helpers keep every paragraph its own <p>.
export const paragraphs = (say) => String(say ?? "").split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);

// The shared TalkTrackDialog draws one title and one <p> per item and is never edited here, so a section with several paragraphs becomes several items:
// the first carries the title, the rest are "<title> (continued)". Ids stay unique.
export function dialogItems(talk) {
  return (Array.isArray(talk) ? talk : []).flatMap((t) => {
    const ps = paragraphs(t.say);
    if (ps.length <= 1) return [{ ...t, say: ps[0] ?? "" }];
    return ps.map((p, i) => ({ id: i === 0 ? t.id : `${t.id}-${i + 1}`, title: i === 0 ? t.title : `${t.title} (continued)`, say: p }));
  });
}
