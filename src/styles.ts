import styled, { createGlobalStyle, css } from 'styled-components';

export const GlobalStyle = createGlobalStyle`
  @property --circle-progress { syntax: '<percentage>'; inherits: false; initial-value: 0%; }
  @font-face { font-family: 'Sohne'; src: url('/fonts/sohne-variable.woff2') format('woff2'); font-weight: 100 900; font-style: normal; font-display: swap; }
  @font-face { font-family: 'Sohne'; src: url('/fonts/sohne-italic.woff2') format('woff2'); font-weight: 400; font-style: italic; font-display: swap; }
  @font-face { font-family: 'DM Sans'; src: url('/fonts/dm-sans.ttf') format('truetype'); font-weight: 400; font-style: normal; font-display: swap; }
  @font-face { font-family: 'DM Sans'; src: url('/fonts/dm-sans-semibold.ttf') format('truetype'); font-weight: 600; font-style: normal; font-display: swap; }
  @font-face { font-family: 'Lora'; src: url('/fonts/lora.ttf') format('truetype'); font-weight: 400; font-style: normal; font-display: swap; }
  @font-face { font-family: 'Lora'; src: url('/fonts/lora-italic.ttf') format('truetype'); font-weight: 400; font-style: italic; font-display: swap; }
  :root {
    --app-font: 'Sohne', 'Helvetica Neue', Arial, sans-serif; --app-font-weight: 300;
    color-scheme: light;
    --paper: #f2f1ed; --ink: #242422; --muted: #626762; --line: #d4d2cb; --soft: #e8e6df;
    --surface: #faf9f6; --field: #fffefa; --date-bg: #dfe7ed; --tag-bg: #e8e6df; --tag-ink: #525a56; --tag-selected: #125f9b;
    --selection: #ccdbe7; --focus: #6f7f88; --link: #1871ba; --checkbox: #747773;
    --primary: #354047; --primary-hover: #49565d; --primary-ink: #ffffff;
    --danger: #99493b; --backdrop: #2d343033;
  }
  :root[data-font='dm-sans'] { --app-font: 'DM Sans', system-ui, sans-serif; --app-font-weight: 400; }
  :root[data-font='lora'] { --app-font: 'Lora', Georgia, serif; --app-font-weight: 400; }
  :root[data-font='system'] { --app-font: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; --app-font-weight: 400; }
  :root[data-theme='night'] {
    color-scheme: dark;
    --paper: #011627; --ink: #c0c7d1; --muted: #a3b0bf; --line: #294559; --soft: #193447;
    --surface: #0a2133; --field: #102a3f; --date-bg: #173449; --tag-bg: #26394a; --tag-ink: #c0c7d1; --tag-selected: #75d1c4;
    --selection: #315366; --focus: #75d1c4; --link: #75d1c4; --checkbox: #8ca0b0;
    --primary: #75d1c4; --primary-hover: #9ddece; --primary-ink: #011627;
    --danger: #efaa9c; --backdrop: #000b16aa;
  }
  * { box-sizing: border-box; }
  html { background: var(--paper); -webkit-font-smoothing: antialiased; }
  body { margin: 0; color: var(--ink); background: var(--paper); font-family: var(--app-font); font-size: 18px; font-weight: var(--app-font-weight); line-height: 1.4; transition: background-color 160ms ease-out, color 160ms ease-out; }
  body:has(dialog[open]) { overflow: hidden; }
  button, input, textarea, select { font: inherit; color: inherit; }
  button { -webkit-tap-highlight-color: transparent; }
  button:not(:disabled), summary { cursor: pointer; }
  button:disabled { cursor: not-allowed; opacity: .5; }
  :focus:not(:focus-visible) { outline: none; }
  :focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
  .skip-link { position: fixed; z-index: 100; top: 8px; left: 8px; padding: 8px 12px; border-radius: 6px; background: var(--surface); color: var(--ink); transform: translateY(-150%); }
  .skip-link:focus { transform: translateY(0); }
  ::selection { background: var(--selection); }
  h1, h2, h3, p { margin: 0; }
  h1, h2, h3 { text-wrap: balance; font-weight: 400; }
  p, li { text-wrap: pretty; }
  svg { flex-shrink: 0; stroke-width: 1.5; }
  a { color: inherit; }
  ::view-transition-group(*) { animation-duration: 220ms; animation-timing-function: cubic-bezier(.2, 0, 0, 1); }
  ::view-transition-old(*), ::view-transition-new(*) { animation-duration: 180ms; animation-timing-function: ease-out; }
  ::view-transition-group(root), ::view-transition-old(root), ::view-transition-new(root) { animation-duration: 0s; }
  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after { animation-duration: .01ms !important; transition-duration: .01ms !important; scroll-behavior: auto !important; }
  }
`;

export const press = css`
  transition: background-color 120ms ease-out, color 120ms ease-out, scale 150ms ease-out;
  &:active:not(:disabled) { scale: .96; }
`;
export const IconButton = styled.button`
  ${press}; width: 44px; height: 44px; display: inline-flex; justify-content: center; align-items: center;
  border: 0; border-radius: 50%; background: transparent; color: var(--muted); flex-shrink: 0;
  &:hover { background: var(--soft); color: var(--ink); }
`;
export const Button = styled.button<{ $primary?: boolean }>`
  ${press}; min-height: 44px; padding: 8px 17px; display: inline-flex; justify-content: center; align-items: center; gap: 8px;
  border: 0; border-radius: 8px; background: ${({ $primary }) => $primary ? 'var(--primary)' : 'var(--soft)'};
  color: ${({ $primary }) => $primary ? 'var(--primary-ink)' : 'var(--ink)'}; font-size: 13px;
  &:hover { background: ${({ $primary }) => $primary ? 'var(--primary-hover)' : 'var(--date-bg)'}; }
`;
export const Muted = styled.p`font-size: 13px; color: var(--muted);`;
export const Field = styled.input`
  width: 100%; min-height: 44px; border: 1px solid var(--line); border-radius: 7px;
  padding: 8px 11px; background: var(--field); font-size: 14px; min-width: 0;
`;
export const InlineError = styled.p`font-size: 13px; color: var(--danger); margin: 12px 0;`;
export const VisuallyHidden = styled.span`
  position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden;
  clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0;
`;
