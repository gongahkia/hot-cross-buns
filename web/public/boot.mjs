import { decorateIcons } from './icons.mjs';
decorateIcons();

const app = await import('./client.mjs');
const { installPalette } = await import("./palette.mjs");
installPalette(app.paletteCommands, app.paletteChats, app.find);

const { installSmoothCaret } = await import("./caret.mjs");
installSmoothCaret();
