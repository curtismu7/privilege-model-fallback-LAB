import { visible } from "../safeText";

// One model's token budget: spent against its limit, as a bar AND as words (never colour alone). Tokens only; the bar's width is data, its colour a token.
export default function Meter({ ledger }) {
  const { provider, model, limit, spent, remaining, position } = ledger;
  const pct = limit > 0 ? Math.min(100, Math.round((spent / limit) * 100)) : 100;
  const name = `${provider}/${model}`;
  return (
    <li className="meter" data-testid={`meter-${position}`}>
      <p className="meter__name"><span className="step-num">{position + 1}</span><code>{visible(name)}</code></p>
      <div className="meter__bar" role="meter" aria-label={`Budget spent on ${name}`} aria-valuemin={0} aria-valuemax={limit} aria-valuenow={spent} aria-valuetext={`${spent} of ${limit} tokens spent`}>
        <span style={{ width: `${pct}%` }} />
      </div>
      <p className="muted meter__text">{spent} of {limit} tokens spent, {remaining} left{limit === 0 ? " (a zero budget is out of budget at once)" : ""}</p>
    </li>
  );
}
