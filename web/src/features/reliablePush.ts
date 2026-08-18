export type PushContentMode = "details" | "generic";

const storageKey = "hcb-reliable-push-content-mode";

function applicationServerKey(value: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - value.length % 4) % 4);
  const base64 = (value + padding).replaceAll("-", "+").replaceAll("_", "/");
  const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
  return bytes;
}

export function reliablePushSupported(): boolean {
  return window.isSecureContext && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

export function savedPushContentMode(): PushContentMode {
  return window.localStorage.getItem(storageKey) === "generic" ? "generic" : "details";
}

export async function enableReliablePush(contentMode: PushContentMode): Promise<void> {
  if (!reliablePushSupported()) throw new Error("This browser does not support background Web Push; foreground reminders remain available while the PWA is open");
  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new Error("Notifications were not enabled; foreground reminders remain available while the PWA is open");
  const keyResponse = await fetch("/api/push/public-key", { credentials: "include" });
  if (!keyResponse.ok) throw new Error("This self-hosted deployment has not enabled Web Push");
  const { publicKey } = await keyResponse.json() as { readonly publicKey?: string };
  if (!publicKey) throw new Error("This self-hosted deployment returned an invalid Web Push key");
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: applicationServerKey(publicKey) });
  const response = await fetch("/api/push/subscription", {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ subscription: subscription.toJSON(), contentMode })
  });
  if (!response.ok) throw new Error("The self-hosted deployment could not save this device's Web Push subscription");
  window.localStorage.setItem(storageKey, contentMode);
}
