import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { installBrowserBridge } from "../../browser/bridge";
import "./styles/index.css";
import "./styles/fonts.css";

void installBrowserBridge().then(() => ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
));
