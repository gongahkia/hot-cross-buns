export function taskListLocalId(accountId: string, googleId: string): string {
  return `${accountId}:task-list:${googleId}`;
}

export function taskLocalId(accountId: string, taskListGoogleId: string, googleId: string): string {
  return `${accountId}:task:${taskListGoogleId}:${googleId}`;
}

export function calendarLocalId(accountId: string, googleId: string): string {
  return `${accountId}:calendar:${googleId}`;
}

export function eventLocalId(accountId: string, calendarGoogleId: string, googleId: string): string {
  return `${accountId}:event:${calendarGoogleId}:${googleId}`;
}

export function checkpointId(
  accountId: string,
  resourceType: string,
  resourceId: string,
  checkpointType: string
): string {
  return `${accountId}:checkpoint:${resourceType}:${resourceId}:${checkpointType}`;
}

export function boolInt(value: boolean): number {
  return value ? 1 : 0;
}
