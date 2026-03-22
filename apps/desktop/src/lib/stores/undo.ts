import { writable } from 'svelte/store';

/**
 * Whether there is at least one action that can be undone.
 */
export const canUndo = writable<boolean>(false);

/**
 * Whether there is at least one action that can be redone.
 */
export const canRedo = writable<boolean>(false);
