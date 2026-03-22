<script lang="ts">
  interface ContextMenuItem {
    label: string;
    icon?: string;
    action?: () => void;
    danger?: boolean;
    disabled?: boolean;
    separator?: boolean;
    submenu?: ContextMenuItem[];
  }

  interface Props {
    x?: number;
    y?: number;
    items?: ContextMenuItem[];
    open?: boolean;
    onclose?: () => void;
  }

  let {
    x = 0,
    y = 0,
    items = [] as ContextMenuItem[],
    open = false,
    onclose = () => {},
  }: Props = $props();

  let menuRef: HTMLDivElement | undefined = $state(undefined);
  let activeSubmenuIndex: number | null = $state(null);

  // Adjust position so menu doesn't overflow viewport
  let adjustedX = $derived.by(() => {
    if (typeof window === 'undefined') return x;
    const menuWidth = 200;
    return x + menuWidth > window.innerWidth ? window.innerWidth - menuWidth - 8 : x;
  });

  let adjustedY = $derived.by(() => {
    if (typeof window === 'undefined') return y;
    const menuHeight = items.length * 34 + 8;
    return y + menuHeight > window.innerHeight ? window.innerHeight - menuHeight - 8 : y;
  });

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      onclose();
    }
  }

  function handleClickOutside(e: MouseEvent) {
    if (menuRef && !menuRef.contains(e.target as Node)) {
      onclose();
    }
  }

  function handleItemClick(item: ContextMenuItem) {
    if (item.disabled || item.separator) return;
    if (item.submenu && item.submenu.length > 0) return;
    item.action?.();
    onclose();
  }

  $effect(() => {
    if (open) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('keydown', handleKeydown);
      return () => {
        document.removeEventListener('mousedown', handleClickOutside);
        document.removeEventListener('keydown', handleKeydown);
      };
    }
  });

  $effect(() => {
    if (!open) {
      activeSubmenuIndex = null;
    }
  });
</script>

{#if open}
  <div
    bind:this={menuRef}
    class="context-menu"
    style:left="{adjustedX}px"
    style:top="{adjustedY}px"
    role="menu"
  >
    {#each items as item, i}
      {#if item.separator}
        <div class="separator"></div>
      {:else if item.submenu && item.submenu.length > 0}
        <div
          class="menu-item has-submenu"
          class:danger={item.danger}
          class:disabled={item.disabled}
          onmouseenter={() => (activeSubmenuIndex = i)}
          onmouseleave={() => {
            if (activeSubmenuIndex === i) activeSubmenuIndex = null;
          }}
          role="menuitem"
          tabindex={item.disabled ? -1 : 0}
        >
          {#if item.icon}
            <span class="menu-icon">{item.icon}</span>
          {/if}
          <span class="menu-label">{item.label}</span>
          <span class="submenu-arrow">&#9654;</span>

          {#if activeSubmenuIndex === i}
            <div class="submenu" role="menu">
              {#each item.submenu as sub}
                {#if sub.separator}
                  <div class="separator"></div>
                {:else}
                  <button
                    class="menu-item"
                    class:danger={sub.danger}
                    class:disabled={sub.disabled}
                    onclick={(e) => {
                      e.stopPropagation();
                      if (!sub.disabled) {
                        sub.action?.();
                        onclose();
                      }
                    }}
                    disabled={sub.disabled}
                    role="menuitem"
                  >
                    {#if sub.icon}
                      <span class="menu-icon">{sub.icon}</span>
                    {/if}
                    <span class="menu-label">{sub.label}</span>
                  </button>
                {/if}
              {/each}
            </div>
          {/if}
        </div>
      {:else}
        <button
          class="menu-item"
          class:danger={item.danger}
          class:disabled={item.disabled}
          onclick={() => handleItemClick(item)}
          disabled={item.disabled}
          role="menuitem"
        >
          {#if item.icon}
            <span class="menu-icon">{item.icon}</span>
          {/if}
          <span class="menu-label">{item.label}</span>
        </button>
      {/if}
    {/each}
  </div>
{/if}

<style>
  .context-menu {
    position: fixed;
    z-index: 9999;
    min-width: 180px;
    max-width: 260px;
    padding: 4px;
    background: var(--color-bg-secondary, #181825);
    border: 1px solid var(--color-border-subtle, #313244);
    border-radius: 8px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
  }

  .separator {
    height: 1px;
    background: var(--color-border-subtle, #313244);
    margin: 4px 8px;
  }

  .menu-item {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 6px 12px;
    border: none;
    border-radius: 6px;
    background: none;
    color: var(--color-text-primary, #cdd6f4);
    font-size: 13px;
    font-family: inherit;
    cursor: pointer;
    text-align: left;
    position: relative;
    transition: background 120ms ease;
  }

  .menu-item:hover:not(.disabled) {
    background: var(--color-surface-0, #313244);
  }

  .menu-item.danger {
    color: var(--color-danger, #f38ba8);
  }

  .menu-item.danger:hover:not(.disabled) {
    background: color-mix(in srgb, var(--color-danger, #f38ba8) 15%, transparent);
  }

  .menu-item.disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .menu-icon {
    flex-shrink: 0;
    width: 16px;
    text-align: center;
    font-size: 14px;
  }

  .menu-label {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .submenu-arrow {
    font-size: 8px;
    color: var(--color-text-muted, #a6adc8);
    margin-left: auto;
  }

  .submenu {
    position: absolute;
    left: 100%;
    top: 0;
    min-width: 160px;
    padding: 4px;
    background: var(--color-bg-secondary, #181825);
    border: 1px solid var(--color-border-subtle, #313244);
    border-radius: 8px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
  }
</style>
