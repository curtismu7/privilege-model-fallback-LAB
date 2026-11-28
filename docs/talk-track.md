# Talk track

<!-- The source for the Talk track view and the presenter mode. Written once with {{castBrand}}-style tokens; the four vertical packs
     (airlines, retail, health, finance) and customer.config.json fill them. A test fails on a token no pack defines. A heading that starts with
     "S01:" to "S09:" belongs to the story of the same number. Keep every section short enough to say in a minute. -->

## Before you start

You are about to show an LLM key that names a second model. Say first what is sourced and what is not. The only claim taken from the 2026-11-21 release notes is this: a key can name a second model, even on another provider, that answers when the first is down, overloaded or out of budget, and the fallback carries its own budget. Everything else on the screen is this lab's own model and is labelled UNVERIFIED. The Mock or Real modal opens first and says the same; close it with Got it.

The story is told for {{castBrand}}, an invented example. The verticals change the words, not the models and not the numbers.

## What is simulated, and what is not

Everything is simulated: the mock LLM key, the model providers (healthy, down, overloaded, timeout, slow), the token ledger per model and the lab clock. Nothing leaves this machine, and a guard refuses any outbound call. Real mode is not built; its toggle is disabled with the reason.

Say plainly that the lab does not know what overloaded means in the product, whether a retry comes before the fallback, what happens when a model fails mid-stream, whether the guard runs again on the fallback's answer, or what the refusal says. The Limits page lists each of these. Do not present any of them as a Ping statement.

Say also what the lab makes no claim about: whether a gateway's own rate-limit refusal can trigger a fallback. That is an open question, not an answer.

## S01: The primary answers, nothing falls back

Run the first scenario: {{castApp}} calls with {{castKey}} for {{castTask}} and the primary answers. The trace has one attempt, the fallback is never tried, and only the primary's budget meter moves. A fallback has to stay out of the way when it is not needed.

## S02: The primary is down and the second model answers

Run the second scenario. The primary answers 503 after 20 ms of lab time and the second model answers. The verdict names the model that served, and the attempts table lists both attempts with their latency. Point at the budget meters: the spend landed on the second model's own ledger.

## S03: The primary is overloaded and the second model answers

The primary answers 429. Be careful with the words: that is the lab's model of overloaded, a provider-origin 429, and it is UNVERIFIED against the product. The result is the same as before: the second model answers. The lab does not retry the primary first, and it does not know whether the product does.

## S04: The primary is out of budget and the second model answers

The primary has 100 of 1000 tokens left and the call needs about 128, so it is skipped without a provider call and without latency. The second model answers and is charged on its own ledger. This is the budget half of the release-note sentence: each model carries its own budget, so {{castOwner}} can set a ceiling per model.

## S05: The second model is on another provider

The primary is down and the second model lives on a different provider. The verdict shows the serving provider. The release notes say the fallback can be a different provider; the lab shows what that looks like, with a simplification: provider state is per model, not per provider.

## S06: Both budgets are spent: a named refusal

Neither model can pay for the call. The result is a named refusal, all_budgets_exhausted, whose message says which budgets ran out and how many tokens each had left. No provider is called and nothing is charged. Say that the wording and the HTTP status of the real refusal are UNVERIFIED: this lab returns a normal result with ok false and does not imitate a status it has not seen.

## S07: Both models are down: a named refusal

Both providers fail, so the refusal is all_providers_failed and names each model with its status code. By the code alone {{castOwner}} can tell a provider outage from a spent budget, and the page never shows a blank result.

## S08: A key with no fallback configured

A key with a single model, and that model is down. The refusal is no_fallback_configured and says so. This is the cue to add a second model to {{castKey}}.

## S09: A slow primary hits the timeout

The primary is slow, ten times its normal latency, and the key's timeout is 3000 ms, so the call times out with a 504 after 3000 ms of lab time. Then the second model answers. The lab clock shows the cost: the timeout plus the second model's latency, 3400 ms in all.

## What this run left behind

Open the panel under the result. It lists, in time order, what the run left behind for observability: the key's budget decisions and the provider replies. Every row is tagged simulated: the lab's mock computed it, nothing was read from a product log. Where a layer has nothing the panel says so. The lab never claims that a product logged an event.

## Closing

Three things to leave with {{castBrand}}: a key can name a second model, even on another provider; each model carries its own budget; and when nothing can answer, the answer is a named refusal, not a blank page. Everything beyond that is this lab's model, to be checked against a real tenant before anyone relies on it.
