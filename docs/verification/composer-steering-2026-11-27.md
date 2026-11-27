# Composer stop and steering

The composer reuses its circular send control for stopping active work. With an
empty composer it shows a filled square; typing restores the send arrow. The
separate Stop text under progress is removed. Empty Enter does not cancel work.

Ordinary text submitted during a steerable operation goes to that operation by
default. It is retained as a dialogue turn, including its retry identity. Early
guidance waits for the same foreground operation's control channel to attach.
Delivery uses the existing steering mechanism: the worker consumes instructions
at its next supported boundary, rather than restarting an in-flight model call.

The native owner checks the current operation before accepting guidance or stop.
The main conversation can stop its sole live child; unrelated workers and
ambiguous sets of children do not receive guessed stop controls. Ambiguous
steering asks which task to use. Plan and action reviews retain their exact
review boundaries; attachments retain normal input admission.

## Verification

- `go test ./internal/workapp` passed.
- `node --test web/tests/steering.test.mjs web/tests/composer-action.test.mjs`
  passed all five tests. These exercise the real Go runtime and browser gateway
  with a controlled provider: foreground and background steering reach the
  worker's model input without another operation, duplicate admission is
  idempotent, altered retries are rejected, and stale stop controls cannot stop
  replacement work.
- The first foreground gateway test exposed an operation-attachment race. It
  passed after retaining early steering and retrying admission when the
  operation attaches or finishes.
- `make check` passed with Node 26.7.0 and canonicalized `TMPDIR`: Go tests,
  `go vet`, 200 web tests, 148 host tests and the OAuth build test. No Node tests
  were skipped. Some unchanged Go packages used the Go test cache.
- T3 browser interaction at desktop and 390-pixel width verified the stop icon,
  existing circular geometry, absence of the separate Stop button, typing to
  steer, retained follow-up text and guidance acknowledgement, empty Enter,
  actual cancellation and restoration of the send arrow. The narrow composer
  had no horizontal overflow.

No live cloud-model or external side-effect requests were needed for this change.
These checks establish instruction delivery and cancellation; the model's
interpretation of any particular steering instruction remains task-dependent.
