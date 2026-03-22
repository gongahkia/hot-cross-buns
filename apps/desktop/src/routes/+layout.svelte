<script lang="ts">
  import { onMount } from 'svelte';
  import { initTheme } from '$lib/stores/theme';
  import '../app.css';

  let { children } = $props();

  onMount(() => {
    initTheme();
  });
</script>

{@render children()}
