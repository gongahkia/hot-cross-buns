# Local-model laptop workflows

Managed local models can now use HCB's existing controlled browser through text snapshots and element references. A model's provider does not grant browser access: the user must select a live session, permitted origins and tabs, then review a next-task grant. Text-only models are not offered the screenshot tool.

## Use it from the browser app

1. In **Models**, configure a supported local Ollama model. The model must be installed and able to produce structured tool calls. This change does not download a model, start Ollama, change the current orchestrator, or substitute a cloud provider.
2. Open **Settings → Browser access**. Use **Install browser** if the pinned runtime is missing, then **Open private browser**. The separate temporary Chromium profile starts with agent access paused.
3. Add the exact allowed site origins. While access is paused, sign in privately if the task needs it. Choose the tab to share; other browser tabs are not exposed to the model.
4. Resume access and review **Use for next task**. Return to the same chat and submit the task. The grant is consumed for that submitted task; an unrelated later turn does not inherit it automatically.
5. The agent can read the selected page's bounded accessibility snapshot and act through opaque references. Each navigation, click, fill, keypress or other browser mutation still requires a fresh review. References expire after page changes. Pause for private takeover, or stop the browser to revoke the session.

A useful first task is to read a selected project folder and an approved project page, then draft a source-linked brief. A source read failure must be reported rather than treated as evidence. Local model quality, latency and tool-call reliability still need qualification against the installed model.

## Boundaries

The browser controller continues to enforce origin and selected-tab policy. The model receives no arbitrary JavaScript execution, cookies, storage, browser-profile paths or arbitrary local uploads. Task grants remain bound to the reviewed browser policy. Explicit per-request browser opt-outs are preserved.

Local models can also use [macOS computer access](COMPUTER-ACCESS.md) through bounded accessibility text and reviewed control references. It needs a separate app/session grant; a browser grant does not authorize desktop access. The screenshot-based desktop/CUA protocol still requires its supported OpenAI adapter and retention consent. A user-facing localhost preview remains separate from agent browser authority.

Connected services are independent capabilities. For Calendar, see [Google Calendar](GOOGLE-CALENDAR.md). Local inference does not mean connected tools stop contacting their configured services.

See the [verification record](verification/local-browser-calendar-2026-11-24.md) for observed results and unavailable live checks.
