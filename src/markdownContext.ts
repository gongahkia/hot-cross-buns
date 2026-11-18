import { createContext } from 'react';
import type { MarkdownIndex, MarkdownNode } from './markdown.ts';
import type { MarkdownNavigation, MarkdownTarget } from './markdownNavigation.ts';

export type MarkdownContextValue = {
  id: string; source: string; index?: MarkdownIndex;
  bodyViews?: Record<string, MarkdownNode>;
  navigate?: (fragment: string) => void;
  jump?: (target: MarkdownTarget) => void;
  navigation?: MarkdownNavigation;
};
export const MarkdownDocumentContext = createContext<MarkdownContextValue>({ id: '', source: '' });
