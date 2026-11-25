# Memory audit and browser voice refinement — 25 November 2026

## Delivered

- The [memory roadmap](../MEMORY_ROADMAP_2026-11-25.md) audits current stores,
  significance/admission, semantic retrieval, temporal review, consolidation,
  corrections and forgetting. It links primary Anthropic/OpenAI publications and
  proposes concrete additions with acceptance cases. No memory policies,
  personal records or background consolidation settings were changed.
- Transcription has a persistent, default-off enable switch. The speech backend
  rejects transcription while disabled and binds enablement into its route.
  An unconfigured profile defaults to local Whisper rather than its chat
  provider. Existing profiles without an explicit enable flag stay off.
- Settings → Voice models owns provider/model selection, enablement, availability
  and explicit local downloads. The composer microphone sits immediately left of
  Send and starts dictation directly once enabled and available. It opens no
  setup pane. The recording bar shows actual microphone RMS levels in ordinary
  capture, with Cancel/Finish controls and reduced-motion transitions.
- Finished dictation remains an unsent draft. Existing conversation mode, draft
  guards, grant ownership, route-change checks and cancellation boundaries remain
  in use. No API credentials enter browser state.

## Checks

`make check` passed all Go tests and vet, 133 browser tests, 145 host tests and
the OAuth build test. Focused coverage includes persisted off/on/off behavior,
disabled backend rejection, route invalidation, settings-only configuration,
direct capture, cancellation/chat switches, draft-only transcription, sampled
waveform levels and audio-resource cleanup. The Impeccable mechanical detector
reported no findings for changed frontend files.

```sh
task_tmpdir=$(python3 -c 'import os,tempfile;print(os.path.realpath(tempfile.gettempdir()))')
TMPDIR="$task_tmpdir" fnm exec --using 26.7.0 make check
```

An isolated synthetic profile verified initial disabled state, Settings
navigation, enablement, direct recording, the waveform at 1280 × 800 and
390 × 844, finishing into an unsent draft and zero browser console errors. The
first attempt used Chromium's fake microphone flags, but `getUserMedia` remained
pending. That native capture attempt was incomplete. Visual/interaction checks
then used a browser-intercepted synthetic capture module and a synthetic speech
helper, with production UI code unchanged. This is not physical microphone or
recognition acceptance. Unit tests separately cover the real capture module with
deterministic microphone/recorder/analyser fixtures.

No cloud transcription, microphone permission changes, actual audio playback,
paid model requests or live Gemini tests were performed. No fresh live-model
memory benchmark was run; the audit's quality recommendations remain proposals.
