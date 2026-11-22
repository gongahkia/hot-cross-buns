// Composition adapted from pinned OpenCode app.tsx: renderer-scoped providers,
// keymap, dialogs, toast, responsive session frame and bottom prompt. The Hot Cross Buns
// client and data contexts replace OpenCode's server/client/plugin composition.
import { Show, For, onCleanup } from "solid-js"
import { useRenderer } from "@opentui/solid"
import { ClientProvider, useClient } from "./context/client"
import { DataProvider, useData } from "./context/data"
import { ConfigProvider, terminalShortcuts } from "./config"
import { ThemeProvider, useTheme } from "./context/theme"
import { Keymap } from "./context/keymap"
import { ClipboardProvider } from "./context/clipboard"
import { DialogProvider, useDialog } from "./ui/dialog"
import { ToastProvider } from "./ui/toast"
import { DialogConfirm } from "./ui/dialog-confirm"
import { DialogSelect } from "./ui/dialog-select"
import { CommandPaletteDialog } from "./component/command-palette"
import { SessionFrame } from "./component/session-frame"
import { Prompt } from "./component/prompt"
import { Progress } from "./hot-cross-buns/progress"
import { ConnectionStatus } from "./hot-cross-buns/connection-status"
import { Transcript } from "./hot-cross-buns/transcript"
import { Panel } from "./hot-cross-buns/panel"
import { literal } from "./hot-cross-buns/text"
import { Hub } from "./hot-cross-buns/hub"
import { Following } from "./hot-cross-buns/following"
import { useActions } from "./hot-cross-buns/actions"
import { useProductActions } from "./hot-cross-buns/product-actions"
import { useResultActions } from "./hot-cross-buns/result-actions"
import { useNative } from "./hot-cross-buns/native"
import { commandGroup, commandAliases, commandDescription } from "./hot-cross-buns/command-groups"
import { ApprovalReview } from "./hot-cross-buns/approval-review"
import { runBackendCommand } from "./hot-cross-buns/command-actions"
import { RecoveryNotice } from "./hot-cross-buns/recovery-notice"
import { VoiceNotice } from "./hot-cross-buns/voice-notice"
import type { VoiceSession } from "@hot-cross-buns/application-host/voice-session"
import type { HotCrossBunsClient } from "./hot-cross-buns/client"
import type { ClipboardService } from "./context/clipboard"

function Shell(props: { quit(): Promise<void>; voice?: VoiceSession }) {
  const client = useClient(), data = useData(), theme = useTheme(), dialog = useDialog()
  const controls = useActions()
  const product = useProductActions(controls)
  useResultActions(controls, product.reviewNoise)
  const voice = useNative(controls, props.voice)
  const attempt = (operation: Promise<unknown>) => { void operation.catch(error => client.fail(error)) }
  const palette = () => dialog.replace(() => <CommandPaletteDialog />)
  const navigate = (command: string) => attempt(client.navigate(command))
  const close = async () => {
    if (/^\/(exit|quit)$/.test(client.draft.text.trim())) await client.edit("")
    await client.track("Closing Hot Cross Buns…", props.quit())
  }
  const quit = async () => {
    if (!await client.mayLeave()) return
    if (data.snapshot.allChatsBusy || data.snapshot.allChatsQueued) dialog.replace(() => <DialogConfirm title="Stop work and close Hot Cross Buns?" message="Tasks in all open chats will stop. Queues remain paused for review after restart." onConfirm={() => attempt(close())} />)
    else await close()
  }
  client.requestQuit = quit
  onCleanup(() => { if (client.requestQuit === quit) client.requestQuit = undefined })
  function approve(approved: boolean) {
    const pending = client.state?.pending_approval
    if (!pending) return
    const decide = () => attempt(client.send({ type: "approval", interaction_id: pending.id, approval_token: pending.token, approved }))
    if (!approved) { decide(); return }
    const context = client.context, message = client.state?.messages[pending.message_index]
    dialog.replace(() => <ApprovalReview pending={pending} message={message} context={context} />, undefined, { size: "xlarge" })
  }
  Keymap.createLayer(() => ({ mode: "global", commands: [
    { id: "command.palette.show", title: "Search commands", bind: "ctrl+p", run: palette },
    { id: "hot-cross-buns.sidebar", title: "Toggle navigation", bind: "ctrl+b", palette: true, run: () => attempt(client.configurePreferences({ sidebarCollapsed: !client.preferences.sidebarCollapsed })) },
    { id: "hot-cross-buns.quit", title: "Quit Hot Cross Buns", bind: "ctrl+q", palette: true, run: quit },
    { id: "hot-cross-buns.cancel", title: "Cancel dialog or stop active work", bind: "ctrl+c", palette: true, run: () => {
      if (dialog.stack.length) dialog.clear()
      else if (data.voicePhase !== "idle") voice.cancel()
      else if (data.state?.running) attempt(client.send({ type: "key", key: "esc" }))
    } },
    { id: "hot-cross-buns.new", title: "New independent chat", bind: "ctrl+n", palette: true, run: () => navigate("/new") },
    { id: "hot-cross-buns.search", title: "Search current transcript", bind: "ctrl+f", palette: true, enabled: !data.state?.panel, run: () => controls.trigger("search") },
    { id: "hot-cross-buns.latest", title: "Jump to latest content", bind: "ctrl+l", palette: true, enabled: data.route === "chat" && !data.state?.panel && dialog.stack.length === 0, run: () => client.emit("transcript-latest") },
    { id: "hot-cross-buns.context-actions", title: "Actions for visible result", bind: "ctrl+e", palette: true, enabled: data.route === "chat" && !data.state?.panel && dialog.stack.length === 0, run: () => client.emit("request-item-actions") },
    { id: "hot-cross-buns.help", title: "Hot Cross Buns help", bind: "ctrl+o", palette: true, enabled: !data.state?.panel, run: () => navigate("/help") },
    { id: "hot-cross-buns.voice", title: "Start or finish dictation", bind: "ctrl+v", palette: true, run: () => controls.trigger("toggle-dictation") },
    { id: "hot-cross-buns.approve", title: "Review current approval", bind: "ctrl+y", palette: true, enabled: dialog.stack.length === 0, run: () => approve(true) },
    { id: "hot-cross-buns.decline", title: "Decline current approval", bind: "ctrl+d", palette: true, enabled: dialog.stack.length === 0, run: () => approve(false) },
    { id: "hot-cross-buns.reconnect", title: "Reconnect selected chat", palette: true, run: () => attempt(client.reconnect()) },
    ...Object.keys(controls.actions).map(name => ({ id: `hot-cross-buns.local.${name}`, title: name, description: commandDescription(name), group: commandGroup(name), palette: true as const, run: () => controls.trigger(name) })),
    ...["following", "saved", "settings"].map(name => ({ id: `hot-cross-buns.${name}`, title: name[0].toUpperCase() + name.slice(1), palette: true as const, run: () => navigate(`/${name}`) })),
    // Only collapse known equivalent actions. Go's goal activity and the local
    // public-work trace share a name but are distinct capabilities.
    ...(data.state?.commands ?? []).filter(command => !["help", "queue", "following", "saved", "settings", "new", "exit", "cancel", "approve", "deny"].includes(command.name)).map(command => ({ id: `hot-cross-buns.command.${encodeURIComponent(command.name)}`, title: literal(command.description), group: command.name === "activity" ? "Following" : commandGroup(command.name), palette: true as const,
      slash: { name: command.name, aliases: commandAliases(command.name), ...(command.needs_input ? { arguments: true as const } : {}) },
      run: () => { const operation = runBackendCommand(client, controls, command); if (operation instanceof Promise) attempt(operation) } })),
  ] }))
  return <box width="100%" height="100%" backgroundColor={theme.background.base}>
    <box width="100%" height={1} marginY={1} paddingX={2} gap={1} flexDirection="row">
      <text flexShrink={0} fg={theme.text.base}><b>🐊 Hot Cross Buns</b></text>
      <text flexGrow={1} flexShrink={1} flexBasis={0} minWidth={0} height={1} wrapMode="none" truncate fg={theme.text.muted}>{literal(data.state?.title) || "Opening chat…"}</text>
      <ConnectionStatus connection={data.snapshot.connection} error={!!data.snapshot.error} />
    </box>
    <SessionFrame sidebar={!data.preferences.sidebarCollapsed} search={palette}>
      <Show when={data.route === "chat"} fallback={<Show when={data.route === "following"} fallback={<Hub />}><Following controls={controls} inspect={product.commitment} goal={product.goalCommitment} refresh={product.refreshChecks} /></Show>}><Show when={data.state?.panel} fallback={<><Transcript /><Prompt /></>}>{panel => <Panel panel={panel()} />}</Show></Show>
    </SessionFrame>
    <RecoveryNotice open={() => controls.trigger("recover")} />
    <VoiceNotice />
    <Show when={data.state?.external}><text fg={theme.accent}>A reviewed external step is ready. Use “continue-external” in Ctrl+P to continue and return to this chat.</text></Show>
    <Progress />
    <Show when={data.state?.status_line_enabled}><text fg={theme.text.muted}>{data.state?.status_line.map(literal).join(" · ")}</text></Show>
  </box>
}
function Themed(props: { client: HotCrossBunsClient; quit(): Promise<void>; clipboard: ClipboardService; voice?: VoiceSession }) {
  const data = useData()
  return <ThemeProvider theme={data.preferences.theme}><ConfigProvider bindings={terminalShortcuts(data.state?.desktop?.shortcuts)}>
    <ClipboardProvider value={props.clipboard}><Keymap.Provider><ToastProvider><DialogProvider><Shell quit={props.quit} voice={props.voice} /></DialogProvider></ToastProvider></Keymap.Provider></ClipboardProvider>
  </ConfigProvider></ThemeProvider>
}
export function App(props: { client: HotCrossBunsClient; quit(): Promise<void>; clipboard: ClipboardService; voice?: VoiceSession }) {
  return <ClientProvider client={props.client}><DataProvider><Themed {...props} /></DataProvider></ClientProvider>
}
