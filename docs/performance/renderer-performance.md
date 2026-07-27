# Qt Quick UI Performance

Qt Quick must remain responsive with dense local cache data. QML owns visible presentation; C++ owns filtering, shaping, range layout, and persistence.

## Rules

- Use `QAbstractItemModel` and visible/range-bounded delegates.
- Do not bind account-wide event instances through `Repeater` or create a delegate for every cached row.
- Keep search debounce/model replacement bounded; filtering and ranking stay in C++.
- Keep dialog creation lazy and do not mount hidden dense views unnecessarily.
- Profile Day and Week on a physical display; offscreen QML tests cannot prove scroll smoothness.

## Current evidence

The native wrapper-scale fixture records local search, task rendering/scrolling, Calendar navigation, and sync application. See [main and data performance](main-and-data-performance.md). Old Electron renderer metrics are historical and invalid for the Qt app.
