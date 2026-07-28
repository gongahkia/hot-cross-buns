const RESEARCH: &str = include_str!("../../../docs/asset-library-research.md");
const ADR: &str = include_str!("../../../docs/adr/0034-official-asset-library-boundary.md");

#[test]
fn invariant_asset_library_research_requires_a_verified_generic_artifact_lock() {
    for required in [
        "GET /asset/{id}",
        "download_hash` empty",
        "SHA-256 while staging",
        "must not host, mirror, publish, or redistribute",
        "opt-in feature",
    ] {
        assert!(
            RESEARCH.contains(required),
            "research must cover {required}"
        );
    }
    assert!(ADR.contains("generic checksum-addressed HTTP artifact"));
    assert!(ADR.contains("offline installation use the locked generic artifact"));
}
