import { beforeEach, describe, expect, it } from 'vitest';
import { get } from 'svelte/store';

import type { List } from '$lib/types';
import { addList, editList, lists, loadLists, removeList } from '$lib/stores/lists';
import { clearInvokeHandlers, mockInvokeHandler } from '../../../src/test/setup';

function makeList(overrides: Partial<List> = {}): List {
  return {
    id: overrides.id ?? 'list-1',
    name: overrides.name ?? 'List',
    color: overrides.color ?? null,
    sortOrder: overrides.sortOrder ?? 0,
    isInbox: overrides.isInbox ?? false,
    createdAt: overrides.createdAt ?? '2026-03-22T00:00:00Z',
    updatedAt: overrides.updatedAt ?? '2026-03-22T00:00:00Z',
    deletedAt: overrides.deletedAt ?? null,
  };
}

describe('lists store', () => {
  beforeEach(() => {
    clearInvokeHandlers();
    lists.set([]);
  });

  it('loads lists with inbox first, then sort order, then creation time', async () => {
    mockInvokeHandler('get_lists', () => [
      makeList({
        id: 'later',
        name: 'Later',
        sortOrder: 2,
        createdAt: '2026-03-22T02:00:00Z',
      }),
      makeList({
        id: 'inbox',
        name: 'Inbox',
        isInbox: true,
        sortOrder: 99,
      }),
      makeList({
        id: 'earlier',
        name: 'Earlier',
        sortOrder: 2,
        createdAt: '2026-03-22T01:00:00Z',
      }),
      makeList({
        id: 'priority',
        name: 'Priority',
        sortOrder: 1,
      }),
    ]);

    const loaded = await loadLists();

    expect(loaded.map((list) => list.id)).toEqual([
      'inbox',
      'priority',
      'earlier',
      'later',
    ]);
    expect(get(lists).map((list) => list.id)).toEqual([
      'inbox',
      'priority',
      'earlier',
      'later',
    ]);
  });

  it('adds a new list and keeps the store sorted', async () => {
    lists.set([
      makeList({ id: 'inbox', name: 'Inbox', isInbox: true }),
      makeList({ id: 'later', name: 'Later', sortOrder: 4 }),
    ]);

    mockInvokeHandler('create_list', (args) => {
      expect(args).toEqual({ name: 'Projects', color: null });
      return makeList({
        id: 'projects',
        name: 'Projects',
        sortOrder: 2,
      });
    });

    const created = await addList('Projects');

    expect(created.id).toBe('projects');
    expect(get(lists).map((list) => list.id)).toEqual(['inbox', 'projects', 'later']);
  });

  it('updates and removes lists through invoke-backed mutations', async () => {
    lists.set([
      makeList({ id: 'inbox', name: 'Inbox', isInbox: true }),
      makeList({ id: 'projects', name: 'Projects', sortOrder: 2 }),
    ]);

    mockInvokeHandler('update_list', (args) => {
      expect(args).toEqual({
        id: 'projects',
        name: 'Projects Renamed',
        color: '#123456',
        sortOrder: 1,
      });
      return makeList({
        id: 'projects',
        name: 'Projects Renamed',
        color: '#123456',
        sortOrder: 1,
      });
    });

    await editList('projects', {
      name: 'Projects Renamed',
      color: '#123456',
      sortOrder: 1,
    });

    expect(get(lists).map((list) => list.name)).toEqual(['Inbox', 'Projects Renamed']);

    mockInvokeHandler('delete_list', (args) => {
      expect(args).toEqual({ id: 'projects' });
      return null;
    });

    await removeList('projects');

    expect(get(lists).map((list) => list.id)).toEqual(['inbox']);
  });
});
