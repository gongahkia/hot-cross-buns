# Cross-source goal benchmark

**Interface status:** Hot Cross Buns runs as a local browser app (`make run`). Shell examples below are source-checkout developer operations with an explicit internal opt-in; see [development instructions](DEVELOPMENT.md). They do not install or enable a public CLI.

`internal/eval/testdata/cross-source-goals-v1/dataset.json` contains eight
two-turn goal tasks. Each begins with selected mail, calendar, and notes files;
the second turn changes one source and asks Hot Cross Buns to refresh a reviewable
`brief.md`. Six cases are development and two are held out. They cover a venue
cancellation, conflicting meeting time, quote above budget, withdrawn consent,
an earlier deadline, an exclusivity demand, an instruction embedded in mail,
and unrelated mail that should not trigger an offsite update.

The files stand in for connected results so the same facts can be replayed
without live account access. This tests cross-source judgment and goal context
with a live model, but does not test Gmail or Calendar API reliability. The
separate connected goal workflow test exercises those API boundaries with a
scripted server.

## Run a matched comparison

```sh
HOT_CROSS_BUNS_INTERNAL_COMMANDS=1 go run ./cmd/hot-cross-buns work eval validate internal/eval/testdata/cross-source-goals-v1/dataset.json
HOT_CROSS_BUNS_INTERNAL_COMMANDS=1 go run ./cmd/hot-cross-buns work eval run internal/eval/testdata/cross-source-goals-v1/dataset.json \
  --report-dir /tmp/hot-cross-buns-cross-source-agent --id cross-source-agent \
  --split development --live --provider PROVIDER --model MODEL \
  --max-model-requests 400 --timeout-seconds 3600
HOT_CROSS_BUNS_INTERNAL_COMMANDS=1 go run ./cmd/hot-cross-buns work eval run internal/eval/testdata/cross-source-goals-v1/dataset.json \
  --report-dir /tmp/hot-cross-buns-cross-source-baseline --id cross-source-baseline \
  --split development --live --provider PROVIDER --model MODEL \
  --baseline-no-goal --max-model-requests 400 --timeout-seconds 3600
HOT_CROSS_BUNS_INTERNAL_COMMANDS=1 go run ./cmd/hot-cross-buns work eval compare /tmp/hot-cross-buns-cross-source-baseline/experiment.json \
  /tmp/hot-cross-buns-cross-source-agent/experiment.json
```

Use exactly the same provider and model for both arms. A selected Ollama model
can use `--provider hot-cross-buns-local --model MODEL_TAG`. The held-out split should
run only after development failures are fixed.

The graders check completion, a decisive phrase, an excluded stale or unsafe
phrase, and artifact validity. They do not prove the brief is helpful, the
citations support its claims, or an alert should have been sent. Blind human
review should score those dimensions and the model's handling of the injected
mail instruction. Raw reports retain traces for failed cases.

On 2026-10-17, both scripted arms passed 8/8. Scripts supply the answers, so
this validates the fixtures and graders only. No live result is available:
the configured Gemini quota was exhausted, and Ollama is not installed on this
machine. The scripted reports are at
`/tmp/hot-cross-buns-cross-source-scripted-agent-v2-20261017/experiment.json` and
`/tmp/hot-cross-buns-cross-source-scripted-baseline-20261017/experiment.json`.
