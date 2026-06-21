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
    showCompleted?: boolean;
  }): Promise<GoogleTasksPage>;
}

export interface GoogleTaskWriteInput {
  title: string;
  notes?: string | null;
  dueDate?: string | null;
  parentId?: string | null;
  previousSiblingId?: string | null;
}

export interface GoogleTaskUpdateInput {
  taskListId: string;
  taskId: string;
  title?: string;
  notes?: string | null;
  dueDate?: string | null;
  status?: GoogleTaskStatus;
  completedAt?: string | null;
  ifMatch?: string | null;
}

export interface GoogleTaskMoveInput {
  taskListId: string;
  taskId: string;
  parentId?: string | null;
  previousSiblingId?: string | null;
}

export interface GoogleTasksWriteTransport {
  insertTaskList(title: string): Promise<GoogleTaskListMirror>;
  updateTaskList(request: {
    taskListId: string;
    title: string;
    ifMatch?: string | null;
  }): Promise<GoogleTaskListMirror>;
  deleteTaskList(request: { taskListId: string; ifMatch?: string | null }): Promise<void>;
  insertTask(taskListId: string, input: GoogleTaskWriteInput): Promise<GoogleTaskMirror>;
  updateTask(input: GoogleTaskUpdateInput): Promise<GoogleTaskMirror>;
  setTaskCompleted(request: {
    taskListId: string;
    taskId: string;
    completed: boolean;
    ifMatch?: string | null;
  }): Promise<GoogleTaskMirror>;
  moveTask(input: GoogleTaskMoveInput): Promise<GoogleTaskMirror>;
  deleteTask(request: {
    taskListId: string;
    taskId: string;
    ifMatch?: string | null;
  }): Promise<void>;
}

export type GoogleTasksTransport = GoogleTasksReadTransport & GoogleTasksWriteTransport;

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

interface GoogleTaskMutationDTO {
  title?: string;
  notes?: string;
  due?: string | null;
  status?: GoogleTaskStatus;
  completed?: string | null;
}

const TASK_LISTS_FIELDS = "items(id,title,updated,etag)";
const TASKS_FIELDS =
  "nextPageToken,items(id,title,notes,status,due,completed,deleted,hidden,parent,position,etag,updated)";

export class GoogleTasksHttpAdapter implements GoogleTasksTransport {
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
    showCompleted?: boolean;
  }): Promise<GoogleTasksPage> {
    let pageToken: string | undefined;
    let firstPageServerDate: string | null = null;
    let isFirstPage = true;
    const tasks: GoogleTaskMirror[] = [];

    do {
      const completedMin =
        request.showCompleted !== false &&
        (request.updatedMin === undefined || request.updatedMin === null)
          ? request.completedMin ?? undefined
          : undefined;
      const response = await this.transport.getJsonWithMetadata<GoogleTasksResponse>({
        path: `/tasks/v1/lists/${encodeGooglePathComponent(request.taskListId)}/tasks`,
        query: {
          showAssigned: "true",
          showCompleted: request.showCompleted === false ? "false" : "true",
          showDeleted: "true",
          showHidden: "true",
          maxResults: "100",
          fields: TASKS_FIELDS,
          updatedMin: request.updatedMin ?? undefined,
          ...(completedMin === undefined ? {} : { completedMin }),
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

  async insertTaskList(title: string): Promise<GoogleTaskListMirror> {
    const response = await this.transport.getJson<GoogleTaskListDto>({
      method: "POST",
      path: "/tasks/v1/users/@me/lists",
      query: {
        fields: "id,title,updated,etag"
      },
      body: {
        title
      }
    });

    return {
      id: response.id,
      title: response.title ?? title,
      updatedAt: response.updated ?? null,
      etag: response.etag ?? null
    };
  }

  async updateTaskList(request: {
    taskListId: string;
    title: string;
    ifMatch?: string | null;
  }): Promise<GoogleTaskListMirror> {
    const response = await this.transport.getJson<GoogleTaskListDto>({
      method: "PATCH",
      path: `/tasks/v1/users/@me/lists/${encodeGooglePathComponent(request.taskListId)}`,
      query: {
        fields: "id,title,updated,etag"
      },
      body: {
        title: request.title
      },
      ifMatch: request.ifMatch ?? undefined
    });

    return {
      id: response.id,
      title: response.title ?? request.title,
      updatedAt: response.updated ?? null,
      etag: response.etag ?? null
    };
  }

  async deleteTaskList(request: { taskListId: string; ifMatch?: string | null }): Promise<void> {
    await this.transport.send({
      method: "DELETE",
      path: `/tasks/v1/users/@me/lists/${encodeGooglePathComponent(request.taskListId)}`,
      ifMatch: request.ifMatch ?? undefined
    });
  }

  async insertTask(taskListId: string, input: GoogleTaskWriteInput): Promise<GoogleTaskMirror> {
    const response = await this.transport.getJson<GoogleTaskDto>({
      method: "POST",
      path: `/tasks/v1/lists/${encodeGooglePathComponent(taskListId)}/tasks`,
      query: {
        fields: "id,title,notes,status,due,completed,deleted,hidden,parent,position,etag,updated",
        parent: input.parentId ?? undefined,
        previous: input.previousSiblingId ?? undefined
      },
      body: taskMutationBody(input)
    });

    return mapTask(response, taskListId);
  }

  async updateTask(input: GoogleTaskUpdateInput): Promise<GoogleTaskMirror> {
    const response = await this.transport.getJson<GoogleTaskDto>({
      method: "PATCH",
      path: `/tasks/v1/lists/${encodeGooglePathComponent(input.taskListId)}/tasks/${encodeGooglePathComponent(input.taskId)}`,
      query: {
        fields: "id,title,notes,status,due,completed,deleted,hidden,parent,position,etag,updated"
      },
      body: taskMutationBody(input),
      ifMatch: input.ifMatch ?? undefined
    });

    return mapTask(response, input.taskListId);
  }

  async setTaskCompleted(request: {
    taskListId: string;
    taskId: string;
    completed: boolean;
    ifMatch?: string | null;
  }): Promise<GoogleTaskMirror> {
    return this.updateTask({
      taskListId: request.taskListId,
      taskId: request.taskId,
      status: request.completed ? "completed" : "needsAction",
      completedAt: request.completed ? new Date().toISOString() : null,
      ifMatch: request.ifMatch
    });
  }

  async moveTask(input: GoogleTaskMoveInput): Promise<GoogleTaskMirror> {
    const response = await this.transport.getJson<GoogleTaskDto>({
      method: "POST",
      path: `/tasks/v1/lists/${encodeGooglePathComponent(input.taskListId)}/tasks/${encodeGooglePathComponent(input.taskId)}/move`,
      query: {
        fields: "id,title,notes,status,due,completed,deleted,hidden,parent,position,etag,updated",
        parent: input.parentId ?? undefined,
        previous: input.previousSiblingId ?? undefined
      }
    });

    return mapTask(response, input.taskListId);
  }

  async deleteTask(request: {
    taskListId: string;
    taskId: string;
    ifMatch?: string | null;
  }): Promise<void> {
    await this.transport.send({
      method: "DELETE",
      path: `/tasks/v1/lists/${encodeGooglePathComponent(request.taskListId)}/tasks/${encodeGooglePathComponent(request.taskId)}`,
      ifMatch: request.ifMatch ?? undefined
    });
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

function normalizeIsoDateTime(value: string | null | undefined): string | null {
  if (value === undefined || value === null || value.length === 0) {
    return null;
  }

  const parsed = Date.parse(value);

  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function taskMutationBody(input: {
  title?: string;
  notes?: string | null;
  dueDate?: string | null;
  status?: GoogleTaskStatus;
  completedAt?: string | null;
}): GoogleTaskMutationDTO {
  return {
    ...(input.title === undefined ? {} : { title: input.title }),
    ...(input.notes === undefined ? {} : { notes: input.notes ?? "" }),
    ...(input.dueDate === undefined ? {} : { due: taskDueFromDateOnly(input.dueDate) }),
    ...(input.status === undefined ? {} : { status: input.status }),
    ...(input.completedAt === undefined ? {} : { completed: input.completedAt })
  };
}

function taskDueFromDateOnly(value: string | null | undefined): string | null | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (value === null) {
    return null;
  }

  return `${value}T00:00:00.000Z`;
}

function encodeGooglePathComponent(value: string): string {
  return encodeURIComponent(value).replace(/%40/g, "@");
}
