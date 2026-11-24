import { Card } from "../components/Bits.jsx";
import { visible } from "../safeText";

// What the release notes say versus what is this lab's model. The three lists come from the server (data.js, the same text the banner draws on); nothing is written here.
export default function LimitsPage({ lab }) {
  const { info, story } = lab;
  const warnings = Array.isArray(story?.warnings) ? story.warnings : [];
  const List = ({ items, testId }) => <ul className="plain" data-testid={testId}>{items.map((t) => <li key={t}>{visible(t)}</li>)}</ul>;
  return (
    <div className="stack">
      <div className="cols">
        <Card tone="ok" kicker="Sourced" title="What the 2026-11-21 release notes say" testId="limits-sourced">
          <List items={info.sourced} testId="limits-sourced-list" />
          <p className="muted">This is the only sourced claim in the lab. Nothing else on any page is a Ping statement.</p>
        </Card>
        <Card tone="warn" kicker="UNVERIFIED" title="Not in the release notes: this lab's own model" testId="limits-model">
          <List items={info.labModel} testId="limits-model-list" />
        </Card>
      </div>
      <Card tone="warn" kicker="UNVERIFIED" title="What the lab does not know" testId="limits-unverified">
        <List items={info.unverified} testId="limits-unverified-list" />
        <p className="muted">Each of these is the lab's own choice, shown so it can be checked against a real tenant. None is claimed to match the product.</p>
      </Card>
      <Card tone="neutral" kicker="No claim" title="Open question" testId="limits-open">
        <List items={info.notClaimed} testId="limits-open-list" />
      </Card>
      {warnings.length > 0 && (
        <Card tone="warn" kicker="Configuration" title="customer.config.json: some fields were not used" testId="limits-config-warnings">
          <List items={warnings} testId="limits-config-warnings-list" />
          <p className="muted">A bad field falls back to its default; each of these was also written to the lab's start-up log.</p>
        </Card>
      )}
      <Card tone="neutral" kicker="Real mode" title="Mock is the only mode today" testId="limits-real">
        <p data-testid="limits-real-reason">{visible(info.realReason)}</p>
        <p className="muted">The Real button in the header is disabled for that reason; the server answers 409 with the same words if it is asked anyway.</p>
      </Card>
    </div>
  );
}
