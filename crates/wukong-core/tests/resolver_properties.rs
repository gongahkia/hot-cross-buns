use proptest::prelude::*;
use std::{collections::BTreeMap, fs};
use tempfile::TempDir;
use wukong_core::{
    identity::{
        LocalSourceIdentity, PackageIdentity, PackageIdentitySet, PackageName, SourceIdentity,
    },
    resolver::{
        InMemoryPackageUniverse, PackageCandidate, ResolutionRequest, resolve_dependencies,
    },
    semantic_version::{SemanticVersion, VersionRequirement},
    source::CancellationToken,
};

proptest! {
    #![proptest_config(ProptestConfig::with_cases(64))]

    #[test]
    fn invariant_generated_solvable_chains_resolve_complete_graphs(length in 1usize..8, minor in 0u8..20) {
        let mut universe = InMemoryPackageUniverse::new();
        let version = version(&format!("1.{minor}.0"));
        let version_requirement = requirement(&format!("={version}"));
        for index in 0..length {
            let dependencies = if index + 1 == length {
                BTreeMap::new()
            } else {
                BTreeMap::from([(package(index + 1), version_requirement.clone())])
            };
            add(&mut universe, package(index), PackageCandidate::new(&version, dependencies));
        }
        let mut request = ResolutionRequest::new();
        request.require(package(0), version_requirement);

        let graph = resolve_dependencies(&universe, &request, &CancellationToken::new())
            .expect("generated chain should resolve");

        prop_assert_eq!(graph.packages().len(), length);
        for index in 0..length {
            prop_assert_eq!(graph.packages().get(&package(index)).unwrap().version(), &version);
        }
    }

    #[test]
    fn invariant_generated_unsatisfiable_graphs_report_both_requirements(left_minor in 0u8..20, right_minor in 0u8..20) {
        let mut universe = InMemoryPackageUniverse::new();
        let left_version = version(&format!("1.{left_minor}.0"));
        let right_version = version(&format!("1.{right_minor}.0"));
        add(
            &mut universe,
            name("left"),
            PackageCandidate::new(
                &left_version,
                BTreeMap::from([(name("shared"), requirement("=1.0.0"))]),
            ),
        );
        add(
            &mut universe,
            name("right"),
            PackageCandidate::new(
                &right_version,
                BTreeMap::from([(name("shared"), requirement("=2.0.0"))]),
            ),
        );
        add(&mut universe, name("shared"), PackageCandidate::new(&version("1.0.0"), BTreeMap::new()));
        add(&mut universe, name("shared"), PackageCandidate::new(&version("2.0.0"), BTreeMap::new()));
        let mut request = ResolutionRequest::new();
        request.require(name("left"), requirement(&format!("={left_version}")));
        request.require(name("right"), requirement(&format!("={right_version}")));

        let error = resolve_dependencies(&universe, &request, &CancellationToken::new())
            .expect_err("generated conflict should fail");

        prop_assert!(error.message().contains("left"));
        prop_assert!(error.message().contains("right"));
        prop_assert!(error.message().contains("shared"));
    }

    #[test]
    fn invariant_generated_cyclic_graphs_are_rejected(length in 1usize..8, minor in 0u8..20) {
        let mut universe = InMemoryPackageUniverse::new();
        let version = version(&format!("1.{minor}.0"));
        let version_requirement = requirement(&format!("={version}"));
        for index in 0..length {
            let next = (index + 1) % length;
            add(
                &mut universe,
                package(index),
                PackageCandidate::new(
                    &version,
                    BTreeMap::from([(package(next), version_requirement.clone())]),
                ),
            );
        }
        let mut request = ResolutionRequest::new();
        request.require(package(0), version_requirement);

        let error = resolve_dependencies(&universe, &request, &CancellationToken::new())
            .expect_err("generated cycle should fail");

        prop_assert!(error.message().starts_with("dependency cycle: pkg0"));
        prop_assert!(error.message().ends_with("pkg0"));
    }

    #[test]
    fn invariant_highest_candidate_wins_when_multiple_valid_solutions_exist(low_minor in 0u8..10, delta in 1u8..10) {
        let high_minor = low_minor + delta;
        let low = version(&format!("1.{low_minor}.0"));
        let high = version(&format!("1.{high_minor}.0"));
        let mut universe = InMemoryPackageUniverse::new();
        add(&mut universe, name("addon"), PackageCandidate::new(&low, BTreeMap::new()));
        add(&mut universe, name("addon"), PackageCandidate::new(&high, BTreeMap::new()));
        let mut request = ResolutionRequest::new();
        request.require(name("addon"), requirement("^1"));

        let graph = resolve_dependencies(&universe, &request, &CancellationToken::new())
            .expect("multiple solutions should resolve");

        prop_assert_eq!(graph.packages().get(&name("addon")).unwrap().version(), &high);
    }

    #[test]
    fn invariant_valid_locked_version_wins_over_a_newer_candidate(low_minor in 0u8..10, delta in 1u8..10) {
        let high_minor = low_minor + delta;
        let low = version(&format!("1.{low_minor}.0"));
        let high = version(&format!("1.{high_minor}.0"));
        let mut universe = InMemoryPackageUniverse::new();
        add(&mut universe, name("addon"), PackageCandidate::new(&low, BTreeMap::new()));
        add(&mut universe, name("addon"), PackageCandidate::new(&high, BTreeMap::new()));
        let mut request = ResolutionRequest::new();
        request.require(name("addon"), requirement("^1"));
        request.prefer_locked(name("addon"), &low);

        let graph = resolve_dependencies(&universe, &request, &CancellationToken::new())
            .expect("locked solution should resolve");

        prop_assert_eq!(graph.packages().get(&name("addon")).unwrap().version(), &low);
    }

    #[test]
    fn invariant_prereleases_need_an_explicit_matching_requirement(alpha in 1u8..20) {
        let prerelease = version(&format!("1.1.0-alpha.{alpha}"));
        let stable = version("1.0.0");
        let mut universe = InMemoryPackageUniverse::new();
        add(&mut universe, name("addon"), PackageCandidate::new(&prerelease, BTreeMap::new()));
        add(&mut universe, name("addon"), PackageCandidate::new(&stable, BTreeMap::new()));
        let mut stable_request = ResolutionRequest::new();
        stable_request.require(name("addon"), requirement("^1.0.0"));
        let mut prerelease_request = ResolutionRequest::new();
        prerelease_request.require(name("addon"), requirement(&format!("={prerelease}")));

        let stable_graph = resolve_dependencies(&universe, &stable_request, &CancellationToken::new())
            .expect("stable requirement should resolve");
        let prerelease_graph = resolve_dependencies(&universe, &prerelease_request, &CancellationToken::new())
            .expect("explicit prerelease should resolve");

        prop_assert_eq!(stable_graph.packages().get(&name("addon")).unwrap().version(), &stable);
        prop_assert_eq!(prerelease_graph.packages().get(&name("addon")).unwrap().version(), &prerelease);
    }

    #[test]
    fn invariant_duplicate_source_identities_are_rejected_before_resolution(
        package_name in "[a-z][a-z0-9]{0,12}",
    ) {
        let fixture = TempDir::new().expect("fixture directory should exist");
        let first = fixture.path().join("first");
        let second = fixture.path().join("second");
        fs::create_dir(&first).expect("first source directory should exist");
        fs::create_dir(&second).expect("second source directory should exist");
        let name = name(&package_name);
        let first = PackageIdentity::new(
            name.clone(),
            SourceIdentity::Local(LocalSourceIdentity::from_existing_path(&first).expect("first source should canonicalize")),
        );
        let second = PackageIdentity::new(
            name.clone(),
            SourceIdentity::Local(LocalSourceIdentity::from_existing_path(&second).expect("second source should canonicalize")),
        );
        let mut identities = PackageIdentitySet::default();

        prop_assert!(identities.insert(first).expect("first identity should insert"));
        let conflict = identities.insert(second).expect_err("second identity should conflict");

        prop_assert_eq!(conflict.existing().name(), &name);
        prop_assert_eq!(conflict.attempted().name(), &name);
    }
}

fn add(universe: &mut InMemoryPackageUniverse, package: PackageName, candidate: PackageCandidate) {
    universe
        .add_candidate(package, candidate)
        .expect("candidate should be unique");
}

fn package(index: usize) -> PackageName {
    name(&format!("pkg{index}"))
}

fn name(value: &str) -> PackageName {
    PackageName::parse(value).expect("package name should be valid")
}

fn requirement(value: &str) -> VersionRequirement {
    VersionRequirement::parse(value).expect("version requirement should be valid")
}

fn version(value: &str) -> SemanticVersion {
    SemanticVersion::parse(value).expect("version should be valid")
}
