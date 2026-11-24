# Archived ACP adapter

Hot Cross Buns previously exposed a coding-oriented Agent Client Protocol adapter through
`hot-cross-buns agent acp` and `hot-cross-buns --mode acp`. Those entry points are retired. Hot Cross Buns's
product surface is the local browser conversation for persistent goals, knowledge,
and recurring work. Local automation can use the Work JSONL protocol through
`HOT_CROSS_BUNS_INTERNAL_COMMANDS=1 go run ./cmd/hot-cross-buns work-rpc`
from a source checkout. See [Development](DEVELOPMENT.md).

The former adapter's implementation and tests remain in `internal/acp` as
historical regression material. It is not launched by the private application runtime, and its
Code-required `execute` mode is not a supported product path.
