import type { GoogleApiTransport } from "./transport";

export interface GoogleTaskListMirror {
  id: string;
  title: string;
  updatedAt?: string | null;
  etag?: string | null;
}

export type GoogleTaskStatus = "needsAction" | "completed";

export interface GoogleTaskMirror {
  id: string;
  taskListId: string;
  parentId?: string | null;
  title: string;
  notes?: string | null;
  status: GoogleTaskStatus;
  dueAt?: string | null;
  completedAt?: string | null;
  deleted: boolean;
  hidden: boolean;
  position?: string | null;
  etag?: string | null;
  updatedAt?: string | null;
}

export interface GoogleTasksPage {
  tasks: readonly GoogleTaskMirror[];
  serverDate?: string | null;
}

export interface GoogleTasksReadTransport {
  listTaskLists(): Promise<readonly GoogleTaskListMirror[]>;
  listTasks(request: {
    taskListId: string;
    updatedMin?: string | null;
    completedMin?: string | null;
  }): Promise<GoogleTasksPage>;
}

interface GoogleTaskListsResponse {
  items?: GoogleTaskListDto[];
}

interface GoogleTaskListDto {
  id: string;
  title?: string;
  updated?: string;
  etag?: string;
}

interface GoogleTasksResponse {
  items?: GoogleTaskDto[];
  nextPageToken?: string;
}

interface GoogleTaskDto {
  id: string;
  title?: string;
  notes?: string;
  status?: string;
  due?: string;
  completed?: string;
  deleted?: boolean;
  hidden?: boolean;
  parent?: string;
  position?: string;
  etag?: string;
  updated?: string;
}

const TASK_LISTS_FIELDS = "items(id,title,updated,etag)";
const TASKS_FIELDS =
  "nextPageToken,items(id,title,notes,status,due,completed,deleted,hidden,parent,position,etag,updated)";

export class GoogleTasksHttpAdapter implements GoogleTasksReadTransport {
  private readonly transport: GoogleApiTransport;

  constructor(transport: GoogleApiTransport) {
    this.transport = transport;
  }

  async listTaskLists(): Promise<readonly GoogleTaskListMirror[]> {
    const response = await this.transport.getJson<GoogleTaskListsResponse>({
      path: "/tasks/v1/users/@me/lists",
      query: {
        fields: TASK_LISTS_FIELDS
      }
    });

    return (response.items ?? []).map((item) => ({
      id: item.id,
      title: item.title ?? "Untitled list",
      updatedAt: item.updated ?? null,
      etag: item.etag ?? null
    }));
  }

  async listTasks(request: {
    taskListId: string;
    updatedMin?: string | null;
    completedMin?: string | null;
  }): Promise<GoogleTasksPage> {
    let pageToken: string | undefined;
    let firstPageServerDate: string | null = null;
    let isFirstPage = true;
    const tasks: GoogleTaskMirror[] = [];

    do {
      const response = await this.transport.getJsonWithMetadata<GoogleTasksResponse>({
        path: `/tasks/v1/lists/${encodeGooglePathComponent(request.taskListId)}/tasks`,
        query: {
          showCompleted: "true",
          showDeleted: "true",
          showHidden: "true",
          maxResults: "100",
          fields: TASKS_FIELDS,
          updatedMin: request.updatedMin ?? undefined,
          completedMin:
            request.updatedMin === undefined || request.updatedMin === null
              ? request.completedMin ?? undefined
              : undefined,
          pageToken
        }
      });

      if (isFirstPage) {
        firstPageServerDate = response.metadata.serverDate ?? null;
        isFirstPage = false;
      }

      tasks.push(
        ...(response.data.items ?? []).map((item) => mapTask(item, request.taskListId))
      );
      pageToken = response.data.nextPageToken;
    } while (pageToken !== undefined && pageToken.length > 0);

    return {
      tasks,
      serverDate: firstPageServerDate
    };
  }
}

function mapTask(item: GoogleTaskDto, taskListId: string): GoogleTaskMirror {
  return {
    id: item.id,
    taskListId,
    parentId: item.parent ?? null,
    title: item.title ?? "Untitled task",
    notes: item.notes ?? null,
    status: item.status === "completed" ? "completed" : "needsAction",
    dueAt: taskDueToIso(item.due),
    completedAt: normalizeIsoDateTime(item.completed),
    deleted: item.deleted ?? false,
    hidden: item.hidden ?? false,
    position: item.position ?? null,
    etag: item.etag ?? null,
    updatedAt: normalizeIsoDateTime(item.updated)
  };
}

function taskDueToIso(due: string | undefined): string | null {
  if (due === undefined || due.length === 0) {
    return null;
  }

  const dateOnly = due.slice(0, 10);

  if (/^\d{4}-\d{2}-\d{2}$/.test(dateOnly)) {
    return `${dateOnly}T00:00:00.000Z`;
  }

  return normalizeIsoDateTime(due);
}

function normalizeIsoDateTime(value: string | undefined): string | null {
  if (value === undefined || value.length === 0) {
    return null;
  }

  const parsed = Date.parse(value);

  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function encodeGooglePathComponent(value: string): string {
  return encodeURIComponent(value).replace(/%40/g, "@");
}
