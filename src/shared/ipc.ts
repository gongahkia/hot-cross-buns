export const IPC_CHANNELS = {
  core: {
    invoke: "hcb:core:invoke",
    syncStatus: "hcb:core:sync-status"
  },
  diagnostics: {
    health: "hcb:diagnostics:health",
    markShellVisible: "hcb:diagnostics:mark-shell-visible"
  },
  planner: {
    workspace: "hcb:planner:workspace",
    listTasks: "hcb:planner:list-tasks",
    saveTask: "hcb:planner:save-task",
    completeTask: "hcb:planner:complete-task",
    syncStatus: "hcb:planner:sync-status"
  },
  settings: {
    get: "hcb:settings:get",
    save: "hcb:settings:save",
    dataInfo: "hcb:settings:data-info"
  }
} as const;
