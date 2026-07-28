use std::{fs, path::Path};
use tempfile::TempDir;
use wukong_core::identity::{
    LocalSourceIdentity, PackageIdentity, PackageIdentitySet, PackageName, SourceIdentity,
};

#[test]
fn invariant_package_names_are_canonical_lowercase_ascii() {
    let name = PackageName::parse("terrain3d-tools").expect("valid name should parse");

    assert_eq!(name.as_str(), "terrain3d-tools");
    for invalid in ["Terrain3d", "terrain_3d", "-terrain", "terrain-", "térrain"] {
        assert!(
            PackageName::parse(invalid).is_err(),
            "{invalid} should fail"
        );
    }
}

#[test]
fn invariant_equivalent_existing_local_references_canonicalise_identically() {
    let fixture = Fixture::new();
    let package = fixture.root().join("package");
    fs::create_dir(&package).expect("package directory should be created");

    let direct = LocalSourceIdentity::from_existing_path(&package)
        .expect("direct package path should canonicalize");
    let equivalent = LocalSourceIdentity::from_existing_path(&package.join("."))
        .expect("equivalent package path should canonicalize");

    assert_eq!(direct, equivalent);
    assert!(direct.path().is_absolute());
}

#[test]
fn invariant_conflicting_sources_for_one_package_fail_before_download() {
    let fixture = Fixture::new();
    let first_path = fixture.root().join("first");
    let second_path = fixture.root().join("second");
    fs::create_dir(&first_path).expect("first directory should be created");
    fs::create_dir(&second_path).expect("second directory should be created");
    let name = PackageName::parse("example").expect("valid name should parse");
    let first = identity(name.clone(), &first_path);
    let second = identity(name, &second_path);
    let mut identities = PackageIdentitySet::default();

    assert!(
        identities
            .insert(first.clone())
            .expect("first identity should insert")
    );
    assert!(
        !identities
            .insert(first)
            .expect("same identity should be a no-op")
    );
    let conflict = identities
        .insert(second)
        .expect_err("different source should conflict");

    assert_eq!(conflict.existing().name().as_str(), "example");
    assert_eq!(conflict.attempted().name().as_str(), "example");
    assert!(
        conflict
            .to_string()
            .contains("conflicting source identities")
    );
}

#[test]
fn invariant_identity_collections_are_in_deterministic_name_order() {
    let fixture = Fixture::new();
    let alpha_path = fixture.root().join("alpha");
    let zebra_path = fixture.root().join("zebra");
    fs::create_dir(&alpha_path).expect("alpha directory should be created");
    fs::create_dir(&zebra_path).expect("zebra directory should be created");
    let mut identities = PackageIdentitySet::default();

    identities
        .insert(identity(
            PackageName::parse("zebra").expect("name should parse"),
            &zebra_path,
        ))
        .expect("zebra identity should insert");
    identities
        .insert(identity(
            PackageName::parse("alpha").expect("name should parse"),
            &alpha_path,
        ))
        .expect("alpha identity should insert");
    let names = identities
        .identities()
        .map(|identity| identity.name().as_str())
        .collect::<Vec<_>>();

    assert_eq!(names, ["alpha", "zebra"]);
}

fn identity(name: PackageName, path: &Path) -> PackageIdentity {
    PackageIdentity::new(
        name,
        SourceIdentity::Local(
            LocalSourceIdentity::from_existing_path(path).expect("path should canonicalize"),
        ),
    )
}

struct Fixture {
    directory: TempDir,
}

impl Fixture {
    fn new() -> Self {
        Self {
            directory: TempDir::new().expect("temporary directory should be created"),
        }
    }

    fn root(&self) -> &Path {
        self.directory.path()
    }
}
