# Dependency provenance audit

`wukong audit` reads `wukong.lock` without fetching sources or changing the
project. It reports packages in canonical name order with their source kind,
canonical source, immutable identity, Git revision when applicable, source
checksum when applicable, and prepared-package checksum.

```sh
wukong audit
wukong audit --json
```

`--json` emits schema `1`. The baseline reports
`"signature_verification":"not_implemented"`; signatures are neither fetched
nor verified. A later signature-verification design must introduce its own
explicit trust model and machine-readable schema change.

Local paths deliberately report a content snapshot marker rather than the
original local filesystem path, which is not persisted in the lockfile.
