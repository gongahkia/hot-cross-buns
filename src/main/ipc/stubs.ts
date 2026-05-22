import { ipcContracts, type IpcContract } from "@shared/ipc/contracts";
import { notImplemented } from "@shared/ipc/result";
import type { IpcHandlerDefinition } from "./registry";

function stub(contract: IpcContract, message: string): IpcHandlerDefinition {
  return {
    contract,
    handle: () => {
      throw notImplemented(message);
    }
  };
}

export function createStubIpcHandlers(): IpcHandlerDefinition[] {
  return [
    stub(ipcContracts.tasks.list, "Task listing is not implemented yet"),
    stub(ipcContracts.tasks.get, "Task detail loading is not implemented yet"),
    stub(ipcContracts.calendar.listEvents, "Calendar range loading is not implemented yet"),
    stub(ipcContracts.notes.list, "Note listing is not implemented yet"),
    stub(ipcContracts.notes.get, "Note detail loading is not implemented yet"),
    stub(ipcContracts.search.query, "Search is not implemented yet"),
    stub(ipcContracts.sync.status, "Sync status is not implemented yet"),
    stub(ipcContracts.sync.runNow, "Manual sync is not implemented yet"),
    stub(ipcContracts.settings.get, "Settings loading is not implemented yet"),
    stub(ipcContracts.settings.update, "Settings updates are not implemented yet"),
    stub(ipcContracts.mcp.status, "MCP status is not implemented yet"),
    stub(ipcContracts.mcp.setEnabled, "MCP settings updates are not implemented yet"),
    stub(ipcContracts.native.capabilities, "Native capability reporting is not implemented yet"),
    stub(
      ipcContracts.native.requestNotificationPermission,
      "Notification permission requests are not implemented yet"
    )
  ];
}
