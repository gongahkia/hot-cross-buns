/// <reference types="vite/client" />

import type { HcbApi } from "@shared/preloadApi";

declare global {
  interface Window {
    hcb?: HcbApi;
  }
}

export {};
