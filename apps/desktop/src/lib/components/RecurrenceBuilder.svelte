<script lang="ts">
  let { value = '', onchange }: { value: string; onchange: (rule: string) => void } = $props();

  type Freq = 'none' | 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';
  const WEEKDAYS = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'] as const;
  const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;
  const FREQ_LABELS: Record<Freq, string> = {
    none: 'None', DAILY: 'Daily', WEEKLY: 'Weekly', MONTHLY: 'Monthly', YEARLY: 'Yearly',
  };
  const FREQ_UNITS: Record<string, string> = {
    DAILY: 'days', WEEKLY: 'weeks', MONTHLY: 'months', YEARLY: 'years',
  };

  let freq: Freq = $state('none');
  let interval = $state(1);
  let selectedDays: Set<string> = $state(new Set());
  let endType: 'never' | 'count' | 'date' = $state('never');
  let endCount = $state(10);
  let endDate = $state('');

  $effect(() => { // hydrate state from incoming value
    parseRrule(value);
  });

  function parseRrule(rule: string) {
    if (!rule || !rule.startsWith('RRULE:')) {
      freq = 'none';
      interval = 1;
      selectedDays = new Set();
      endType = 'never';
      return;
    }
    const parts = rule.replace('RRULE:', '').split(';');
    const map = new Map<string, string>();
    for (const p of parts) {
      const [k, v] = p.split('=');
      if (k && v) map.set(k, v);
    }
    freq = (map.get('FREQ') as Freq) ?? 'none';
    interval = parseInt(map.get('INTERVAL') ?? '1', 10) || 1;
    if (map.has('BYDAY')) {
      selectedDays = new Set(map.get('BYDAY')!.split(','));
    } else {
      selectedDays = new Set();
    }
    if (map.has('COUNT')) {
      endType = 'count';
      endCount = parseInt(map.get('COUNT')!, 10) || 10;
    } else if (map.has('UNTIL')) {
      endType = 'date';
      endDate = map.get('UNTIL')!.slice(0, 10);
    } else {
      endType = 'never';
    }
  }

  function buildRrule(): string {
    if (freq === 'none') return '';
    let parts = [`FREQ=${freq}`];
    if (interval > 1) parts.push(`INTERVAL=${interval}`);
    if (freq === 'WEEKLY' && selectedDays.size > 0) {
      parts.push(`BYDAY=${[...selectedDays].join(',')}`);
    }
    if (endType === 'count' && endCount > 0) {
      parts.push(`COUNT=${endCount}`);
    } else if (endType === 'date' && endDate) {
      parts.push(`UNTIL=${endDate.replace(/-/g, '')}T235959Z`);
    }
    return `RRULE:${parts.join(';')}`;
  }

  function emitChange() {
    onchange(buildRrule());
  }

  function setFreq(f: Freq) {
    freq = f;
    if (f !== 'WEEKLY') selectedDays = new Set();
    emitChange();
  }

  function toggleDay(day: string) {
    const next = new Set(selectedDays);
    if (next.has(day)) next.delete(day);
    else next.add(day);
    selectedDays = next;
    emitChange();
  }

  function onIntervalChange(e: Event) {
    interval = Math.max(1, parseInt((e.target as HTMLInputElement).value, 10) || 1);
    emitChange();
  }

  function setEndType(t: 'never' | 'count' | 'date') {
    endType = t;
    emitChange();
  }

  function onEndCountChange(e: Event) {
    endCount = Math.max(1, parseInt((e.target as HTMLInputElement).value, 10) || 1);
    emitChange();
  }

  function onEndDateChange(e: Event) {
    endDate = (e.target as HTMLInputElement).value;
    emitChange();
  }
</script>

<div class="recurrence-builder">
  <div class="freq-row">
    {#each Object.entries(FREQ_LABELS) as [key, label]}
      <button
        class="freq-btn"
        class:active={freq === key}
        onclick={() => setFreq(key as Freq)}
      >{label}</button>
    {/each}
  </div>

  {#if freq !== 'none'}
    <div class="interval-row">
      <span class="interval-label">Every</span>
      <input
        class="interval-input"
        type="number"
        min="1"
        value={interval}
        oninput={onIntervalChange}
      />
      <span class="interval-unit">{FREQ_UNITS[freq]}</span>
    </div>

    {#if freq === 'WEEKLY'}
      <div class="weekday-row">
        {#each WEEKDAYS as day, i}
          <button
            class="weekday-btn"
            class:active={selectedDays.has(day)}
            onclick={() => toggleDay(day)}
          >{WEEKDAY_LABELS[i]}</button>
        {/each}
      </div>
    {/if}

    <div class="end-section">
      <span class="end-label">Ends</span>
      <div class="end-options">
        <label class="end-option">
          <input type="radio" name="end" checked={endType === 'never'} onchange={() => setEndType('never')} />
          <span>Never</span>
        </label>
        <label class="end-option">
          <input type="radio" name="end" checked={endType === 'count'} onchange={() => setEndType('count')} />
          <span>After</span>
          {#if endType === 'count'}
            <input class="end-count-input" type="number" min="1" value={endCount} oninput={onEndCountChange} />
            <span>times</span>
          {/if}
        </label>
        <label class="end-option">
          <input type="radio" name="end" checked={endType === 'date'} onchange={() => setEndType('date')} />
          <span>By</span>
          {#if endType === 'date'}
            <input class="end-date-input" type="date" value={endDate} onchange={onEndDateChange} />
          {/if}
        </label>
      </div>
    </div>
  {/if}
</div>

<style>
  .recurrence-builder { display: flex; flex-direction: column; gap: 10px; }
  .freq-row { display: flex; gap: 4px; }
  .freq-btn {
    flex: 1;
    padding: 5px 0;
    border: 1px solid var(--color-border, #32353a);
    border-radius: 6px;
    background: var(--color-input, #17181a);
    color: var(--color-text-muted, #90918d);
    font-size: 11px;
    font-weight: 500;
    cursor: pointer;
    transition: all 150ms ease;
    font-family: inherit;
  }
  .freq-btn:hover { border-color: var(--color-accent, #6c93c7); color: var(--color-text-primary, #d4d4d4); }
  .freq-btn.active {
    background: color-mix(in srgb, var(--color-accent, #6c93c7) 15%, transparent);
    border-color: var(--color-accent, #6c93c7);
    color: var(--color-accent, #6c93c7);
  }
  .interval-row { display: flex; align-items: center; gap: 8px; }
  .interval-label, .interval-unit {
    font-size: 12px;
    color: var(--color-text-secondary, #b6b6b2);
  }
  .interval-input {
    width: 56px;
    padding: 4px 8px;
    border: 1px solid var(--color-border, #32353a);
    border-radius: 6px;
    background: var(--color-input, #17181a);
    color: var(--color-text-primary, #d4d4d4);
    font-size: 12px;
    font-family: inherit;
    text-align: center;
    outline: none;
  }
  .interval-input:focus { border-color: var(--color-accent, #6c93c7); }
  .weekday-row { display: flex; gap: 4px; }
  .weekday-btn {
    flex: 1;
    padding: 4px 0;
    border: 1px solid var(--color-border, #32353a);
    border-radius: 6px;
    background: var(--color-input, #17181a);
    color: var(--color-text-muted, #90918d);
    font-size: 11px;
    cursor: pointer;
    transition: all 150ms ease;
    font-family: inherit;
  }
  .weekday-btn:hover { border-color: var(--color-accent, #6c93c7); }
  .weekday-btn.active {
    background: color-mix(in srgb, var(--color-accent, #6c93c7) 15%, transparent);
    border-color: var(--color-accent, #6c93c7);
    color: var(--color-accent, #6c93c7);
  }
  .end-section { display: flex; flex-direction: column; gap: 6px; }
  .end-label {
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--color-text-muted, #90918d);
  }
  .end-options { display: flex; flex-direction: column; gap: 6px; }
  .end-option {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    color: var(--color-text-secondary, #b6b6b2);
    cursor: pointer;
  }
  .end-option input[type="radio"] { accent-color: var(--color-accent, #6c93c7); }
  .end-count-input {
    width: 48px;
    padding: 3px 6px;
    border: 1px solid var(--color-border, #32353a);
    border-radius: 6px;
    background: var(--color-input, #17181a);
    color: var(--color-text-primary, #d4d4d4);
    font-size: 12px;
    font-family: inherit;
    text-align: center;
    outline: none;
  }
  .end-count-input:focus { border-color: var(--color-accent, #6c93c7); }
  .end-date-input {
    padding: 3px 6px;
    border: 1px solid var(--color-border, #32353a);
    border-radius: 6px;
    background: var(--color-input, #17181a);
    color: var(--color-text-primary, #d4d4d4);
    font-size: 12px;
    font-family: inherit;
    outline: none;
  }
  .end-date-input:focus { border-color: var(--color-accent, #6c93c7); }
</style>
