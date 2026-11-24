# Voice in the browser app

The microphone button beside Attach files opens Voice settings. These controls use the existing speech helper and the normal chat submission path.

1. Choose a transcription provider. Opening Voice settings does not change preferences or authorize recording. If no voice provider has been explicitly configured, the menu asks you to choose one.
2. For local transcription, choose **Whisper · on this laptop** and a model. Install the optional `whisper-cli` runtime as described in [Local voice](LOCAL-VOICE.md), then use **Download selected model**; the same button cancels an active download. Downloads are explicit and verify the pinned model digest. The app reports missing runtime/model setup rather than switching to a cloud provider.
3. Choose **Dictate** to record up to two minutes. Stop with **Finish turn** or the microphone button. The transcript is appended to the unchanged draft for review; it is not sent automatically.
4. Choose **Start voice conversation** from an empty composer after active work finishes. In this mode each spoken turn is sent automatically after a pause or **Finish turn**. The microphone is released during transcription and while waiting for and reading the reply. The next listening turn starts after playback.
5. **End voice conversation** stops voice capture, transcription and playback. It does not cancel an already submitted assistant task. Use the chat's normal task controls for that.

Voice conversation uses the browser's speech synthesis API with voices marked as installed local voices. If speech playback or a local voice is unavailable, the reply remains in the chat and the voice conversation stops with an actionable message. This is a turn-based conversation, without simultaneous listening and speaking or mid-sentence voice interruption.

Cloud transcription is optional. Choosing OpenAI or Gemini explicitly uses that speech provider's configured credentials and existing usage accounting. Browser code receives neither API keys nor local Codex login credentials. An orchestration API key is not silently selected for microphone use when no voice provider has been configured. Live Gemini was excluded from this verification.

## Drafts, permissions and cancellation

Microphone permission belongs to the browser. The page requests it only after you start recording. Capture sends no camera request. Audio is converted in browser memory to mono 16 kHz, 16-bit PCM WAV, bounded to two minutes and 8 MiB.

The server binds an expiring, single-use recording grant to the exact conversation, backend instance and reviewed provider route. Changing voice settings revokes existing grants. Chat switches, disconnected or hidden tabs, and explicit cancellation stop the voice session. A late microphone permission result is released after cancellation. A changed draft is retained rather than overwritten by a late transcript.

Voice conversation pauses for action/plan review. Dictation remains available for composing ordinary messages and corrections. Failed or unconfirmed sends use the existing pending-message identity and manual retry behavior; voice does not automatically retry a send.

## Verification boundaries

Automated coverage exercises voice request origin checks, recording limits, grant replay/expiry, chat switches, provider changes, cancellation, audio cleanup/conversion, draft preservation, explicit setup, and turn-based submission/playback behavior. See [the verification record](verification/voice-orchestration-2026-11-24.md) for commands and live orchestration results.

Physical microphone permission, recognition quality, actual audible playback, browser-specific audio decoding and responsive visual appearance were not verified interactively in this change. Local recognition requires the optional Whisper executable and model on the machine running the server. Browser speech synthesis availability depends on the browser and installed OS voices.
