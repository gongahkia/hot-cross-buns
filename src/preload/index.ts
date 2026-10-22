import { contextBridge, ipcRenderer } from "electron";
import { createHcbApi } from "./bridge";

contextBridge.exposeInMainWorld("hcb", createHcbApi({
  invoke: (channel, payload) => ipcRenderer.invoke(channel, payload),
  subscribe: (channel, listener) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: unknown) => listener(payload);
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.removeListener(channel, handler);
  }
}));
