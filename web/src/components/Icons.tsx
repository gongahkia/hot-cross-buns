import type { SVGProps } from "react";

export type IconName = "tasks" | "calendar" | "settings" | "health" | "search" | "sync" | "help" | "close" | "edit" | "trash" | "duplicate" | "external";

const paths: Readonly<Record<IconName, React.JSX.Element>> = {
  tasks: <><path d="M5 6h14M5 12h14M5 18h14" /><path d="m2.5 6 1 1 2-2M2.5 12l1 1 2-2M2.5 18l1 1 2-2" /></>,
  calendar: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M7 3v4M17 3v4M3 10h18" /></>,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.1 2.1-.06-.06a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1.03 1.55v.09h-3v-.09A1.7 1.7 0 0 0 10.7 18.6a1.7 1.7 0 0 0-1.88.34l-.06.06-2.1-2.1.06-.06A1.7 1.7 0 0 0 7.06 15 1.7 1.7 0 0 0 5.5 14H5.4v-3h.1A1.7 1.7 0 0 0 7.06 10a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.1-2.1.06.06A1.7 1.7 0 0 0 10.7 6.36 1.7 1.7 0 0 0 11.73 4.8v-.09h3v.09a1.7 1.7 0 0 0 1.03 1.56 1.7 1.7 0 0 0 1.88-.34l.06-.06 2.1 2.1-.06.06A1.7 1.7 0 0 0 19.4 10 1.7 1.7 0 0 0 21 11h.1v3H21A1.7 1.7 0 0 0 19.4 15Z" /></>,
  health: <><path d="M3 12h4l2-6 4 12 2-6h6" /></>,
  search: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 5 5" /></>,
  sync: <><path d="M20 7V3l-1.7 1.7A8 8 0 0 0 4.4 8M4 17v4l1.7-1.7A8 8 0 0 0 19.6 16" /></>,
  help: <><circle cx="12" cy="12" r="9" /><path d="M9.4 9a2.8 2.8 0 1 1 4.9 1.9c-1.2 1.2-2.3 1.6-2.3 3.1M12 17h.01" /></>,
  close: <path d="m6 6 12 12M18 6 6 18" />,
  edit: <><path d="m4 20 4.2-1 10-10a2.1 2.1 0 0 0-3-3l-10 10L4 20Z" /><path d="m13.5 7.5 3 3" /></>,
  trash: <><path d="M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14M10 11v6M14 11v6" /></>,
  duplicate: <><rect x="8" y="8" width="11" height="11" rx="2" /><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" /></>,
  external: <><path d="M14 4h6v6M20 4l-9 9" /><path d="M18 13v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h5" /></>
};

export function Icon({ name, title, ...props }: SVGProps<SVGSVGElement> & { readonly name: IconName; readonly title?: string }): React.JSX.Element {
  return <svg viewBox="0 0 24 24" aria-hidden={title ? undefined : true} role={title ? "img" : undefined} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...props}>{title && <title>{title}</title>}{paths[name]}</svg>;
}
