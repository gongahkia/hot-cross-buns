// Lightweight drag-and-drop service (no external dependencies)

export interface DragDropOptions<T = unknown> {
  /** Data attached to the dragged item. */
  getData: (el: HTMLElement) => T;
  /** Called when a valid drop occurs. */
  onDrop: (data: T, target: HTMLElement) => void;
  /** Optional CSS class applied to the element while dragging. */
  dragClass?: string;
  /** Optional CSS class applied to a valid drop target on hover. */
  overClass?: string;
  /** Mime-type key used in dataTransfer (default: "application/json"). */
  mimeType?: string;
}

/**
 * Handles the dragstart event. Serialises the item data into the
 * dataTransfer object and optionally applies a CSS class.
 */
export function handleDragStart<T>(
  e: DragEvent,
  data: T,
  options?: { dragClass?: string; mimeType?: string },
): void {
  if (!e.dataTransfer) return;
  const mime = options?.mimeType ?? 'application/json';
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData(mime, JSON.stringify(data));

  const el = e.currentTarget as HTMLElement | null;
  if (el && options?.dragClass) {
    el.classList.add(options.dragClass);
    // Remove class once drag ends
    el.addEventListener(
      'dragend',
      () => el.classList.remove(options.dragClass!),
      { once: true },
    );
  }
}

/**
 * Handles the dragover event. Prevents default so the element is a
 * valid drop target and optionally applies a hover class.
 */
export function handleDragOver(
  e: DragEvent,
  options?: { overClass?: string },
): void {
  e.preventDefault();
  if (e.dataTransfer) {
    e.dataTransfer.dropEffect = 'move';
  }

  const el = e.currentTarget as HTMLElement | null;
  if (el && options?.overClass) {
    el.classList.add(options.overClass);
    // Remove when leaving
    el.addEventListener(
      'dragleave',
      () => el.classList.remove(options.overClass!),
      { once: true },
    );
  }
}

/**
 * Handles the drop event. Parses the transferred data and forwards
 * it to the provided callback.
 */
export function handleDrop<T>(
  e: DragEvent,
  onDrop: (data: T, target: HTMLElement) => void,
  options?: { overClass?: string; mimeType?: string },
): void {
  e.preventDefault();
  const el = e.currentTarget as HTMLElement | null;
  if (el && options?.overClass) {
    el.classList.remove(options.overClass);
  }

  if (!e.dataTransfer) return;
  const mime = options?.mimeType ?? 'application/json';
  const raw = e.dataTransfer.getData(mime);
  if (!raw) return;

  try {
    const data = JSON.parse(raw) as T;
    if (el) {
      onDrop(data, el);
    }
  } catch {
    console.warn('[drag-drop] Failed to parse transferred data');
  }
}

/**
 * Convenience wrapper that returns bound event handlers for use in
 * Svelte templates.
 *
 * Usage:
 * ```svelte
 * <script>
 *   const { dragstart, dragover, drop } = useDragDrop({
 *     getData: (el) => el.dataset.taskId,
 *     onDrop: (taskId, target) => moveTask(taskId, target.dataset.listId),
 *   });
 * </script>
 *
 * <div draggable="true" ondragstart={dragstart}>...</div>
 * <div ondragover={dragover} ondrop={drop}>...</div>
 * ```
 */
export function useDragDrop<T = unknown>(options: DragDropOptions<T>) {
  const mime = options.mimeType ?? 'application/json';

  return {
    dragstart(e: DragEvent) {
      const el = e.currentTarget as HTMLElement;
      const data = options.getData(el);
      handleDragStart(e, data, {
        dragClass: options.dragClass,
        mimeType: mime,
      });
    },

    dragover(e: DragEvent) {
      handleDragOver(e, { overClass: options.overClass });
    },

    drop(e: DragEvent) {
      handleDrop<T>(e, options.onDrop, {
        overClass: options.overClass,
        mimeType: mime,
      });
    },
  };
}
