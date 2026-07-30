# Photo-mode visual regression

`photo_mode_visual_regression_test.gd` enters real photo mode and locks the observable visual contract: initial camera state, FOV, exposure, far depth-of-field, filter values, restoration of the pre-existing environment adjustment, HUD/player state, and no player-position mutation.

It is intentionally state-based rather than image-pixel-based. The project policy excludes cross-platform GPU output from deterministic identity, while the headless renderer does not provide a stable photographic baseline. Hardware screenshot comparison, driver-specific DOF quality, font rasterization, and subjective composition review remain manual release checks.
