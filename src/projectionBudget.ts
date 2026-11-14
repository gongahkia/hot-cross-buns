export const MAX_PROJECTION_WORK = 100_000;
export const MAX_VISIBLE_ROWS = 5_000;

export class ProjectionLimitError extends Error {
  constructor() {
    super('This view contains too many items or repeated spans. Choose fewer dates, limit earlier unfinished items to the visible range, or download TODO.txt to review the journal.');
  }
}

export function createProjectionBudget(limits: { maxWork?: number; maxRows?: number } = {}) {
  let work = 0;
  let rows = 0;
  return {
    work: (count = 1) => { if ((work += count) > (limits.maxWork ?? MAX_PROJECTION_WORK)) throw new ProjectionLimitError(); },
    rows: (count = 1) => { if ((rows += count) > (limits.maxRows ?? MAX_VISIBLE_ROWS)) throw new ProjectionLimitError(); },
  };
}
export type ProjectionBudget = ReturnType<typeof createProjectionBudget>;

export function readProjection<T>(read: () => T, fallback: T): { value: T; error: string | null } {
  try { return { value: read(), error: null }; }
  catch (error) {
    if (!(error instanceof ProjectionLimitError)) throw error;
    return { value: fallback, error: error.message };
  }
}
