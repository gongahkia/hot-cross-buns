# Bundled fonts

The interface uses **Inter**, distributed under the [SIL Open Font License 1.1](./inter.LICENSE.txt). Both Latin variable WOFF2 files are unmodified copies from [`@fontsource-variable/inter` 5.3.0](https://www.npmjs.com/package/@fontsource-variable/inter/v/5.3.0), maintained in the [Fontsource font-files repository](https://github.com/fontsource/font-files/tree/main/fonts/variable/inter). The original typeface is by [the Inter Project Authors](https://github.com/rsms/inter).

| Local file | Package file |
| --- | --- |
| `inter-latin-variable.woff2` | `files/inter-latin-wght-normal.woff2` |
| `inter-latin-italic-variable.woff2` | `files/inter-latin-wght-italic.woff2` |
| `inter.LICENSE.txt` | `LICENSE` |

These files support weights 100–900 in normal and italic styles. The CSS keeps system font fallbacks for characters outside the Latin subset. Fonts are served locally; the app does not contact a font CDN.

The TODO.txt preview, import doctor and save-recovery text use **JetBrains Mono** from the [Google Fonts repository](https://github.com/google/fonts/tree/main/ofl/jetbrainsmono). Its [OFL 1.1 license](./mono/jetbrainsmono.LICENSE.txt) is included beside the font in `mono/`.
