import { createContext, useContext, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { PaneIdentity } from "./panePreferences";

export const WorkspaceSidebarContext = createContext<{
  target: HTMLElement | null;
  focusedPaneId: string;
  collapsed: boolean;
  toggle: () => void;
} | null>(null);

export function useWorkspaceSidebar() {
  const sidebar = useContext(WorkspaceSidebarContext);
  const paneId = useContext(PaneIdentity);
  return sidebar?.target && sidebar.focusedPaneId === paneId ? sidebar : null;
}

export function SectionSidebar({ children }: { children: ReactNode }): JSX.Element {
  const sidebar = useWorkspaceSidebar();
  return sidebar?.target ? createPortal(children, sidebar.target) : <>{children}</>;
}
