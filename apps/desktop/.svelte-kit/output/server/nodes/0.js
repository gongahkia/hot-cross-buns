

export const index = 0;
let component_cache;
export const component = async () => component_cache ??= (await import('../entries/pages/_layout.svelte.js')).default;
export const universal = {
  "ssr": false
};
export const universal_id = "src/routes/+layout.ts";
export const imports = ["_app/immutable/nodes/0._lY9tVC8.js","_app/immutable/chunks/DwfApId-.js","_app/immutable/chunks/5dEc8SCr.js","_app/immutable/chunks/N7vJ_rYB.js","_app/immutable/chunks/BU-9P7BB.js"];
export const stylesheets = ["_app/immutable/assets/0.XngoAnza.css"];
export const fonts = [];
