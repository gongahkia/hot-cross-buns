# `wukong doctor`

`wukong doctor [--project <path>] [--godot-executable <path>] [--offline]`
prints deterministic `ok`/`fail` checks for project discovery, manifest and
lockfile parsing, installed-state hashes, cache permissions and corruption,
project filesystem readability, Godot executable discovery, network proxy
configuration, and the project mutation lock.

It never contacts a network endpoint or executes Godot. Without `--offline`,
it checks configured HTTP(S) proxy values for a scheme prefix and whitespace;
it does not test reachability or full URL validity. `--offline` reports the
network check as skipped.

State and cache corruption checks are non-mutating. The command may create an
empty managed cache root for its disposable permission probe and a persistent
`.wukong/mutation.lock` file while testing advisory locking. Both are safe
managed state; lock-file existence does not mean another operation is active.

After project discovery succeeds, a failed check still allows later independent
checks to run. The command exits using the first failed check's normal
diagnostic category and includes a recovery action on stderr.
