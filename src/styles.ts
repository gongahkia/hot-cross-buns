import styled, { createGlobalStyle, css } from 'styled-components';
import { textEntrySelector } from './textEntry';

export const GlobalStyle = createGlobalStyle`
  @font-face { font-family: 'JetBrains Mono'; src: url('/fonts/mono/jetbrainsmono.woff2') format('woff2'); font-style: normal; font-weight: 400; font-display: swap; }
  @property --circle-progress { syntax: '<percentage>'; inherits: false; initial-value: 0%; }
  @font-face { font-family: 'Inter'; src: url('/fonts/inter-latin-variable.woff2') format('woff2'); font-weight: 100 900; font-style: normal; font-display: swap; }
  @font-face { font-family: 'Inter'; src: url('/fonts/inter-latin-italic-variable.woff2') format('woff2'); font-weight: 100 900; font-style: italic; font-display: swap; }
  :root {
    --app-font: 'Inter', 'Helvetica Neue', Arial, sans-serif; --app-font-weight: 300;
    --raw-font: 'JetBrains Mono', ui-monospace, SFMono-Regular, Consolas, monospace;
    color-scheme: light;
    --paper: #f2f1ed; --ink: #242422; --muted: #626762; --line: #d4d2cb; --soft: #e8e6df;
    --surface: #faf9f6; --field: #fffefa; --date-bg: #dfe7ed; --tag-bg: #e8e6df; --tag-ink: #525a56; --tag-selected: #125f9b;
    --selection: #ccdbe7; --focus: #6f7f88; --link: #1871ba; --checkbox: #747773;
    --primary: #354047; --primary-hover: #49565d; --primary-ink: #ffffff;
    --danger: #99493b; --backdrop: #2d343033;
  }
  :root[data-theme='night'] {
    color-scheme: dark;
    --paper: #141414; --ink: #e8e8e8; --muted: #a8a8a8; --line: #373737; --soft: #2a2a2a;
    --surface: #1c1c1c; --field: #242424; --date-bg: #303030; --tag-bg: #262626; --tag-ink: #c7c7c7; --tag-selected: #e0e0e0;
    --selection: #4a4a4a; --focus: #9c9c9c; --link: #d0d0d0; --checkbox: #a0a0a0;
    --primary: #dedede; --primary-hover: #f5f5f5; --primary-ink: #181818;
    --danger: #f0aaa0; --backdrop: #00000099;
  }
  * { box-sizing: border-box; }
  html { background: var(--paper); -webkit-font-smoothing: antialiased; }
  body { margin: 0; color: var(--ink); background: var(--paper); font-family: var(--app-font); font-size: 18px; font-weight: var(--app-font-weight); line-height: 1.4; transition: background-color 160ms ease-out, color 160ms ease-out; }
  body:has(dialog[open]) { overflow: hidden; }
  button, input, textarea, select { font: inherit; color: inherit; }
  input { accent-color: var(--link); }
  button { -webkit-tap-highlight-color: transparent; }
  button:not(:disabled), summary { cursor: pointer; }
  button:disabled { cursor: not-allowed; opacity: .5; }
  :focus:not(:focus-visible) { outline: none; }
  :focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
  :root :is(${textEntrySelector}) { border: 0; border-radius: 0; caret-color: var(--ink); }
  :root :is(${textEntrySelector}):focus { outline: none; box-shadow: inset 0 -1px 0 var(--focus); }
  :root :is(${textEntrySelector}):focus-visible { outline: none; box-shadow: inset 0 -2px 0 var(--focus); }
  @keyframes hcb-caret-pulse {
    0%, 35%, 100% { caret-color: var(--ink); }
    68% { caret-color: transparent; }
  }
  @keyframes hcb-moving-caret-pulse {
    0%, 35%, 100% { opacity: 1; }
    68% { opacity: 0; }
  }
  [data-moving-caret] {
    position: fixed; inset: auto; left: 0; top: 0; margin: 0; padding: 0; border: 0;
    width: 2px; border-radius: 1px; background: var(--ink); pointer-events: none;
    overflow: clip; z-index: 2147483647;
    animation: hcb-moving-caret-pulse 1350ms ease-in-out infinite;
  }
  [data-moving-caret]::backdrop { background: transparent; pointer-events: none; }
  [data-moving-caret][data-caret-typing] { animation: none; opacity: 1; }
  :root :is(${textEntrySelector})[data-smooth-caret='true'] { caret-color: transparent !important; }
  @media (prefers-reduced-motion: reduce), (forced-colors: active) {
    [data-moving-caret] { display: none !important; }
    :root :is(${textEntrySelector})[data-smooth-caret='true'] { caret-color: var(--ink) !important; }
  }
  @supports (caret-animation: manual) {
    @media (prefers-reduced-motion: no-preference) {
      :root :is(${textEntrySelector}):not([readonly]):not(:disabled):focus {
        caret-animation: manual;
        animation: hcb-caret-pulse 1350ms ease-in-out infinite;
      }
      :root :is(${textEntrySelector}):not([readonly]):not(:disabled)[data-caret-typing='true']:focus {
        animation: none; caret-color: var(--ink);
      }
    }
    @media (prefers-reduced-motion: reduce) {
      :root :is(${textEntrySelector}):focus { animation: none !important; caret-animation: manual; caret-color: var(--ink); }
    }
  }
  @media (forced-colors: active) {
    :root :is(${textEntrySelector}):focus { border-bottom: 2px solid Highlight; caret-color: CanvasText !important; }
  }
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
  width: 100%; min-height: 44px; border: 0; border-radius: 0;
  padding: 8px 11px; background: var(--field); font-size: 14px; min-width: 0;
  @media(pointer:coarse) { font-size: 16px; }
`;
export const InlineError = styled.p`font-size: 13px; color: var(--danger); margin: 12px 0;`;
export const VisuallyHidden = styled.span`
  position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden;
  clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0;
`;
