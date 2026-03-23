<script lang="ts">
  let { onDone }: { onDone: () => void } = $props();

  let step = $state(0);
  const totalSteps = 3;

  const steps = [
    {
      title: 'Welcome to Cross 2',
      description: 'A fast, keyboard-driven task manager built for people who get things done.',
      illustration: 'task-list',
    },
    {
      title: 'Organize with Lists & Tags',
      description: 'Create lists for different projects and tag tasks for quick filtering.',
      illustration: 'organize',
    },
    {
      title: 'Stay on Top with Due Dates',
      description: 'Set due dates, recurring tasks, and priorities to never miss a deadline.',
      illustration: 'calendar',
    },
  ];

  function next() {
    if (step < totalSteps - 1) {
      step += 1;
    } else {
      onDone();
    }
  }

  function prev() {
    if (step > 0) {
      step -= 1;
    }
  }

  function skip() {
    onDone();
  }

  let current = $derived(steps[step]);
  let isLast = $derived(step === totalSteps - 1);
</script>

<div class="onboarding-overlay" role="dialog" aria-modal="true" aria-label="Welcome walkthrough">
  <div class="onboarding-card">
    <div class="illustration" aria-hidden="true">
      {#if current.illustration === 'task-list'}
        <svg width="120" height="80" viewBox="0 0 120 80" fill="none">
          <rect x="10" y="10" width="100" height="60" rx="8" stroke="currentColor" stroke-width="2" />
          <line x1="30" y1="30" x2="90" y2="30" stroke="currentColor" stroke-width="2" />
          <line x1="30" y1="45" x2="80" y2="45" stroke="currentColor" stroke-width="2" />
          <line x1="30" y1="55" x2="70" y2="55" stroke="currentColor" stroke-width="2" opacity="0.5" />
          <rect x="18" y="26" width="8" height="8" rx="2" stroke="currentColor" stroke-width="1.5" />
          <rect x="18" y="41" width="8" height="8" rx="2" stroke="currentColor" stroke-width="1.5" />
          <rect x="18" y="51" width="8" height="8" rx="2" stroke="currentColor" stroke-width="1.5" />
        </svg>
      {:else if current.illustration === 'organize'}
        <svg width="120" height="80" viewBox="0 0 120 80" fill="none">
          <rect x="5" y="15" width="35" height="50" rx="6" stroke="currentColor" stroke-width="2" />
          <rect x="42" y="15" width="35" height="50" rx="6" stroke="currentColor" stroke-width="2" />
          <rect x="80" y="15" width="35" height="50" rx="6" stroke="currentColor" stroke-width="2" />
          <text x="22" y="35" fill="currentColor" font-size="8" text-anchor="middle">Work</text>
          <text x="60" y="35" fill="currentColor" font-size="8" text-anchor="middle">Home</text>
          <text x="97" y="35" fill="currentColor" font-size="8" text-anchor="middle">Ideas</text>
        </svg>
      {:else}
        <svg width="120" height="80" viewBox="0 0 120 80" fill="none">
          <rect x="10" y="10" width="100" height="60" rx="8" stroke="currentColor" stroke-width="2" />
          <line x1="10" y1="25" x2="110" y2="25" stroke="currentColor" stroke-width="1.5" />
          <text x="60" y="20" fill="currentColor" font-size="8" text-anchor="middle">March 2026</text>
          {#each Array(7) as _, i}
            <text x={18 + i * 14} y="35" fill="currentColor" font-size="6" text-anchor="middle">
              {['M', 'T', 'W', 'T', 'F', 'S', 'S'][i]}
            </text>
          {/each}
          <circle cx="60" cy="50" r="8" stroke="currentColor" stroke-width="1.5" fill="none" />
          <text x="60" y="53" fill="currentColor" font-size="7" text-anchor="middle">15</text>
        </svg>
      {/if}
    </div>

    <h2 class="title">{current.title}</h2>
    <p class="description">{current.description}</p>

    <div class="dots" role="group" aria-label="Step indicators">
      {#each steps as _, i (i)}
        <span
          class="dot"
          class:active={i === step}
          aria-label="Step {i + 1} of {totalSteps}"
        ></span>
      {/each}
    </div>

    <div class="actions">
      {#if step > 0}
        <button class="btn secondary" onclick={prev} aria-label="Previous step">
          Back
        </button>
      {:else}
        <button class="btn secondary" onclick={skip} aria-label="Skip walkthrough">
          Skip
        </button>
      {/if}

      <button class="btn primary" onclick={next} aria-label={isLast ? 'Finish walkthrough' : 'Next step'}>
        {isLast ? 'Done' : 'Next'}
      </button>
    </div>
  </div>
</div>

<style>
  .onboarding-overlay {
    position: fixed;
    inset: 0;
    z-index: 1000;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(0, 0, 0, 0.6);
    backdrop-filter: blur(4px);
  }

  .onboarding-card {
    background: var(--color-bg-primary, #1e1e2e);
    border: 1px solid var(--color-border, #45475a);
    border-radius: 16px;
    padding: 32px;
    max-width: 400px;
    width: 90%;
    text-align: center;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 16px;
  }

  .illustration {
    color: var(--color-accent, #89b4fa);
    margin-bottom: 8px;
  }

  .title {
    font-size: 20px;
    font-weight: 600;
    color: var(--color-text-primary, #cdd6f4);
    margin: 0;
  }

  .description {
    font-size: 14px;
    line-height: 1.6;
    color: var(--color-text-secondary, #bac2de);
    margin: 0;
  }

  .dots {
    display: flex;
    gap: 8px;
  }

  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--color-surface-1, #45475a);
    transition: background 200ms ease;
  }

  .dot.active {
    background: var(--color-accent, #89b4fa);
  }

  .actions {
    display: flex;
    gap: 12px;
    width: 100%;
    justify-content: center;
    margin-top: 8px;
  }

  .btn {
    font-size: 13px;
    font-weight: 500;
    padding: 8px 24px;
    border-radius: 8px;
    border: none;
    cursor: pointer;
    transition: all 150ms ease;
  }

  .btn.primary {
    background: var(--color-accent, #89b4fa);
    color: var(--color-bg-primary, #1e1e2e);
  }

  .btn.primary:hover {
    filter: brightness(1.1);
  }

  .btn.secondary {
    background: var(--color-surface-1, #45475a);
    color: var(--color-text-secondary, #bac2de);
  }

  .btn.secondary:hover {
    background: var(--color-surface-2, #585b70);
  }
</style>
