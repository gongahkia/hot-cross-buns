import { beforeEach, describe, expect, it } from 'vitest';
import { get } from 'svelte/store';

import type { Task } from '$lib/types';
import {
  completeTask,
  loadTasks,
  moveTask,
  removeTask,
  taskMutationVersion,
  tasks,
} from '$lib/stores/tasks';
import { clearInvokeHandlers, mockInvokeHandler } from '../../../src/test/setup';

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: overrides.id ?? 'task-1',
    listId: overrides.listId ?? 'list-1',
    parentTaskId: overrides.parentTaskId ?? null,
    title: overrides.title ?? 'Task',
    content: overrides.content ?? null,
    priority: overrides.priority ?? 0,
    status: overrides.status ?? 0,
    dueDate: overrides.dueDate ?? null,
    dueTimezone: overrides.dueTimezone ?? null,
    recurrenceRule: overrides.recurrenceRule ?? null,
    sortOrder: overrides.sortOrder ?? 0,
    completedAt: overrides.completedAt ?? null,
    createdAt: overrides.createdAt ?? '2026-03-22T00:00:00Z',
    updatedAt: overrides.updatedAt ?? '2026-03-22T00:00:00Z',
    deletedAt: overrides.deletedAt ?? null,
    scheduledStart: overrides.scheduledStart ?? null,
    scheduledEnd: overrides.scheduledEnd ?? null,
    estimatedMinutes: overrides.estimatedMinutes ?? null,
    subtasks: overrides.subtasks ?? [],
    tags: overrides.tags ?? [],
  };
}

describe('tasks store', () => {
  beforeEach(() => {
    clearInvokeHandlers();
    tasks.set([]);
    taskMutationVersion.set(0);
  });

  it('loads tasks by flattening subtasks into the store', async () => {
    mockInvokeHandler('get_tasks_by_list', (args) => {
      expect(args).toEqual({ listId: 'list-1', includeCompleted: false });
      return [
        makeTask({
          id: 'parent',
          title: 'Parent',
          subtasks: [
            makeTask({
              id: 'child',
              parentTaskId: 'parent',
              title: 'Child',
            }),
          ],
        }),
      ];
    });

    const loaded = await loadTasks('list-1');

    expect(loaded.map((task) => task.id)).toEqual(['parent', 'child']);
    expect(get(tasks).map((task) => task.id)).toEqual(['parent', 'child']);
  });

  it('removes an entire task tree and bumps the mutation version', async () => {
    tasks.set([
      makeTask({ id: 'parent', title: 'Parent' }),
      makeTask({ id: 'child', parentTaskId: 'parent', title: 'Child' }),
      makeTask({ id: 'sibling', title: 'Sibling' }),
    ]);

    mockInvokeHandler('delete_task', (args) => {
      expect(args).toEqual({ id: 'parent' });
      return null;
    });

    await removeTask('parent');

    expect(get(tasks).map((task) => task.id)).toEqual(['sibling']);
    expect(get(taskMutationVersion)).toBe(1);
  });

  it('completes tasks through update_task and reflects the updated store state', async () => {
    tasks.set([makeTask({ id: 'task-1', title: 'Draft spec', status: 0 })]);

    mockInvokeHandler('update_task', (args) => {
      expect(args).toEqual({
        id: 'task-1',
        title: null,
        content: null,
        priority: null,
        status: 1,
        dueDate: null,
        dueTimezone: null,
        recurrenceRule: null,
        sortOrder: null,
        scheduledStart: null,
        scheduledEnd: null,
        estimatedMinutes: null,
      });

      return makeTask({
        id: 'task-1',
        title: 'Draft spec',
        status: 1,
        completedAt: '2026-03-22T09:00:00Z',
      });
    });

    const completed = await completeTask('task-1');

    expect(completed.status).toBe(1);
    expect(get(tasks)[0]?.status).toBe(1);
    expect(get(taskMutationVersion)).toBe(1);
  });

  it('removes moved tasks from the current list view and bumps the mutation version', async () => {
    tasks.set([
      makeTask({ id: 'parent', listId: 'list-1', title: 'Parent' }),
      makeTask({ id: 'child', listId: 'list-1', parentTaskId: 'parent', title: 'Child' }),
      makeTask({ id: 'other', listId: 'list-1', title: 'Other' }),
    ]);

    mockInvokeHandler('move_task', (args) => {
      expect(args).toEqual({
        id: 'parent',
        newListId: 'list-2',
        newSortOrder: 3,
      });

      return makeTask({ id: 'parent', listId: 'list-2', sortOrder: 3 });
    });

    await moveTask('parent', 'list-2', 3);

    expect(get(tasks).map((task) => task.id)).toEqual(['other']);
    expect(get(taskMutationVersion)).toBe(1);
  });
});
