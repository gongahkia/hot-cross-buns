# Native Main, UI, And Data Performance

Hot Cross Buns is a C++20/Qt 6 desktop app. Qt Quick is presentation-only; C++ services own SQLite, OAuth, Google HTTP, sync, and mutations.

## Rules

- Keep Qt GUI-thread work bounded to model application and visible delegates.
- Run SQLite service work on its writer queue or read pool; use prepared statements and bounded range/page reads.
- Keep Google sync and recurrence-instance refresh cancellable and outside input/render paths.
- Do not pass raw Google payloads, credentials, or unbounded collections to QML.
- Render timeline events only for the visible minute range. `TimelineModel` keeps the full layout separately for move/resize calculations.
- Search is local-first, cancellable, ranked in C++, and debounced before model replacement. Its wrapper-scale median gate is 105ms.
- Notifications are scheduled through macOS `UNUserNotificationCenter`; reminder-state writes are local and idempotent.

## Data Paths

- Task, calendar, note, pending-mutation, sync-checkpoint, FTS, and reminder-state reads require indexed plans.
- Writes that change a local mirror row and queue a mutation are one SQLite transaction.
- Calendar range reads and search return bounded pages. A `hasMore` result must reflect the actual post-filter result set.
- Batch remote writes are used only where operations are independent and Google’s batch semantics preserve the requested behavior.

## Current Wrapper-Scale Gate

The deterministic fixture has 10,000 tasks, 25,000 visible Calendar event instances, 2,000 note projections, 500 recurrence exceptions, and 500 queued mutations. The enforced checks are documented in [Native Wrapper Scale Budgets v1](native-wrapper-scale-budgets-v1.md). Offscreen Qt Quick results are regression signals, not a substitute for physical-display profiling.

The sync-apply benchmark is a release blocker: it must emit its JSON report and complete within 45 seconds. Investigate regressions with the benchmark report and SQLite timing samples; do not raise the limit without repeated CI evidence.
