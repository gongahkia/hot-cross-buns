import { Extension, type Editor } from "@tiptap/core";
import { closeHistory, history, redo, undo } from "@tiptap/pm/history";
import type { Plugin } from "@tiptap/pm/state";

const histories = new WeakMap<Editor, Plugin>();

// Keep the plugin reference so replacing a document can reset just its history,
// without recreating the editor or disturbing table/suggestion plugin state.
export const MarkdownHistory = Extension.create({
  name: "markdownHistory",
  addProseMirrorPlugins() {
    const plugin = history(); histories.set(this.editor, plugin); return [plugin];
  },
  addCommands() {
    return {
      undo: () => ({ state, dispatch }) => undo(state, dispatch),
      redo: () => ({ state, dispatch }) => redo(state, dispatch)
    };
  },
  addKeyboardShortcuts() {
    return { "Mod-z": () => this.editor.commands.undo(), "Shift-Mod-z": () => this.editor.commands.redo(), "Mod-y": () => this.editor.commands.redo() };
  }
});

export function resetMarkdownHistory(editor: Editor): void {
  const plugin = histories.get(editor);
  if (!plugin) return;
  const plugins = editor.state.plugins;
  editor.view.updateState(editor.state.reconfigure({ plugins: plugins.filter((entry) => entry !== plugin) }).reconfigure({ plugins }));
}

export function closeMarkdownHistoryGroup(editor: Editor): void {
  editor.view.dispatch(closeHistory(editor.state.tr));
}
