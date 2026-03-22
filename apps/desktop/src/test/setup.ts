/**
 * Vitest setup file for Svelte/Tauri desktop app tests.
 *
 * Provides a mock implementation of the Tauri invoke bridge so that
 * component tests can run in a jsdom environment without a real Tauri
 * runtime.
 */

import { vi } from "vitest";

// ---------------------------------------------------------------------------
// Mock Tauri IPC invoke
// ---------------------------------------------------------------------------

/** Map of command name -> mock handler. Tests can override individual entries. */
const invokeHandlers: Record<string, (...args: unknown[]) => unknown> = {};

/**
 * Register a mock handler for a Tauri command.
 *
 * @example
 * ```ts
 * mockInvokeHandler("get_tasks", () => [{ id: "1", title: "Test" }]);
 * ```
 */
export function mockInvokeHandler(
  command: string,
  handler: (...args: unknown[]) => unknown,
): void {
  invokeHandlers[command] = handler;
}

/** Clear all registered invoke handlers between tests. */
export function clearInvokeHandlers(): void {
  for (const key of Object.keys(invokeHandlers)) {
    delete invokeHandlers[key];
  }
}

// Provide the mock on the window object that @tauri-apps/api reads at runtime.
Object.defineProperty(window, "__TAURI_INTERNALS__", {
  value: {
    invoke: vi.fn(async (command: string, args?: Record<string, unknown>) => {
      const handler = invokeHandlers[command];
      if (handler) {
        return handler(args);
      }
      throw new Error(
        `[mock] No handler registered for Tauri command "${command}"`,
      );
    }),
    convertFileSrc: vi.fn((path: string) => path),
    transformCallback: vi.fn(),
  },
  writable: true,
});
