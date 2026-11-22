# Archived ACP adapter

Hot Cross Buns previously exposed a coding-oriented Agent Client Protocol adapter through
`hot-cross-buns agent acp` and `hot-cross-buns --mode acp`. Those entry points are retired. Hot Cross Buns's
product surface is the terminal conversation for persistent goals, knowledge,
and recurring work. Local automation can use the Work JSONL protocol through
`hot-cross-buns work-rpc`.

The former adapter's implementation and tests remain in `internal/acp` as
historical regression material. It is not launched by the Hot Cross Buns CLI, and its
Code-required `execute` mode is not a supported product path.
