// Adapted from OpenCode's command palette. Configuration entries come from
// Hot Cross Buns's registered commands rather than upstream plugin/config discovery.
import { createMemo, createSignal, Show } from "solid-js"
import { DialogSelect } from "../ui/dialog-select"
import { Keymap, COMMAND_PALETTE_COMMAND } from "../context/keymap"
import { useDialog } from "../ui/dialog"
import { commandGroup, commandGroups } from "../hot-cross-buns/command-groups"
export function CommandPaletteDialog() {
  const commands = Keymap.useCommands(), shortcuts = Keymap.useShortcuts(), dialog = useDialog()
  const [section, setSection] = createSignal<string>()
  const [query, setQuery] = createSignal("")
  const options = createMemo(() => commands().flatMap(command => !command.id || !command.palette || command.id === COMMAND_PALETTE_COMMAND ? [] : [{
    title: (command.title ?? command.id).replaceAll("-", " ").toUpperCase(), description: command.description?.toUpperCase(), category: (command.group || commandGroup(command.id.replace(/^hot-cross-buns\./, ""))).toUpperCase(),
    searchText: [decodeURIComponent(command.id), command.title, command.description, command.slash?.name, ...(command.slash?.aliases ?? [])].filter(Boolean).join(" "), footer: shortcuts.all(command.id), value: command.id,
    onSelect: () => { dialog.clear(); void command.run() },
  }]))
  const roots = () => commandGroups.map(group => ({ title: group.toUpperCase(), description: "OPEN MENU →", value: `menu:${group}`, onSelect: () => { setQuery(""); setSection(group) } }))
  return <Show when={section()} keyed fallback={<DialogSelect title="HOT CROSS BUNS COMMANDS" searchInTitle titlePlaceholder="Search Hot Cross Buns commands"
    onFilter={setQuery} options={[...roots(), ...(query().trim() ? options().filter(option => !commandGroups.some(group => group.toLowerCase() === option.title.toLowerCase())) : [])]} flat />}>
    {group => <DialogSelect title={`HOT CROSS BUNS › ${group.toUpperCase()}`} placeholder={`Search ${group.toLowerCase()}`} onCancel={() => { setQuery(""); setSection(undefined) }}
      options={options().filter(option => option.category === group.toUpperCase())} flat />}
  </Show>
}
