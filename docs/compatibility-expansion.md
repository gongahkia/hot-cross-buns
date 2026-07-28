# Compatibility expansion status

This record separates local capability coverage from verified public-addon
evidence. The current public fixture corpus has 20 entries; it does not yet
meet the 50- or 100-addon targets.

| Target | Evidence | Status |
| --- | --- | --- |
| Multi-addon repositories | Local transactional lock/sync test selects two directories from one source. | capability covered; no public corpus fixture yet |
| Native extensions | Local transactional test materialises a `.gdextension` descriptor and binary bytes without execution. | materialisation covered; runtime compatibility unverified |
| Private Git sources | Credentials stay outside manifests and are delegated to the installed Git client. | requires a consented private test source |
| Large projects | The benchmark suite contains a deterministic large graph. | benchmark coverage only; no public compatibility case |
| Windows-specific cases | Windows-target lint passes locally. | native filesystem and Godot validation require Windows |

Add public fixtures only after recording licence/access review, immutable
revision, expected paths, tree hash, and opt-in source verification under the
[fixture guide](fixture-guide.md). Never add private source details or
credentials to the corpus.
