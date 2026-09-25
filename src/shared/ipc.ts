export const IPC_CHANNELS = {
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
  }
} as const;
