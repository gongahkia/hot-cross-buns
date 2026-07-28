# Compatibility expansion status

This record separates local capability coverage from verified public-addon
evidence. The current public fixture corpus has 24 entries; it does not yet
meet the 50- or 100-addon targets.

| Target | Evidence | Status |
| --- | --- | --- |
| Multi-addon repositories | Four pinned GDQuest addons from one source passed source verification with distinct explicit layouts. | public corpus coverage |
| Native extensions | Local transactional test materialises a `.gdextension` descriptor and binary bytes without execution. | materialisation covered; runtime compatibility unverified |
| Private Git sources | Credentials stay outside manifests and are delegated to the installed Git client. | requires a consented private test source |
| Large projects | The benchmark suite contains a deterministic large graph. | benchmark coverage only; no public compatibility case |
| Windows-specific cases | Windows-target lint passes locally. | native filesystem and Godot validation require Windows |

Add public fixtures only after recording licence/access review, immutable
revision, expected paths, tree hash, and opt-in source verification under the
[fixture guide](fixture-guide.md). Never add private source details or
credentials to the corpus.
