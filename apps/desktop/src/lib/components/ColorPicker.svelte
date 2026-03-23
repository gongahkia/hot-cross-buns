<script lang="ts">
  /** Muted Notion and Obsidian-inspired palette for lists and tags. */
  const COLORS = [
    { name: 'Gray', hex: '#7f7f7f' },
    { name: 'Slate', hex: '#6b7280' },
    { name: 'Brown', hex: '#aa755f' },
    { name: 'Orange', hex: '#d9730d' },
    { name: 'Yellow', hex: '#ca8e1b' },
    { name: 'Green', hex: '#2d9964' },
    { name: 'Blue', hex: '#2e7cd1' },
    { name: 'Purple', hex: '#8d5bc1' },
    { name: 'Pink', hex: '#c94079' },
    { name: 'Red', hex: '#cd4945' },
  ];

  let {
    selected = null,
    onselect = (_hex: string) => {},
  }: {
    selected?: string | null;
    onselect?: (hex: string) => void;
  } = $props();

  function handleClick(hex: string) {
    onselect(hex);
  }

  function isSelected(hex: string): boolean {
    if (!selected) return false;
    return selected.toLowerCase() === hex.toLowerCase();
  }
</script>

<div class="color-picker" role="radiogroup" aria-label="Pick a color">
  {#each COLORS as color}
    <button
      class="color-swatch"
      class:selected={isSelected(color.hex)}
      style:background-color={color.hex}
      onclick={() => handleClick(color.hex)}
      aria-label={color.name}
      title={color.name}
      role="radio"
      aria-checked={isSelected(color.hex)}
    >
      {#if isSelected(color.hex)}
        <svg
          class="checkmark"
          width="14"
          height="14"
          viewBox="0 0 14 14"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden="true"
        >
          <path
            d="M3 7L6 10L11 4"
            stroke="#ffffff"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
      {/if}
    </button>
  {/each}
</div>

<style>
  .color-picker {
    display: grid;
    grid-template-columns: repeat(5, 24px);
    gap: 8px;
    padding: 4px;
  }

  .color-swatch {
    width: 24px;
    height: 24px;
    border-radius: 50%;
    border: 2px solid transparent;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    transition: border-color 150ms ease, transform 150ms ease;
  }

  .color-swatch:hover {
    transform: scale(1.15);
    border-color: var(--color-text-muted, #90918d);
  }

  .color-swatch:focus-visible {
    outline: 2px solid var(--color-accent, #6c93c7);
    outline-offset: 2px;
  }

  .color-swatch.selected {
    border-color: var(--color-text-primary, #d4d4d4);
    transform: scale(1.1);
  }

  .checkmark {
    pointer-events: none;
    filter: drop-shadow(0 1px 1px rgba(0, 0, 0, 0.3));
  }
</style>
