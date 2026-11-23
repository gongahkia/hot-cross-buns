import {
  createElement, Plus, ArrowUp, X, ChevronDown, ChevronRight, ChevronLeft, Clock, Workflow,
  FileText, FolderSearch, Search, Globe, Terminal, Code, Pencil, NotebookPen,
  Table, Presentation, ChartNoAxesCombined, CalendarDays, Mail, Brain,
  Lightbulb, ListChecks, BookOpen, Check, CircleDashed, CircleAlert, Pause,
  Square, WifiOff, Copy, LoaderCircle, Link, Bookmark, Settings, Eye, History,
  Cpu, Trash2, RotateCcw, RefreshCw, Play, ArrowDown, ChevronUp, Power, Download,
} from 'lucide';
import activityIcons from '../internal/workactivity/icon-names.json' with { type: 'json' };

const catalog = {
  plus: Plus, 'arrow-up': ArrowUp, x: X, 'chevron-down': ChevronDown, 'chevron-right': ChevronRight, 'chevron-left': ChevronLeft,
  clock: Clock, workflow: Workflow, 'file-text': FileText, 'folder-search': FolderSearch,
  search: Search, globe: Globe, terminal: Terminal, code: Code, pencil: Pencil,
  'notebook-pen': NotebookPen, table: Table, presentation: Presentation,
  'chart-no-axes-combined': ChartNoAxesCombined, 'calendar-days': CalendarDays, mail: Mail,
  brain: Brain, lightbulb: Lightbulb, 'list-checks': ListChecks, 'book-open': BookOpen,
  check: Check, 'circle-dashed': CircleDashed, 'circle-alert': CircleAlert, pause: Pause,
  square: Square, 'wifi-off': WifiOff, copy: Copy, 'loader-circle': LoaderCircle,
  link: Link, bookmark: Bookmark, settings: Settings, eye: Eye, history: History,
  power: Power, download: Download, cpu: Cpu, 'trash-2': Trash2, 'rotate-ccw': RotateCcw, 'refresh-cw': RefreshCw, play: Play, 'arrow-down': ArrowDown, 'chevron-up': ChevronUp,
};
const aliases = { send: 'arrow-up', close: 'x', chevron: 'chevron-down', helpers: 'workflow', file: 'file-text' };
export const activityIconNames = Object.freeze(activityIcons);
export function icon(name) {
  const selected = aliases[name] || name;
  const safe = Object.hasOwn(catalog, selected) ? selected : 'circle-dashed';
  return createElement(catalog[safe], { class: 'app-icon', 'data-icon': safe, width: 16, height: 16, 'stroke-width': 1.6, 'aria-hidden': 'true', focusable: 'false' });
}
export function setIcon(node, name) {
  if (node.dataset.iconName === name) return;
  node.dataset.iconName = name; node.replaceChildren(icon(name));
}
export function activityIcon(tool = '', selected) {
  if (activityIconNames.includes(selected)) return selected;
  if (/agent/.test(tool)) return 'workflow';
  if (/command|terminal/.test(tool)) return 'terminal';
  if (/search/.test(tool)) return /files/.test(tool) ? 'folder-search' : 'search';
  if (/web|fetch|evidence/.test(tool)) return 'globe';
  if (/patch|edit/.test(tool)) return 'pencil';
  if (/table|workbook/.test(tool)) return 'table';
  if (/presentation/.test(tool)) return 'presentation';
  if (/calendar|schedule|agenda/.test(tool)) return 'calendar-days';
  if (/memory|knowledge/.test(tool)) return 'brain';
  return 'file-text';
}
export function decorateIcons(root = document) {
  for (const node of root.querySelectorAll('[data-ui-icon]')) {
    if (!node.querySelector('.app-icon')) node.prepend(icon(node.dataset.uiIcon));
  }
}
