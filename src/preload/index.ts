import { contextBridge, ipcRenderer } from "electron";
import { createHcbApi } from "./bridge";

contextBridge.exposeInMainWorld("hcb", createHcbApi(ipcRenderer));
