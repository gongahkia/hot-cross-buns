# Model-aware context budgets

HCB treats a model's input window separately from the task's aggregate request,
time and usage limits. A context-window selection grants no tool or account
permission. CLI specialists retain their own harnesses and context management.

## Capacity resolution

Native HCB-managed models carry a `ContextPolicy` through usage, budget and
streaming wrappers. It contains the deployment window, an optional input-only
maximum, output reserve, text estimator and metadata source.

Capacity comes from these sources:

1. Exact, documented model identities in `internal/model/context.go`.
2. Optional `context_windows` entries keyed by the existing `provider:model`
   identity in local configuration. A configured value can lower a documented
   ceiling. Unrecognized deployments require their own declared capacity.
3. For managed Ollama models, a bounded read of `/api/ps` supplies the currently
   allocated `context_length`. HCB neither loads nor downloads weights to inspect
   it. Configured lower limits remain in force.

An unrecognized cloud/custom deployment uses a labeled 32,768-token fallback;
an unallocated managed local model uses 4,096. These are conservative fallback
policies, **not verified capacities**. A custom deployment with a smaller window
must declare it. A larger configured number does not increase the server's
allocation. Ollama metadata is an observation at model construction; other
clients or runtime configuration can subsequently change that allocation.

For example, the existing configuration document can contain:

```json
{
  "context_windows": {
    "my-provider:small-model": 8192
  }
}
```

Entries accept 1,024 through 4,194,304 tokens. This advanced configuration uses
existing model identities; no extra product page or composer toggle is added.
A changed explicit configuration participates in retained-work scope checks.

## Counting and admission

The input allowance subtracts the reserved output and a framing margin from the
window, and honors an input-only provider maximum when documented. Request
counting includes the system prompt, messages, tool schemas and arguments,
provider replay data, attachments and visual inputs. Adapters carry the output
reserve into their native generation parameters.

Supported OpenAI identities use the embedded `o200k_base` vocabulary from
`tiktoken-go/tokenizer` v0.7.0. The dependency supports the repository's Go version
and requires no runtime vocabulary download. This is a text-token estimate with
framing allowances, **not a provider billing count or a claim that every newer
model uses an identical tokenizer**. Other tokenizers use a conservative UTF-8
byte ceiling. Image/PDF estimates are deliberately conservative and can reject
an input that a provider-specific media counter could admit.

The final guard checks the complete request before calling its transport.
Unsupported images still produce the text-only capability error. An oversized
current task or tool inventory produces a capacity error rather than silently
removing its instructions, changing permissions or claiming it ran.

## Conversation and task preparation

Ordinary conversation allocates recent detail, historical sections, personal
memory and recalled sources from the selected input allowance. The router
accounts for its actual system prompt and serialized request framing, including
selected task state. Derived context can be reduced further to fit that envelope.
Recent text is supplied once. Saved facts stay whole when an entry is omitted;
shortened historical excerpts are labeled. Exclusions, withdrawal screening and
source validity checks remain authoritative. Unprofiled internal test/adaptor
callers retain the earlier bounded compatibility policy.

Task continuations and active tool loops use the same window policy. Compaction
chooses complete interactions instead of a fixed last-12-message tail. It keeps
the current task and latest complete interaction, preserves tool-call/result
pairing, and requests factual summaries in bounded batches. At most eight task
summary batches are attempted per compaction; ordinary archive maintenance keeps
its existing two-call limit. Calls also consume the existing aggregate budget.

Removed task text is retained in private revision replay archives; it is not
included in subsequent model requests. Actual knowledge-read dependencies
survive compaction so future continuations can recheck corrected or withdrawn
sources. The model-facing summary contains no tool or approval authority.
Canonical user-visible conversation history remains separate and retained.

I/O, per-source excerpt, archive scan and privacy-comparison ceilings remain
bounded. Each cached archive node and the legacy continuity view retain a 12 KiB
storage ceiling; the model-facing aggregate of nodes scales with its token budget. They protect resource use and complete privacy checks; they are not
presented as model context-window sizes. Summaries remain derived, lossy evidence.

## Verified metadata sources

Checked 2026-11-26. Registry entries use exact IDs rather than family-name guesses.

- OpenAI GPT-5.6/Sol, Terra and Luna: 1,050,000-token windows. [Sol](https://developers.openai.com/api/docs/models/gpt-5.6-sol), [Terra](https://developers.openai.com/api/docs/models/gpt-5.6-terra), [Luna](https://developers.openai.com/api/docs/models/gpt-5.6-luna).
- OpenAI GPT-5 mini: 400,000-token window. [Model reference](https://developers.openai.com/api/docs/models/gpt-5-mini).
- OpenAI GPT-6.2 Sol: 1,050,000-token window and 922,000 maximum input. [Model reference](https://developers.openai.com/api/docs/models/gpt-6.2-sol).
- Claude exact identities and their 200K/1M windows: [Anthropic model reference](https://platform.claude.com/docs/en/models/overview).
- Gemini 3.5 Flash: 1,048,576 input tokens; its documented alias now redirects to 3.6 Flash. HCB does not change a user's model selection during this work. [Google model reference](https://aistudio.google.com/docs/models/gemini-3.5-flash).
- Allocated Ollama context differs from a model's advertised maximum and depends on runtime configuration. [Ollama context documentation](https://docs.ollama.com/context-length).
- Embedded encodings and tokenizer API: [upstream tokenizer](https://github.com/tiktoken-go/tokenizer).

## Verification

Tests exercise full-request counting, UTF-8 excerpts, output reserves in provider
payloads, exact model IDs, configured limits, Ollama read-only inspection,
small/large window behavior, atomic tool interactions, failures without source
mutation, in-run archive/dependency retention, and canonical browser continuity.
Live recall quality is evaluated separately with the synthetic daily-memory
corpus. Passing boundary tests establishes mechanisms, not long-term recall
quality or local-model parity.
