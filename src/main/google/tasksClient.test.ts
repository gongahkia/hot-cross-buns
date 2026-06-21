import { describe, expect, it } from "vitest";
import { GoogleTasksHttpAdapter } from "./tasksClient";
import type { GoogleApiRequest, GoogleApiTransport } from "./transport";

interface RecordedTaskTransport extends GoogleApiTransport {
  getJsonCalls: GoogleApiRequest[];
  getJsonWithMetadataCalls: GoogleApiRequest[];
  sendCalls: GoogleApiRequest[];
}

function taskTransport(): RecordedTaskTransport {
  const getJsonCalls: GoogleApiRequest[] = [];
  const getJsonWithMetadataCalls: GoogleApiRequest[] = [];
  const sendCalls: GoogleApiRequest[] = [];

  return {
    getJson: async <T,>(request: GoogleApiRequest): Promise<T> => {
      getJsonCalls.push(request);
      const body = request.body as Record<string, string | null | undefined> | undefined;

      if (request.path === "/tasks/v1/users/@me/lists") {
        return {
          id: "list-created",
          title: body?.title ?? "Inbox",
          updated: "2026-05-22T00:00:00.000Z",
          etag: "etag-list"
        } as T;
      }

      return {
        id: "task-created",
        title: body?.title ?? "Review notes",
        notes: body?.notes,
        status: body?.status ?? "needsAction",
        due: body?.due,
        completed: body?.completed,
        parent: request.query?.parent,
        position: "1",
        updated: "2026-05-22T00:00:00.000Z",
        etag: "etag-task"
      } as T;
    },
    getJsonWithMetadata: async <T,>(
      request: GoogleApiRequest
    ): Promise<{ data: T; metadata: { status: number; serverDate?: string } }> => {
      getJsonWithMetadataCalls.push(request);

      return {
        data: {
          items: [
            {
              id: "assigned-task",
              title: "Assigned follow-up",
              status: "needsAction",
              hidden: false,
              deleted: false,
              updated: "2026-05-22T00:00:00.000Z"
            }
          ]
        } as T,
        metadata: {
          status: 200,
          serverDate: "Fri, 22 May 2026 02:00:00 GMT"
        }
      };
    },
    send: async (request: GoogleApiRequest): Promise<void> => {
      sendCalls.push(request);
    },
    getJsonCalls,
    getJsonWithMetadataCalls,
    sendCalls
  };
}

describe("Google Tasks write mapping", () => {
  it("requests assigned tasks when reading task lists", async () => {
    const transport = taskTransport();
    const adapter = new GoogleTasksHttpAdapter(transport);

    const page = await adapter.listTasks({
      taskListId: "list/1",
      completedMin: "2026-01-01T00:00:00.000Z"
    });

    expect(page).toMatchObject({
      serverDate: "Fri, 22 May 2026 02:00:00 GMT",
      tasks: [
        {
          id: "assigned-task",
          taskListId: "list/1",
          title: "Assigned follow-up",
          status: "needsAction"
        }
      ]
    });
    expect(transport.getJsonWithMetadataCalls).toContainEqual(
      expect.objectContaining({
        path: "/tasks/v1/lists/list%2F1/tasks",
        query: expect.objectContaining({
          showAssigned: "true",
          showCompleted: "true",
          showDeleted: "true",
          showHidden: "true",
          completedMin: "2026-01-01T00:00:00.000Z"
        })
      })
    );
  });

  it("can read open tasks without applying the completed date filter", async () => {
    const transport = taskTransport();
    const adapter = new GoogleTasksHttpAdapter(transport);

    await adapter.listTasks({
      taskListId: "list/1",
      completedMin: "2026-01-01T00:00:00.000Z",
      showCompleted: false
    });

    expect(transport.getJsonWithMetadataCalls).toContainEqual(
      expect.objectContaining({
        path: "/tasks/v1/lists/list%2F1/tasks",
        query: expect.objectContaining({
          showCompleted: "false"
        })
      })
    );
    expect(transport.getJsonWithMetadataCalls[0]?.query).not.toHaveProperty("completedMin");
  });

  it("uses date-only due fields and move query parameters for task writes", async () => {
    const transport = taskTransport();
    const adapter = new GoogleTasksHttpAdapter(transport);

    const inserted = await adapter.insertTask("list/1", {
      title: "Review notes",
      notes: "No due time.",
      dueDate: "2026-05-22",
      parentId: "parent-1",
      previousSiblingId: "task-0"
    });
    const moved = await adapter.moveTask({
      taskListId: "list/1",
      taskId: "task-created",
      parentId: "parent-1",
      previousSiblingId: "task-0"
    });

    expect(inserted).toMatchObject({
      title: "Review notes",
      dueAt: "2026-05-22T00:00:00.000Z",
      parentId: "parent-1"
    });
    expect(moved.parentId).toBe("parent-1");
    expect(transport.getJsonCalls).toContainEqual(
      expect.objectContaining({
        method: "POST",
        path: "/tasks/v1/lists/list%2F1/tasks",
        query: expect.objectContaining({
          parent: "parent-1",
          previous: "task-0"
        }),
        body: expect.objectContaining({
          due: "2026-05-22T00:00:00.000Z"
        })
      })
    );
    expect(transport.getJsonCalls).toContainEqual(
      expect.objectContaining({
        method: "POST",
        path: "/tasks/v1/lists/list%2F1/tasks/task-created/move",
        query: expect.objectContaining({
          parent: "parent-1",
          previous: "task-0"
        })
      })
    );
  });

  it("maps task list writes and clears completion without storing tokens", async () => {
    const transport = taskTransport();
    const adapter = new GoogleTasksHttpAdapter(transport);

    await adapter.insertTaskList("Errands");
    await adapter.updateTaskList({ taskListId: "list-1", title: "Errands renamed", ifMatch: "etag-list" });
    await adapter.setTaskCompleted({
      taskListId: "list-1",
      taskId: "task-1",
      completed: false,
      ifMatch: "etag-task"
    });
    await adapter.deleteTask({ taskListId: "list-1", taskId: "task-1", ifMatch: "etag-task" });

    expect(transport.getJsonCalls).toContainEqual(
      expect.objectContaining({
        method: "POST",
        path: "/tasks/v1/users/@me/lists",
        body: { title: "Errands" }
      })
    );
    expect(transport.getJsonCalls).toContainEqual(
      expect.objectContaining({
        method: "PATCH",
        path: "/tasks/v1/users/@me/lists/list-1",
        ifMatch: "etag-list"
      })
    );
    expect(transport.getJsonCalls).toContainEqual(
      expect.objectContaining({
        method: "PATCH",
        path: "/tasks/v1/lists/list-1/tasks/task-1",
        body: {
          status: "needsAction",
          completed: null
        },
        ifMatch: "etag-task"
      })
    );
    expect(transport.sendCalls).toContainEqual(
      expect.objectContaining({
        method: "DELETE",
        path: "/tasks/v1/lists/list-1/tasks/task-1",
        ifMatch: "etag-task"
      })
    );
    expect(JSON.stringify(transport.getJsonCalls)).not.toMatch(/token|Bearer/i);
  });
});
