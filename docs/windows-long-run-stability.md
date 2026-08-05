# Windows long-run stability

`windows_long_run_stability_test.gd` runs the same three-lap expedition soak on Windows: it validates active/far/preload/cache bounds, chunk payload accounting, return-lap memory stabilization, photo-mode re-entry, and repeated origin rebases. The test exits immediately on non-Windows hosts.

The Windows export workflow runs this fixture before packaging; see [windows-export-validation.md](windows-export-validation.md).

Run the Windows path with the Windows Godot executable:

```powershell
Godot.exe --headless --path . --script res://scripts/windows_long_run_stability_test.gd
```

It is a bounded integration soak, not a hardware certification, wall-clock endurance test, GPU leak detector, or exported-app certification.
