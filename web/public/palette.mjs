import { element } from "./text.mjs";

export function installPalette(commands) {
  const dialog = element("dialog", undefined, "command-palette");
  dialog.setAttribute("aria-label", "Search and commands");
  dialog.inert = true;
  const label = element("label", "Search and commands", "sr-only");
  const input = element("input");
  input.id = "command-search";
  input.placeholder = "Search commands, recent chats, this conversation…";
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
  dialog.append(label, input, results, empty, footer);
  document.body.append(dialog);
  let items = [], selected = 0, returnFocus, pendingAction;

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
  function render() {
    const query = input.value.trim().toLowerCase();
    const terms = query.split(/\s+/);
    const matches = value => terms.every(term => value.toLowerCase().includes(term));
    items = commands().filter(item => matches(item.label + " " + (item.group || "")));
    if (query) {
      const messages = [...document.querySelectorAll("#transcript .turn")];
      for (const message of messages) {
        const text = message.textContent.trim();
        if (!matches(text)) continue;
        const at = Math.max(0, text.toLowerCase().indexOf(terms[0]) - 35);
        items.push({ label: text.slice(at, at + 110), group: "This conversation", action: () => {
          message.scrollIntoView({ behavior: "smooth", block: "center" });
          message.tabIndex = -1;
          message.focus({ preventScroll: true });
          message.classList.add("search-hit");
          setTimeout(() => message.classList.remove("search-hit"), 1800);
        } });
      }
    }
    items = items.slice(0, 30);
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
    empty.hidden = !!items.length;
    select(0);
  }
  function open() {
    if (dialog.open || pendingAction) return;
    returnFocus = document.activeElement;
    input.value = "";
    render();
    dialog.inert = false;
    dialog.showModal();
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
  document.addEventListener("keydown", event => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      if (dialog.open) dialog.close(); else open();
    }
  });
  document.getElementById("open-palette")?.addEventListener("click", open);
}
