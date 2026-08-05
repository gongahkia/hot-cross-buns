# macOS long-run stability

`macos_long_run_stability_test.gd` runs three forced-streaming out-and-back expeditions on macOS. Every stop validates active/far windows, bounded preload work, cache capacity, and chunk payload accounting; each return checks that static memory does not grow beyond 10% plus a 1 MiB allocator allowance. It also re-enters/exits photo mode per lap and requires repeated floating-origin rebases.

The fixture skips non-macOS hosts and is headless-only. It is a bounded integration soak, not a hardware certification, 15-minute wall-clock play session, GPU leak detector, exported-app test, or substitute for the separate Windows workflow.
