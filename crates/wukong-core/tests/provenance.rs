use std::collections::BTreeSet;
use wukong_core::{
    identity::PackageName,
    lockfile::{
        GodotCompatibility, LockedGitSource, LockedHttpSource, LockedLocalSource, LockedPackage,
        Lockfile,
    },
    provenance::{ProvenanceReport, ProvenanceSourceKind},
    source::ImmutableSourceId,
};

#[test]
fn invariant_provenance_reports_canonical_immutable_sources_in_name_order() {
    let local_checksum = "11c61f3a6ace3a2b9d1729f6d52af90e6c9b6671e1db798cd91dec1ad666e91b";
    let commit = "4ab90a80b815bc1ad4a8d7eea92c785e654bfd91";
    let archive_checksum = "77c61f3a6ace3a2b9d1729f6d52af90e6c9b6671e1db798cd91dec1ad666e91b";
    let lock = Lockfile::new([
        package(
            "local-addon",
            LockedLocalSource::new(
                ImmutableSourceId::new(format!("sha256:{local_checksum}"))
                    .expect("local identity should parse"),
                local_checksum.to_owned(),
            )
            .expect("local source should lock")
            .into(),
            1,
        ),
        package(
            "git-addon",
            LockedGitSource::new(
                ImmutableSourceId::new(format!("git:{commit}")).expect("Git identity should parse"),
                "HTTPS://EXAMPLE.test:443/Org/addon.git",
                commit.to_owned(),
            )
            .expect("Git source should lock")
            .into(),
            2,
        ),
        package(
            "archive-addon",
            LockedHttpSource::new(
                ImmutableSourceId::new(format!("sha256:{archive_checksum}"))
                    .expect("archive identity should parse"),
                "https://example.test/addon.zip",
                archive_checksum.to_owned(),
            )
            .expect("archive source should lock")
            .into(),
            3,
        ),
    ])
    .expect("lock should create");

    let report = ProvenanceReport::from_lockfile(&lock);
    let packages = report.packages();

    assert_eq!(
        packages
            .iter()
            .map(|package| package.name().as_str())
            .collect::<Vec<_>>(),
        ["archive-addon", "git-addon", "local-addon"]
    );
    assert_eq!(packages[0].source_kind(), ProvenanceSourceKind::Http);
    assert_eq!(
        packages[0].canonical_source(),
        "https://example.test/addon.zip"
    );
    assert_eq!(packages[0].source_sha256(), Some(archive_checksum));
    assert_eq!(packages[1].source_kind(), ProvenanceSourceKind::Git);
    assert_eq!(
        packages[1].canonical_source(),
        "https://example.test/Org/addon.git"
    );
    assert_eq!(packages[1].immutable_revision(), Some(commit));
    assert_eq!(packages[1].source_sha256(), None);
    assert_eq!(packages[2].source_kind(), ProvenanceSourceKind::Local);
    assert_eq!(
        packages[2].canonical_source(),
        format!("local:sha256:{local_checksum}")
    );
    assert_eq!(packages[2].source_sha256(), Some(local_checksum));
    assert!(
        packages
            .iter()
            .all(|package| package.package_sha256().len() == 64)
    );
}

fn package(name: &str, source: wukong_core::lockfile::LockedSource, index: usize) -> LockedPackage {
    LockedPackage::new(
        PackageName::parse(name).expect("package name should parse"),
        None,
        source,
        format!("{index:064x}"),
        format!("{:064x}", index + 10),
        BTreeSet::new(),
        ".".into(),
        format!("addons/{name}").into(),
        GodotCompatibility::Unknown,
        false,
    )
    .expect("package should lock")
}
