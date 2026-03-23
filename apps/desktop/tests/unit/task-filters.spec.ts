import { describe, expect, it } from 'vitest';

import type { Task } from '$lib/types';
import { matchesTaskFilters, sortTasks } from '$lib/utils/taskFilters';
import type { Filters } from '$lib/stores/filters';

function createTask(overrides: Partial<Task>): Task {
  return {
    id: overrides.id ?? crypto.randomUUID(),
    listId: overrides.listId ?? 'list-1',
    parentTaskId: overrides.parentTaskId ?? null,
    title: overrides.title ?? 'Task',
    content: overrides.content ?? null,
    priority: overrides.priority ?? 0,
    status: overrides.status ?? 0,
    startDate: overrides.startDate ?? null,
    dueDate: overrides.dueDate ?? null,
    dueTimezone: overrides.dueTimezone ?? null,
    recurrenceRule: overrides.recurrenceRule ?? null,
    sortOrder: overrides.sortOrder ?? 0,
    headingId: overrides.headingId ?? null,
    completedAt: overrides.completedAt ?? null,
    createdAt: overrides.createdAt ?? '2026-03-23T00:00:00Z',
    updatedAt: overrides.updatedAt ?? '2026-03-23T00:00:00Z',
    deletedAt: overrides.deletedAt ?? null,
    scheduledStart: overrides.scheduledStart ?? null,
    scheduledEnd: overrides.scheduledEnd ?? null,
    estimatedMinutes: overrides.estimatedMinutes ?? null,
    subtasks: overrides.subtasks ?? [],
    tags: overrides.tags ?? [],
  };
}

const emptyFilters: Filters = {
  priorities: [],
  tagIds: [],
  dueBefore: null,
  dueAfter: null,
};

describe('matchesTaskFilters', () => {
  it('matches when no filters are active', () => {
    const task = createTask({ priority: 2 });
    expect(matchesTaskFilters(task, emptyFilters)).toBe(true);
  });

  it('filters by priority and tags', () => {
    const task = createTask({
      priority: 3,
      tags: [{ id: 'tag-1', name: 'Work', color: '#fff', createdAt: '2026-03-23T00:00:00Z' }],
    });

    expect(
      matchesTaskFilters(task, {
        ...emptyFilters,
        priorities: [3],
        tagIds: ['tag-1'],
      }),
    ).toBe(true);

    expect(
      matchesTaskFilters(task, {
        ...emptyFilters,
        priorities: [1],
        tagIds: ['tag-1'],
      }),
    ).toBe(false);
  });

  it('filters by due date window', () => {
    const task = createTask({ dueDate: '2026-03-25T09:00:00Z' });

    expect(
      matchesTaskFilters(task, {
        ...emptyFilters,
        dueAfter: '2026-03-24T00:00:00Z',
        dueBefore: '2026-03-26T00:00:00Z',
      }),
    ).toBe(true);

    expect(
      matchesTaskFilters(task, {
        ...emptyFilters,
        dueBefore: '2026-03-24T00:00:00Z',
      }),
    ).toBe(false);
  });
});

describe('sortTasks', () => {
  const tasks = [
    createTask({
      id: 'task-c',
      title: 'Charlie',
      priority: 1,
      sortOrder: 2,
      dueDate: '2026-03-25T09:00:00Z',
      createdAt: '2026-03-25T09:00:00Z',
    }),
    createTask({
      id: 'task-a',
      title: 'Alpha',
      priority: 3,
      sortOrder: 1,
      dueDate: '2026-03-24T09:00:00Z',
      createdAt: '2026-03-24T09:00:00Z',
    }),
    createTask({
      id: 'task-b',
      title: 'Bravo',
      priority: 2,
      sortOrder: 3,
      dueDate: null,
      createdAt: '2026-03-26T09:00:00Z',
    }),
  ];

  it('sorts by manual sort order', () => {
    expect(sortTasks(tasks, 'manual').map((task) => task.id)).toEqual([
      'task-a',
      'task-c',
      'task-b',
    ]);
  });

  it('sorts by priority descending', () => {
    expect(sortTasks(tasks, 'priority').map((task) => task.id)).toEqual([
      'task-a',
      'task-b',
      'task-c',
    ]);
  });

  it('sorts by due date with undated tasks last', () => {
    expect(sortTasks(tasks, 'dueDate').map((task) => task.id)).toEqual([
      'task-a',
      'task-c',
      'task-b',
    ]);
  });
});
