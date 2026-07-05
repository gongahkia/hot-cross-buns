export function extensionApi(): WebExtensionApi {
  const api =
    typeof browser !== "undefined"
      ? browser
      : typeof chrome !== "undefined"
        ? chrome
        : undefined;

  if (!api) {
    throw new Error("WebExtension API is unavailable.");
  }

  return api;
}

export function getRedirectUri(path = "google"): string {
  return extensionApi().identity.getRedirectURL(path);
}

export async function launchWebAuthFlow(url: string): Promise<string> {
  if (usesPromiseNamespace()) {
    const result = await extensionApi().identity.launchWebAuthFlow({ url, interactive: true });
    return requireString(result);
  }

  return callbackResult<string>((callback) =>
    callMethod(extensionApi().identity.launchWebAuthFlow, extensionApi().identity, [
      { url, interactive: true },
      callback
    ])
  );
}

export async function openOptionsPage(): Promise<void> {
  if (usesPromiseNamespace()) {
    await extensionApi().runtime.openOptionsPage();
    return;
  }

  await callbackResult<void>((callback) =>
    callMethod(extensionApi().runtime.openOptionsPage, extensionApi().runtime, [callback])
  );
}

export async function sendExtensionMessage<T>(message: unknown): Promise<T> {
  const response = usesPromiseNamespace()
    ? await extensionApi().runtime.sendMessage(message)
    : await callbackResult<unknown>((callback) =>
        callMethod(extensionApi().runtime.sendMessage, extensionApi().runtime, [message, callback])
      );

  if (!isResponseEnvelope(response)) {
    throw new Error("Extension message returned an invalid response.");
  }

  if (!response.ok) {
    throw new Error(response.error);
  }

  return response.data as T;
}

export async function storageGet<T>(areaName: "local" | "session", key: string): Promise<T | undefined> {
  const area = extensionApi().storage[areaName];

  if (!area) {
    return undefined;
  }

  const result = usesPromiseNamespace()
    ? await area.get(key) as Record<string, unknown>
    : await callbackResult<Record<string, unknown>>((callback) =>
        callMethod(area.get, area, [key, callback])
      );
  return result[key] as T | undefined;
}

export async function storageSet(areaName: "local" | "session", key: string, value: unknown): Promise<void> {
  const area = extensionApi().storage[areaName];

  if (!area) {
    return;
  }

  if (usesPromiseNamespace()) {
    await area.set({ [key]: value });
    return;
  }

  await callbackResult<void>((callback) => callMethod(area.set, area, [{ [key]: value }, callback]));
}

export async function storageRemove(areaName: "local" | "session", key: string): Promise<void> {
  const area = extensionApi().storage[areaName];

  if (!area) {
    return;
  }

  if (usesPromiseNamespace()) {
    await area.remove(key);
    return;
  }

  await callbackResult<void>((callback) => callMethod(area.remove, area, [key, callback]));
}

export function configureActionSidePanel(): void {
  const sidePanel = extensionApi().sidePanel;

  if (!sidePanel?.setPanelBehavior) {
    return;
  }

  void Promise.resolve(sidePanel.setPanelBehavior({ openPanelOnActionClick: true })).catch(() => undefined);
}

function callMethod(method: unknown, self: unknown, args: unknown[]): unknown {
  if (typeof method !== "function") {
    throw new Error("Required WebExtension method is unavailable.");
  }

  return method.apply(self, args);
}

function usesPromiseNamespace(): boolean {
  return typeof browser !== "undefined";
}

function requireString(value: unknown): string {
  if (typeof value !== "string") {
    throw new Error("Web auth flow did not return a redirect URL.");
  }

  return value;
}

function callbackResult<T>(invoke: (callback: (value: T) => void) => unknown): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const callback = (value: T) => {
      const error = extensionApi().runtime.lastError?.message;

      if (error) {
        settled = true;
        reject(new Error(error));
        return;
      }

      settled = true;
      resolve(value);
    };

    try {
      const result = invoke(callback);

      if (isPromiseLike<T>(result)) {
        void result.then(resolve, reject);
        return;
      }

      if (result !== undefined && !settled) {
        resolve(result as T);
      }
    } catch (error) {
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

function isPromiseLike<T>(value: unknown): value is Promise<T> {
  return typeof value === "object" && value !== null && "then" in value;
}

function isResponseEnvelope(value: unknown): value is { ok: true; data: unknown } | { ok: false; error: string } {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const record = value as Record<string, unknown>;
  return record.ok === true || (record.ok === false && typeof record.error === "string");
}
