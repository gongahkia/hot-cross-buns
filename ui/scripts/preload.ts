import "@opentui/solid/preload"

// terminal test hosts inherit the same startup identity as the launcher.
process.env.HOT_CROSS_BUNS_UI_FRONTEND ??= "terminal"
