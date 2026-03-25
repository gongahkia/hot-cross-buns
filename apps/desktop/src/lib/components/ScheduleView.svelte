<script lang="ts">
  import { invoke } from '@tauri-apps/api/core';
  import { editTask, taskMutationVersion } from '$lib/stores/tasks';
  import type { Task } from '$lib/types';

  const HOUR_HEIGHT = 60; // px per hour
  const START_HOUR = 6;
  const END_HOUR = 23;
  const TOTAL_HOURS = END_HOUR - START_HOUR;
  const SNAP_MINUTES = 15;

  let scheduledTasks: Task[] = $state([]);
  let unscheduledTasks: Task[] = $state([]);
  let currentDate = $state(todayStr());
  let autoScheduling = $state(false);

  function todayStr(): string {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  function formatDateLabel(dateStr: string): string {
    const d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
  }

  function prevDay() {
    const d = new Date(currentDate + 'T00:00:00');
    d.setDate(d.getDate() - 1);
    currentDate = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  function nextDay() {
    const d = new Date(currentDate + 'T00:00:00');
    d.setDate(d.getDate() + 1);
    currentDate = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  function goToday() {
    currentDate = todayStr();
  }

  async function loadData() {
    try {
      const [scheduled, unscheduled] = await Promise.all([
        invoke<Task[]>('get_scheduled_tasks', { date: currentDate }),
        invoke<Task[]>('get_unscheduled_tasks', { date: currentDate }),
      ]);
      scheduledTasks = scheduled;
      unscheduledTasks = unscheduled;
    } catch (err) {
      console.error('Schedule load failed:', err);
    }
  }

  $effect(() => {
    const _date = currentDate;
    const _v = $taskMutationVersion;
    loadData();
  });

  async function handleAutoSchedule() {
    autoScheduling = true;
    try {
      await invoke('auto_schedule_tasks', { date: currentDate, startHour: START_HOUR, endHour: END_HOUR });
      taskMutationVersion.update(v => v + 1);
    } catch (err) {
      console.error('Auto-schedule failed:', err);
    } finally {
      autoScheduling = false;
    }
  }

  // drag from pool to timeline
  let draggedTaskId: string | null = $state(null);

  function onPoolDragStart(e: DragEvent, task: Task) {
    draggedTaskId = task.id;
    e.dataTransfer!.effectAllowed = 'move';
    e.dataTransfer!.setData('text/plain', task.id);
  }

  function onTimelineDragOver(e: DragEvent) {
    e.preventDefault();
    e.dataTransfer!.dropEffect = 'move';
  }

  async function onTimelineDrop(e: DragEvent) {
    e.preventDefault();
    const taskId = draggedTaskId;
    if (!taskId) return;

    const timeline = (e.currentTarget as HTMLElement);
    const rect = timeline.getBoundingClientRect();
    const scrollTop = timeline.scrollTop;
    const y = e.clientY - rect.top + scrollTop;
    const totalMinutes = (y / HOUR_HEIGHT) * 60 + START_HOUR * 60;
    const snapped = Math.round(totalMinutes / SNAP_MINUTES) * SNAP_MINUTES;
    const hour = Math.floor(snapped / 60);
    const min = snapped % 60;

    const task = unscheduledTasks.find(t => t.id === taskId) ?? scheduledTasks.find(t => t.id === taskId);
    const duration = task?.estimatedMinutes ?? 30;
    const endMinutes = snapped + duration;
    const endHour = Math.floor(endMinutes / 60);
    const endMin = endMinutes % 60;

    const startStr = `${currentDate}T${String(hour).padStart(2, '0')}:${String(min).padStart(2, '0')}:00`;
    const endStr = `${currentDate}T${String(endHour).padStart(2, '0')}:${String(endMin).padStart(2, '0')}:00`;

    await editTask(taskId, { scheduledStart: startStr, scheduledEnd: endStr });
    draggedTaskId = null;
    taskMutationVersion.update(v => v + 1);
  }

  // compute position for a scheduled block
  function blockStyle(task: Task): string {
    if (!task.scheduledStart || !task.scheduledEnd) return 'display:none';
    const startMin = timeToMinutes(task.scheduledStart);
    const endMin = timeToMinutes(task.scheduledEnd);
    const top = ((startMin - START_HOUR * 60) / 60) * HOUR_HEIGHT;
    const height = ((endMin - startMin) / 60) * HOUR_HEIGHT;
    return `top:${top}px;height:${Math.max(height, 20)}px`;
  }

  function timeToMinutes(iso: string): number {
    const tIdx = iso.indexOf('T');
    if (tIdx < 0) return 0;
    const parts = iso.slice(tIdx + 1).split(':');
    return parseInt(parts[0]) * 60 + parseInt(parts[1]);
  }

  function formatTime(iso: string): string {
    const tIdx = iso.indexOf('T');
    if (tIdx < 0) return '';
    return iso.slice(tIdx + 1, tIdx + 6);
  }

  const PRIORITY_COLORS: Record<number, string> = {
    0: 'var(--color-border, #32353a)',
    1: 'var(--color-priority-low)',
    2: 'var(--color-priority-med)',
    3: 'var(--color-priority-high)',
  };

  function formatShortDate(iso: string): string {
    const d = new Date(iso.slice(0, 10) + 'T00:00:00');
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }
  function dateRangeBadge(task: Task): string | null {
    const s = task.startDate;
    const d = task.dueDate;
    if (s && d) return `${formatShortDate(s)}–${formatShortDate(d)}`;
    if (d) return `by ${formatShortDate(d)}`;
    if (s) return `from ${formatShortDate(s)}`;
    return null;
  }

  function isAllDay(task: Task): boolean {
    if (task.scheduledStart && task.scheduledStart.includes('T')) return false;
    if (task.dueDate && task.dueDate.includes('T')) return false;
    return true;
  }

  let allDayScheduled = $derived(unscheduledTasks.filter(isAllDay));
  let timedUnscheduled = $derived(unscheduledTasks.filter(t => !isAllDay(t)));

  let hours = $derived(Array.from({ length: TOTAL_HOURS }, (_, i) => START_HOUR + i));
  let isToday = $derived(currentDate === todayStr());
</script>

<div class="schedule-view">
  <div class="schedule-header">
    <button class="sch-nav-btn" onclick={prevDay} aria-label="Previous day">
      <svg width="16" height="16" viewBox="0 0 12 12" fill="none"><path d="M7.5 2.25L3.75 6L7.5 9.75" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
    </button>
    <h2 class="sch-date-label">{formatDateLabel(currentDate)}</h2>
    <button class="sch-nav-btn" onclick={nextDay} aria-label="Next day">
      <svg width="16" height="16" viewBox="0 0 12 12" fill="none"><path d="M4.5 2.25L8.25 6L4.5 9.75" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
    </button>
    {#if !isToday}
      <button class="sch-today-btn" onclick={goToday}>Today</button>
    {/if}
    <button class="sch-auto-btn" onclick={handleAutoSchedule} disabled={autoScheduling}>
      {autoScheduling ? 'Scheduling...' : 'Auto-Schedule'}
    </button>
  </div>

  {#if allDayScheduled.length > 0}
    <div class="allday-section">
      <div class="allday-label">All Day</div>
      <div class="allday-tasks">
        {#each allDayScheduled as task (task.id)}
          <div class="allday-chip" style:border-left-color={PRIORITY_COLORS[task.priority] ?? 'transparent'}>
            {task.title}
          </div>
        {/each}
      </div>
    </div>
  {/if}

  <div class="schedule-body">
    <!-- unscheduled task pool -->
    <aside class="task-pool">
      <div class="pool-header">Unscheduled ({timedUnscheduled.length})</div>
      <div class="pool-list">
        {#each timedUnscheduled as task (task.id)}
          <div
            class="pool-task"
            draggable="true"
            ondragstart={(e) => onPoolDragStart(e, task)}
            style:border-left-color={PRIORITY_COLORS[task.priority] ?? 'transparent'}
          >
            <span class="pool-task-title">{task.title}</span>
            {#if dateRangeBadge(task)}
              <span class="pool-task-dates">{dateRangeBadge(task)}</span>
            {/if}
            <span class="pool-task-duration">{task.estimatedMinutes ?? 30}m</span>
          </div>
        {/each}
        {#if unscheduledTasks.length === 0}
          <div class="pool-empty">All tasks scheduled</div>
        {/if}
      </div>
    </aside>

    <!-- timeline -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="timeline" ondragover={onTimelineDragOver} ondrop={onTimelineDrop}>
      <div class="timeline-inner" style="height:{TOTAL_HOURS * HOUR_HEIGHT}px">
        {#each hours as hour}
          <div class="hour-row" style="height:{HOUR_HEIGHT}px">
            <span class="hour-label">{String(hour).padStart(2, '0')}:00</span>
            <div class="hour-line"></div>
          </div>
        {/each}

        <!-- scheduled blocks -->
        {#each scheduledTasks as task (task.id)}
          <div
            class="time-block"
            style="{blockStyle(task)};border-left-color:{PRIORITY_COLORS[task.priority] ?? 'transparent'}"
            draggable="true"
            ondragstart={(e) => { draggedTaskId = task.id; e.dataTransfer!.effectAllowed = 'move'; e.dataTransfer!.setData('text/plain', task.id); }}
          >
            <span class="block-title">{task.title}</span>
            <span class="block-time">{formatTime(task.scheduledStart!)}&ndash;{formatTime(task.scheduledEnd!)}</span>
          </div>
        {/each}
      </div>
    </div>
  </div>
</div>

<style>
  .allday-section {
    display: flex; align-items: center; gap: 8px;
    padding: 4px 16px; flex-shrink: 0;
    border-bottom: 1px solid var(--color-border-subtle, #292c30);
  }
  .allday-label {
    font-size: 10px; font-weight: 600; text-transform: uppercase;
    color: var(--color-text-muted, #90918d);
    min-width: 50px;
  }
  .allday-tasks { display: flex; flex-wrap: wrap; gap: 4px; }
  .allday-chip {
    font-size: 11px; padding: 2px 8px;
    background: var(--color-surface-0, #25282c);
    border: 1px solid var(--color-border-subtle, #292c30);
    border-left: 3px solid var(--color-border, #32353a);
    border-radius: 4px;
    color: var(--color-text-primary, #d4d4d4);
  }
  .schedule-view { display: flex; flex-direction: column; height: 100%; overflow: hidden; }
  .schedule-header {
    display: flex; align-items: center; gap: 12px;
    padding: 16px; flex-shrink: 0;
  }
  .sch-date-label {
    font-size: 18px; font-weight: 600;
    color: var(--color-text-primary, #d4d4d4);
    margin: 0; min-width: 200px; text-align: center;
  }
  .sch-nav-btn {
    display: flex; align-items: center; justify-content: center;
    width: 32px; height: 32px;
    background: var(--color-panel, #202225);
    border: 1px solid var(--color-border, #32353a);
    border-radius: 8px;
    color: var(--color-text-primary, #d4d4d4);
    cursor: pointer; padding: 0;
  }
  .sch-nav-btn:hover { background: var(--color-surface-hover, #2a2e33); }
  .sch-today-btn, .sch-auto-btn {
    padding: 6px 12px; border-radius: 8px;
    border: 1px solid var(--color-border, #32353a);
    background: var(--color-panel, #202225);
    color: var(--color-text-primary, #d4d4d4);
    font-size: 12px; cursor: pointer; font-family: inherit;
    transition: background 150ms ease;
  }
  .sch-today-btn:hover, .sch-auto-btn:hover { background: var(--color-surface-hover, #2a2e33); }
  .sch-auto-btn { margin-left: auto; background: var(--color-accent, #6c93c7); border-color: var(--color-accent, #6c93c7); color: var(--color-on-accent, #f7f7f5); font-weight: 500; }
  .sch-auto-btn:hover { opacity: 0.9; }
  .sch-auto-btn:disabled { opacity: 0.5; cursor: default; }
  .schedule-body { display: flex; flex: 1; overflow: hidden; }
  .task-pool {
    width: 200px; flex-shrink: 0;
    border-right: 1px solid var(--color-border-subtle, #292c30);
    display: flex; flex-direction: column; overflow: hidden;
  }
  .pool-header {
    padding: 10px 12px; font-size: 12px; font-weight: 600;
    text-transform: uppercase; letter-spacing: 0.05em;
    color: var(--color-text-muted, #90918d);
    border-bottom: 1px solid var(--color-border-subtle, #292c30);
  }
  .pool-list { flex: 1; overflow-y: auto; padding: 4px; }
  .pool-task {
    display: flex; align-items: center; gap: 6px;
    padding: 6px 8px; border-radius: 6px;
    border-left: 3px solid transparent;
    cursor: grab; font-size: 13px;
    color: var(--color-text-primary, #d4d4d4);
    transition: background 150ms ease;
  }
  .pool-task:hover { background: var(--color-surface-hover, #2a2e33); }
  .pool-task-title { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .pool-task-dates {
    font-size: 10px; color: var(--color-text-muted, #90918d);
    background: var(--color-surface-1, #2d3136);
    padding: 1px 5px; border-radius: 3px; flex-shrink: 0;
    white-space: nowrap;
  }
  .pool-task-duration {
    font-size: 11px; color: var(--color-text-muted, #90918d);
    background: var(--color-surface-0, #25282c);
    padding: 1px 6px; border-radius: 4px; flex-shrink: 0;
  }
  .pool-empty { padding: 12px; font-size: 12px; color: var(--color-text-muted, #90918d); font-style: italic; }
  .timeline { flex: 1; overflow-y: auto; position: relative; }
  .timeline-inner { position: relative; min-width: 100%; }
  .hour-row {
    display: flex; align-items: flex-start;
    border-top: 1px solid var(--color-border-subtle, #292c30);
    position: relative;
  }
  .hour-label {
    width: 52px; flex-shrink: 0; padding: 4px 8px 0;
    font-size: 11px; color: var(--color-text-muted, #90918d);
    text-align: right;
  }
  .hour-line { flex: 1; }
  .time-block {
    position: absolute; left: 60px; right: 8px;
    background: var(--color-surface-1, #2d3136);
    border: 1px solid var(--color-border-subtle, #292c30);
    border-left: 3px solid transparent;
    border-radius: 6px; padding: 4px 8px;
    cursor: grab; overflow: hidden;
    display: flex; flex-direction: column; gap: 2px;
    transition: box-shadow 150ms ease;
  }
  .time-block:hover { box-shadow: 0 2px 8px rgba(0,0,0,0.3); }
  .block-title {
    font-size: 12px; font-weight: 500;
    color: var(--color-text-primary, #d4d4d4);
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .block-time { font-size: 10px; color: var(--color-text-muted, #90918d); }
</style>
