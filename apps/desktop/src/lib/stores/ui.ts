import { writable } from 'svelte/store';

export type ViewMode = 'list' | 'today' | 'calendar' | 'smart-filter' | 'tag-filter' | 'area-view' | 'saved-filter' | 'logbook';
export type CalendarSubView = 'month' | 'week' | 'next7days' | 'upcoming' | 'schedule' | 'timeline';
export type SmartFilterType = 'overdue' | 'due-this-week' | 'high-priority' | 'untagged';
export const selectedSmartFilter = writable<SmartFilterType>('overdue');

export const selectedListId = writable<string | null>(null);
export const selectedTaskId = writable<string | null>(null);
export const showCompletedTasks = writable<boolean>(true);
export const currentView = writable<ViewMode>('today');
export const calendarSubView = writable<CalendarSubView>('month');
export const selectedTagId = writable<string | null>(null);
export const selectedAreaId = writable<string | null>(null);
export const selectedSavedFilterId = writable<string | null>(null);
