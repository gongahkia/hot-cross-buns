declare module "markdown-it-emoji" {
  import type MarkdownIt from "markdown-it";

  export const full: (markdown: MarkdownIt) => void;
}
