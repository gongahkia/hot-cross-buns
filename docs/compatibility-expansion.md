# Compatibility expansion status

This record separates local capability coverage from verified public-addon
evidence. The current public fixture corpus has 100 entries; it meets both
public-addon count targets.

| Target | Evidence | Status |
| --- | --- | --- |
| Multi-addon repositories | Four pinned GDQuest addons from one source passed source verification with distinct explicit layouts. | public corpus coverage |
| Fifty public addons | Fifty pinned MIT-licensed addon layouts passed source verification. | target met |
| One hundred public addons | One hundred pinned MIT-licensed addon layouts passed source verification. | target met |
| Native extensions | Pinned QuarkPhysics source passed fixture verification for a `.gdextension` descriptor layout. | package layout/materialisation covered; runtime and binary compatibility unverified |
| Private Git sources | Credentials stay outside manifests and are delegated to the installed Git client. | requires a consented private test source |
| Large projects | The benchmark suite contains a deterministic large graph. | benchmark coverage only; no public compatibility case |
| Windows-specific cases | Windows-target lint passes locally. | native filesystem and Godot validation require Windows |

Add public fixtures only after recording licence/access review, immutable
revision, expected paths, tree hash, and opt-in source verification under the
[fixture guide](fixture-guide.md). Never add private source details or
credentials to the corpus.
