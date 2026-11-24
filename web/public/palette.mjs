import { element } from "./text.mjs";

export function installPalette(commands, chats = async () => ({ items: [] }), find) {
  const dialog = element("dialog", undefined, "command-palette");
  dialog.setAttribute("aria-label", "Commands");
  dialog.inert = true;
  const label = element("label", "Commands", "sr-only");
  const input = element("input");
  input.id = "command-search";
  input.placeholder = "Search commands…";
  input.autocomplete = "off";
  input.setAttribute("role", "combobox");
  input.setAttribute("aria-autocomplete", "list");
  input.setAttribute("aria-controls", "command-results");
  input.setAttribute("aria-expanded", "true");
  label.htmlFor = input.id;
  const results = element("div");
  results.id = "command-results";
  results.setAttribute("role", "listbox");
  const empty = element("p", "No matches", "palette-empty hint");
  const footer = element("div", "↑ ↓ to move · Enter to open · Esc to close", "palette-footer hint");
  empty.setAttribute("role", "status");
  dialog.append(label, input, results, empty, footer);
  document.body.append(dialog);
  let items = [], selected = 0, returnFocus, pendingAction, mode = "commands", generation = 0;

  function select(index) {
    selected = (index + items.length) % items.length;
    [...results.children].forEach((node, i) => node.setAttribute("aria-selected", String(i === selected)));
    const active = results.children[selected];
    if (active) {
      input.setAttribute("aria-activedescendant", active.id);
      active.scrollIntoView?.({ block: "nearest" });
    } else input.removeAttribute("aria-activedescendant");
  }
  function run(index) {
    const item = items[index];
    if (!item) return;
    pendingAction = item.action;
    dialog.close();
  }
  async function render() {
    const owned = ++generation;
    results.hidden = mode === "find" && !input.value;
    const query = input.value.trim().toLowerCase();
    const terms = query.split(/\s+/);
    const matches = value => terms.every(term => value.toLowerCase().includes(term));
    if (mode === "chats") {
      items = [];
      results.replaceChildren();
      input.removeAttribute("aria-activedescendant");
      empty.textContent = "Loading chats…";
      empty.hidden = false;
      results.setAttribute("aria-busy", "true");
      try {
        const page = await chats(input.value.trim());
        if (owned !== generation) return;
        items = page.items.slice(0, 30);
        footer.textContent = page.notice || "↑ ↓ to move · Enter to open · Esc to close";
      } catch (error) {
        if (owned !== generation) return;
        empty.textContent = error.message;
        results.removeAttribute("aria-busy");
        return;
      }
    } else if (mode === "find") {
      const page = find.search(input.value);
      items = page.items;
      footer.textContent = page.notice || "↑ ↓ to move · Enter to open · Esc to close";
    } else items = commands().filter(item => matches(item.label + " " + (item.group || ""))).slice(0, 30);
    results.removeAttribute("aria-busy");
    empty.textContent = mode === "find" ? "No matches in this chat" : mode === "chats" ? "No matching chats" : "No matching commands";
    results.replaceChildren(...items.map((item, index) => {
      const option = element("button", undefined, "palette-option");
      option.type = "button";
      option.id = "command-result-" + index;
      option.tabIndex = -1;
      option.setAttribute("role", "option");
      option.append(element("span", item.label), element("small", item.group || "Command"));
      option.addEventListener("click", () => run(index));
      option.addEventListener("pointermove", () => select(index));
      return option;
    }));
    empty.hidden = !!items.length || mode === "find" && !input.value;
    select(0);
  }
  function open(nextMode = "commands") {
    if (pendingAction || document.querySelector('dialog[open]') && !dialog.open) return;
    if (!dialog.open) returnFocus = document.activeElement;
    if (mode === "find" && nextMode !== mode) find.close();
    mode = nextMode;
    const title = mode === "find" ? "Find in this chat" : mode === "chats" ? "Chats" : "Commands";
    dialog.setAttribute("aria-label", title);
    label.textContent = title;
    input.placeholder = mode === "find" ? "Find in this chat…" : mode === "chats" ? "Search chats…" : "Search commands…";
    footer.textContent = "↑ ↓ to move · Enter to open · Esc to close";
    input.value = "";
    render();
    dialog.inert = false;
    if (!dialog.open) dialog.showModal();
    input.focus();
  }
  input.addEventListener("input", render);
  input.addEventListener("keydown", event => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (items.length) select(selected + (event.key === "ArrowDown" ? 1 : -1));
    } else if (event.key === "Enter") { event.preventDefault(); run(selected); }
  });
  dialog.addEventListener("close", () => {
    // a quick reopen may precede the queued native close event.
    if (dialog.open) return;
    generation++;
    if (mode === "find" && !pendingAction) find.close();
    dialog.inert = true;
    returnFocus?.focus({ preventScroll: true });
    const action = pendingAction;
    pendingAction = undefined;
    action?.();
  });
  dialog.addEventListener("click", event => {
    if (event.target !== dialog) return;
    const bounds = dialog.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) dialog.close();
  });
  window.addEventListener("keydown", event => {
    if (event.isComposing || event.altKey || event.shiftKey || !(event.metaKey || event.ctrlKey)) return;
    const key = event.key.toLowerCase();
    if (key !== "k" && key !== "p" && (key !== "f" || !find)) return;
    event.preventDefault();
    const nextMode = key === "f" ? "find" : key === "p" ? "chats" : "commands";
    if (dialog.open && mode === nextMode) dialog.close(); else open(nextMode);
  }, { capture: true });
  if (find) {
    document.addEventListener('open-chat-find', () => open('find'));
    document.addEventListener('chat-find-context-changed', () => {
      if (mode === 'find' && dialog.open) dialog.close();
    });
  }
  document.getElementById("open-palette")?.addEventListener("click", () => open());
}
