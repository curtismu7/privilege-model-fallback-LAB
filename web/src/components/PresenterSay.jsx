import { visible } from "../safeText";
import { paragraphs } from "../talk";

// The presenter's lines for a page: the talk-track items for it, as the server worded them, one <p> per paragraph.
export default function PresenterSay({ say, heading }) {
  return (
    <aside className="presenter-say" data-testid="presenter-say" aria-label="Talk track" hidden={say.length === 0}>
      {heading && <p className="kicker" data-testid="presenter-beat">{heading}</p>}
      {say.flatMap((t) => paragraphs(t.say).map((p, i) => <p key={`${t.id}-${i}`}>{i === 0 && <strong>{visible(t.title)}. </strong>}{visible(p)}</p>))}
    </aside>
  );
}
