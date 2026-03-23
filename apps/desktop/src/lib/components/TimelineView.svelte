<script lang="ts">
  import { invoke } from '@tauri-apps/api/core';
  import { editTask, taskMutationVersion } from '$lib/stores/tasks';
  import { lists } from '$lib/stores/lists';
  import { selectedTaskId } from '$lib/stores/ui';
  import type { Task, List } from '$lib/types';

  const DAY_WIDTH = 40; // px per day column
  const BAR_HEIGHT = 28;
  const ROW_HEIGHT = 36;
  const HEADER_ROW_HEIGHT = 32;
  const LABEL_COL_WIDTH = 180;
  const VIEW_WEEKS = 4;

  let allTasks: Task[] = $state([]);
  let viewStart = $state(defaultViewStart());

  function todayStr(): string {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  function defaultViewStart(): Date {
    const d = new Date();
    d.setDate(d.getDate() - 14); // center ~2 weeks before today
    d.setHours(0, 0, 0, 0);
    return d;
  }

  function fmt(d: Date): string {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  function parseDate(s: string): Date {
    const d = new Date(s + 'T00:00:00');
    return d;
  }

  function diffDays(a: Date, b: Date): number {
    return Math.round((a.getTime() - b.getTime()) / 86400000);
  }

  let viewEnd = $derived.by(() => {
    const d = new Date(viewStart);
    d.setDate(d.getDate() + VIEW_WEEKS * 7 - 1);
    return d;
  });

  let totalDays = $derived(VIEW_WEEKS * 7);
  let totalWidth = $derived(totalDays * DAY_WIDTH);

  let days = $derived.by(() => {
    const arr: Date[] = [];
    for (let i = 0; i < totalDays; i++) {
      const d = new Date(viewStart);
      d.setDate(d.getDate() + i);
      arr.push(d);
    }
    return arr;
  });

  let todayOffset = $derived.by(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const diff = diffDays(today, viewStart);
    if (diff < 0 || diff >= totalDays) return -1;
    return diff * DAY_WIDTH + DAY_WIDTH / 2;
  });

  // group tasks by list
  type TaskGroup = { list: List; tasks: Task[] };

  let groups = $derived.by((): TaskGroup[] => {
    const listMap = new Map<string, List>();
    for (const l of $lists) listMap.set(l.id, l);
    const tasksByList = new Map<string, Task[]>();
    for (const t of allTasks) {
      if (!t.startDate && !t.dueDate) continue; // skip tasks with no dates
      if (!tasksByList.has(t.listId)) tasksByList.set(t.listId, []);
      tasksByList.get(t.listId)!.push(t);
    }
    const result: TaskGroup[] = [];
    for (const [listId, tasks] of tasksByList) {
      const list = listMap.get(listId);
      if (!list) continue;
      result.push({ list, tasks });
    }
    result.sort((a, b) => a.list.sortOrder - b.list.sortOrder);
    return result;
  });

  // total rows for computing scroll height
  let totalRows = $derived.by(() => {
    let count = 0;
    for (const g of groups) {
      count += 1; // header
      count += g.tasks.length;
    }
    return count;
  });

  async function loadData() {
    try {
      allTasks = await invoke<Task[]>('get_tasks_in_range', {
        startDate: fmt(viewStart),
        endDate: fmt(viewEnd),
      });
    } catch (err) {
      console.error('Timeline load failed:', err);
    }
  }

  $effect(() => {
    const _s = fmt(viewStart);
    const _v = $taskMutationVersion;
    loadData();
  });

  function shiftWeek(dir: number) {
    const d = new Date(viewStart);
    d.setDate(d.getDate() + dir * 7);
    viewStart = d;
  }

  function goToday() {
    viewStart = defaultViewStart();
  }

  function barStyle(task: Task): { left: number; width: number; isDot: boolean } {
    const hasStart = !!task.startDate;
    const hasDue = !!task.dueDate;
    if (!hasStart && !hasDue) return { left: 0, width: 0, isDot: false };
    if (hasStart && hasDue) {
      const s = parseDate(task.startDate!);
      const e = parseDate(task.dueDate!);
      const left = diffDays(s, viewStart) * DAY_WIDTH;
      const width = (diffDays(e, s) + 1) * DAY_WIDTH;
      return { left, width, isDot: false };
    }
    if (!hasStart && hasDue) { // dot on due date
      const e = parseDate(task.dueDate!);
      const left = diffDays(e, viewStart) * DAY_WIDTH + DAY_WIDTH / 2 - 5;
      return { left, width: 10, isDot: true };
    }
    // has start only: open-ended bar to end of view
    const s = parseDate(task.startDate!);
    const left = diffDays(s, viewStart) * DAY_WIDTH;
    const endPx = totalWidth;
    const width = Math.max(endPx - left, DAY_WIDTH);
    return { left, width, isDot: false };
  }

  // drag-to-resize state
  let dragTaskId: string | null = $state(null);
  let dragEdge: 'left' | 'right' | null = $state(null);
  let dragOrigDate: string | null = $state(null);
  let dragStartX = $state(0);

  function onEdgeMouseDown(e: MouseEvent, task: Task, edge: 'left' | 'right') {
    e.stopPropagation();
    e.preventDefault();
    dragTaskId = task.id;
    dragEdge = edge;
    dragOrigDate = edge === 'left' ? task.startDate : task.dueDate;
    dragStartX = e.clientX;
    window.addEventListener('mousemove', onDragMove);
    window.addEventListener('mouseup', onDragEnd);
  }

  function onDragMove(e: MouseEvent) {
    if (!dragTaskId || !dragEdge) return;
    // visual feedback handled by css cursor; actual date update on mouseup
  }

  async function onDragEnd(e: MouseEvent) {
    window.removeEventListener('mousemove', onDragMove);
    window.removeEventListener('mouseup', onDragEnd);
    if (!dragTaskId || !dragEdge) return;
    const dx = e.clientX - dragStartX;
    const dayShift = Math.round(dx / DAY_WIDTH);
    if (dayShift === 0) { dragTaskId = null; dragEdge = null; return; }
    if (!dragOrigDate) { dragTaskId = null; dragEdge = null; return; }
    const orig = parseDate(dragOrigDate);
    orig.setDate(orig.getDate() + dayShift);
    const newDateStr = fmt(orig);
    if (dragEdge === 'left') {
      await editTask(dragTaskId, { startDate: newDateStr });
    } else {
      await editTask(dragTaskId, { dueDate: newDateStr });
    }
    taskMutationVersion.update(v => v + 1);
    dragTaskId = null;
    dragEdge = null;
    dragOrigDate = null;
  }

  function onBarClick(task: Task) {
    selectedTaskId.set(task.id);
  }

  function dayLabel(d: Date): string {
    return String(d.getDate());
  }

  function monthLabel(d: Date, i: number): string | null {
    if (i === 0 || d.getDate() === 1) {
      return d.toLocaleDateString('en-US', { month: 'short' });
    }
    return null;
  }

  function isWeekend(d: Date): boolean {
    const day = d.getDay();
    return day === 0 || day === 6;
  }

  let isTodayInView = $derived(todayOffset >= 0);

  let scrollContainer: HTMLDivElement | undefined = $state(undefined);
  let labelCol: HTMLDivElement | undefined = $state(undefined);
  let syncing = false;

  function syncScroll(source: 'chart' | 'label') {
    if (syncing) return;
    syncing = true;
    if (source === 'chart' && scrollContainer && labelCol) {
      labelCol.scrollTop = scrollContainer.scrollTop;
    } else if (source === 'label' && scrollContainer && labelCol) {
      scrollContainer.scrollTop = labelCol.scrollTop;
    }
    syncing = false;
  }

  function scrollToToday() {
    if (!scrollContainer) return;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const diff = diffDays(today, viewStart);
    const px = diff * DAY_WIDTH - scrollContainer.clientWidth / 2;
    scrollContainer.scrollLeft = Math.max(0, px);
  }

  $effect(() => {
    if (scrollContainer && allTasks.length >= 0) {
      scrollToToday();
    }
  });
</script>

<div class="timeline-view">
  <div class="timeline-header">
    <button class="tl-nav-btn" onclick={() => shiftWeek(-1)} aria-label="Previous week">
      <svg width="16" height="16" viewBox="0 0 12 12" fill="none"><path d="M7.5 2.25L3.75 6L7.5 9.75" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
    </button>
    <h2 class="tl-date-label">{fmt(viewStart)} &mdash; {fmt(viewEnd)}</h2>
    <button class="tl-nav-btn" onclick={() => shiftWeek(1)} aria-label="Next week">
      <svg width="16" height="16" viewBox="0 0 12 12" fill="none"><path d="M4.5 2.25L8.25 6L4.5 9.75" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
    </button>
    <button class="tl-today-btn" onclick={goToday}>Today</button>
  </div>

  <div class="timeline-body">
    <!-- sticky label column -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="label-col" bind:this={labelCol} onscroll={() => syncScroll('label')}>
      <div class="label-col-header" style="height:{HEADER_ROW_HEIGHT + 20}px"></div>
      {#each groups as group}
        <div class="label-group-header" style="height:{HEADER_ROW_HEIGHT}px">
          <span class="label-list-dot" style="background:{group.list.color ?? 'var(--color-accent, #6c93c7)'}"></span>
          <span class="label-list-name">{group.list.name}</span>
        </div>
        {#each group.tasks as task (task.id)}
          <div class="label-task-row" style="height:{ROW_HEIGHT}px">
            <span class="label-task-title" title={task.title}>{task.title}</span>
          </div>
        {/each}
      {/each}
      {#if groups.length === 0}
        <div class="label-empty">No dated tasks</div>
      {/if}
    </div>

    <!-- scrollable chart area -->
    <div class="chart-scroll" bind:this={scrollContainer} onscroll={() => syncScroll('chart')}>
      <div class="chart-inner" style="width:{totalWidth}px">
        <!-- date headers -->
        <div class="date-headers" style="height:{HEADER_ROW_HEIGHT + 20}px">
          <!-- month row -->
          <div class="month-row" style="height:20px">
            {#each days as day, i}
              {#if monthLabel(day, i)}
                <span class="month-label" style="left:{i * DAY_WIDTH}px">{monthLabel(day, i)}</span>
              {/if}
            {/each}
          </div>
          <!-- day row -->
          <div class="day-row" style="height:{HEADER_ROW_HEIGHT}px">
            {#each days as day, i}
              <span class="day-cell" class:weekend={isWeekend(day)} class:is-today={fmt(day) === todayStr()} style="left:{i * DAY_WIDTH}px;width:{DAY_WIDTH}px">{dayLabel(day)}</span>
            {/each}
          </div>
        </div>

        <!-- grid + bars -->
        <div class="chart-rows">
          <!-- vertical day grid lines -->
          {#each days as _, i}
            <div class="grid-line" style="left:{i * DAY_WIDTH}px;"></div>
          {/each}

          <!-- today marker -->
          {#if todayOffset >= 0}
            <div class="today-line" style="left:{todayOffset}px"></div>
          {/if}

          <!-- task groups -->
          {#each groups as group}
            <div class="chart-group-header" style="height:{HEADER_ROW_HEIGHT}px"></div>
            {#each group.tasks as task (task.id)}
              {@const bs = barStyle(task)}
              <div class="chart-task-row" style="height:{ROW_HEIGHT}px">
                {#if bs.isDot}
                  <!-- svelte-ignore a11y_click_events_have_key_events -->
                  <!-- svelte-ignore a11y_no_static_element_interactions -->
                  <div
                    class="task-dot"
                    style="left:{bs.left}px;top:{(ROW_HEIGHT - 10) / 2}px"
                    onclick={() => onBarClick(task)}
                    title={task.title}
                  ></div>
                {:else}
                  <!-- svelte-ignore a11y_click_events_have_key_events -->
                  <!-- svelte-ignore a11y_no_static_element_interactions -->
                  <div
                    class="task-bar"
                    style="left:{bs.left}px;width:{bs.width}px;top:{(ROW_HEIGHT - BAR_HEIGHT) / 2}px;border-left-color:{group.list.color ?? 'var(--color-accent, #6c93c7)'}"
                    onclick={() => onBarClick(task)}
                    title={task.title}
                  >
                    {#if task.startDate}
                      <!-- svelte-ignore a11y_no_static_element_interactions -->
                      <div class="edge edge-left" onmousedown={(e) => onEdgeMouseDown(e, task, 'left')}></div>
                    {/if}
                    <span class="bar-label">{task.title}</span>
                    {#if task.dueDate}
                      <!-- svelte-ignore a11y_no_static_element_interactions -->
                      <div class="edge edge-right" onmousedown={(e) => onEdgeMouseDown(e, task, 'right')}></div>
                    {/if}
                  </div>
                {/if}
              </div>
            {/each}
          {/each}
        </div>
      </div>
    </div>
  </div>
</div>

<style>
  .timeline-view { display: flex; flex-direction: column; height: 100%; overflow: hidden; }
  .timeline-header {
    display: flex; align-items: center; gap: 12px;
    padding: 12px 16px; flex-shrink: 0;
  }
  .tl-date-label {
    font-size: 14px; font-weight: 600;
    color: var(--color-text-primary, #d4d4d4);
    margin: 0; min-width: 220px; text-align: center;
  }
  .tl-nav-btn {
    display: flex; align-items: center; justify-content: center;
    width: 32px; height: 32px;
    background: var(--color-panel, #202225);
    border: 1px solid var(--color-border, #32353a);
    border-radius: 8px;
    color: var(--color-text-primary, #d4d4d4);
    cursor: pointer; padding: 0;
  }
  .tl-nav-btn:hover { background: var(--color-surface-hover, #2a2e33); }
  .tl-today-btn {
    padding: 6px 12px; border-radius: 8px;
    border: 1px solid var(--color-border, #32353a);
    background: var(--color-panel, #202225);
    color: var(--color-text-primary, #d4d4d4);
    font-size: 12px; cursor: pointer; font-family: inherit;
    transition: background 150ms ease;
  }
  .tl-today-btn:hover { background: var(--color-surface-hover, #2a2e33); }

  .timeline-body { display: flex; flex: 1; overflow: hidden; }

  /* sticky left label column */
  .label-col {
    width: 180px; flex-shrink: 0;
    border-right: 1px solid var(--color-border-subtle, #292c30);
    overflow-y: auto; overflow-x: hidden;
    background: var(--color-bg-primary, #191919);
  }
  .label-col-header {
    border-bottom: 1px solid var(--color-border-subtle, #292c30);
  }
  .label-group-header {
    display: flex; align-items: center; gap: 6px;
    padding: 0 10px;
    font-size: 12px; font-weight: 600;
    color: var(--color-text-primary, #d4d4d4);
    border-bottom: 1px solid var(--color-border-subtle, #292c30);
    background: var(--color-surface-0, #25282c);
  }
  .label-list-dot {
    width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0;
  }
  .label-list-name {
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .label-task-row {
    display: flex; align-items: center; padding: 0 10px 0 24px;
    border-bottom: 1px solid var(--color-border-subtle, #292c30);
  }
  .label-task-title {
    font-size: 12px; color: var(--color-text-primary, #d4d4d4);
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .label-empty {
    padding: 20px 10px; font-size: 12px;
    color: var(--color-text-muted, #90918d); font-style: italic;
  }

  /* scrollable chart */
  .chart-scroll {
    flex: 1; overflow: auto;
  }
  .chart-inner { position: relative; }
  .date-headers {
    position: sticky; top: 0; z-index: 3;
    background: var(--color-bg-primary, #191919);
    border-bottom: 1px solid var(--color-border-subtle, #292c30);
  }
  .month-row { position: relative; }
  .month-label {
    position: absolute; top: 2px;
    font-size: 11px; font-weight: 600;
    color: var(--color-text-muted, #90918d);
    padding-left: 4px; white-space: nowrap;
  }
  .day-row { position: relative; display: flex; }
  .day-cell {
    position: absolute; display: flex; align-items: center; justify-content: center;
    font-size: 11px; color: var(--color-text-muted, #90918d);
    box-sizing: border-box;
  }
  .day-cell.weekend { color: var(--color-text-muted, #90918d); opacity: 0.5; }
  .day-cell.is-today {
    color: var(--color-accent, #6c93c7); font-weight: 700;
  }

  .chart-rows { position: relative; }
  .grid-line {
    position: absolute; top: 0; bottom: 0; width: 1px;
    background: var(--color-border-subtle, #292c30);
    pointer-events: none; z-index: 0;
  }
  .today-line {
    position: absolute; top: 0; bottom: 0; width: 2px;
    background: var(--color-danger, #e55); z-index: 2;
    pointer-events: none;
  }

  .chart-group-header {
    border-bottom: 1px solid var(--color-border-subtle, #292c30);
    background: var(--color-surface-0, #25282c);
  }
  .chart-task-row {
    position: relative;
    border-bottom: 1px solid var(--color-border-subtle, #292c30);
  }

  /* task bar */
  .task-bar {
    position: absolute; height: 28px; border-radius: 6px;
    background: var(--color-surface-1, #2d3136);
    border: 1px solid var(--color-border-subtle, #292c30);
    border-left: 3px solid transparent;
    display: flex; align-items: center; overflow: hidden;
    cursor: pointer; z-index: 1;
    transition: box-shadow 150ms ease;
  }
  .task-bar:hover { box-shadow: 0 2px 8px rgba(0,0,0,0.35); z-index: 2; }
  .bar-label {
    font-size: 11px; color: var(--color-text-primary, #d4d4d4);
    padding: 0 6px; overflow: hidden; text-overflow: ellipsis;
    white-space: nowrap; flex: 1; pointer-events: none;
  }

  /* drag edges */
  .edge {
    position: absolute; top: 0; bottom: 0; width: 6px;
    cursor: col-resize; z-index: 3;
  }
  .edge-left { left: 0; }
  .edge-right { right: 0; }
  .edge:hover { background: rgba(255,255,255,0.08); }

  /* dot for tasks with only dueDate */
  .task-dot {
    position: absolute; width: 10px; height: 10px;
    background: var(--color-accent, #6c93c7);
    border-radius: 2px; transform: rotate(45deg);
    cursor: pointer; z-index: 1;
  }
  .task-dot:hover { box-shadow: 0 0 6px rgba(108,147,199,0.6); }
</style>
