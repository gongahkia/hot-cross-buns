import React from "react";
import { createRoot } from "react-dom/client";
import { SidebarApp } from "./SidebarApp";

createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <SidebarApp />
  </React.StrictMode>
);
