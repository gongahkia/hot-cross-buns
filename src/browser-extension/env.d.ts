interface WebExtensionRuntimeError {
  message?: string;
}

interface WebExtensionRuntime {
  id: string;
  lastError?: WebExtensionRuntimeError;
  getURL(path: string): string;
  openOptionsPage(callback?: () => void): Promise<void> | void;
  sendMessage(message: unknown, callback?: (response: unknown) => void): Promise<unknown> | void;
  onMessage: {
    addListener(
      listener: (
        message: unknown,
        sender: unknown,
        sendResponse: (response: unknown) => void
      ) => boolean | void | Promise<unknown>
    ): void;
  };
}

interface WebExtensionIdentity {
  getRedirectURL(path?: string): string;
  launchWebAuthFlow(
    details: { url: string; interactive: boolean },
    callback?: (redirectUrl?: string) => void
  ): Promise<string> | void;
}

interface WebExtensionStorageArea {
  get(
    keys?: string | string[] | Record<string, unknown> | null,
    callback?: (items: Record<string, unknown>) => void
  ): Promise<Record<string, unknown>> | void;
  set(items: Record<string, unknown>, callback?: () => void): Promise<void> | void;
  remove(keys: string | string[], callback?: () => void): Promise<void> | void;
}

interface WebExtensionStorage {
  local: WebExtensionStorageArea;
  session?: WebExtensionStorageArea;
}

interface WebExtensionSidePanel {
  setPanelBehavior(options: { openPanelOnActionClick: boolean }): Promise<void> | void;
}

interface WebExtensionApi {
  runtime: WebExtensionRuntime;
  identity: WebExtensionIdentity;
  storage: WebExtensionStorage;
  sidePanel?: WebExtensionSidePanel;
}

declare const browser: WebExtensionApi | undefined;
declare const chrome: WebExtensionApi | undefined;
