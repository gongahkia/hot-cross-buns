import { decorateIcons } from './icons.mjs';
decorateIcons();

const preview = new URLSearchParams(location.search).get("preview");
const app = await import(preview === "outputs" ? "./preview.mjs" : preview === "memory" ? "./memory-preview.mjs" : "./client.mjs");
const { installPalette } = await import("./palette.mjs");
installPalette(app.paletteCommands);

const { installSmoothCaret } = await import("./caret.mjs");
installSmoothCaret();
