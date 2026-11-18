import { createContext } from 'react';
import type { MarkdownIndex, MarkdownNode } from './markdown.ts';

export type MarkdownContextValue = {
  id: string; source: string; index?: MarkdownIndex;
  bodyViews?: Record<string, MarkdownNode>;
  navigate?: (fragment: string) => void;
};
export const MarkdownDocumentContext = createContext<MarkdownContextValue>({ id: '', source: '' });
