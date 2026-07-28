use std::{env, fs};
use tempfile::TempDir;
use wukong_core::{
    cache::CacheLayout, direct_lock::lock_direct_dependencies,
    direct_sync::sync_direct_dependencies, lockfile::LockedSource, manifest::Manifest,
};

#[test]
#[ignore = "requires an explicitly supplied consented private Git source"]
fn invariant_private_git_source_locks_to_an_immutable_commit_and_syncs_offline() {
    let url = env::var("WUKONG_PRIVATE_GIT_URL")
        .expect("set WUKONG_PRIVATE_GIT_URL without embedded credentials");
    let revision = env::var("WUKONG_PRIVATE_GIT_REV")
        .expect("set WUKONG_PRIVATE_GIT_REV to a complete immutable commit");
    let directory = TempDir::new().expect("private Git fixture directory should exist");
    let manifest_path = directory.path().join("wukong.toml");
    let manifest_input = format!(
        "[project]\nname = \"fixture\"\ngodot = \"4\"\n\n[dependencies]\nprivate-source = {{ git = \"{url}\", rev = \"{revision}\", root = \"fixtures/compatibility/v1\", target = \"addons/private-git-fixtures\" }}\n"
    );
    fs::write(&manifest_path, &manifest_input).expect("fixture manifest should write");
    let manifest =
        Manifest::parse(&manifest_path, &manifest_input).expect("fixture manifest should parse");
    let cache = CacheLayout::for_root(directory.path().join("cache")).expect("cache should create");

    let locked = lock_direct_dependencies(&manifest_path, &manifest, None, &cache, false)
        .expect("private Git source should lock through the installed Git client");
    let source = locked
        .packages()
        .get("private-source")
        .expect("private source should lock")
        .source();
    let LockedSource::Git(source) = source else {
        panic!("private source should lock as Git");
    };
    assert_eq!(source.commit(), revision);
    assert_eq!(source.url(), url);

    let summary = sync_direct_dependencies(
        directory.path(),
        &manifest_path,
        &manifest,
        &locked,
        false,
        &cache,
        true,
    )
    .expect("private Git source should synchronise from the verified cache offline");
    assert!(summary.written > 0);
    let reused = lock_direct_dependencies(&manifest_path, &manifest, Some(&locked), &cache, true)
        .expect("private Git lock should reuse offline without source access");
    assert_eq!(reused, locked);
}
