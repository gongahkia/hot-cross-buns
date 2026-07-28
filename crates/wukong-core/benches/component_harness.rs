#![allow(dead_code)] // imported by benchmark fixture tests

use std::{
    collections::{BTreeMap, BTreeSet},
    env, fs,
    hint::black_box,
    io::Write,
    path::{Path, PathBuf},
    time::Instant,
};
use tempfile::TempDir;
use wukong_core::{
    archive::{ExtractionLimits, extract_zip},
    cache::{CacheLayout, publish_prepared_package, verify_package_object},
    git_fetch::GitFetcher,
    git_source::GitSourceRequest,
    identity::PackageName,
    installed_state::{DependencyGroup, InstalledPackage},
    local_source::{LocalPathAdapter, LocalPathRequest},
    lockfile::{GodotCompatibility, LockedLocalSource, LockedPackage, Lockfile},
    manifest::{GitReference, Manifest},
    materialization::{MaterializationPreference, materialize_file},
    ownership::{PackageMaterialization, build_desired_file_map},
    package_tree::{PreparedPackageTree, prepare_package_tree},
    project_sync::sync_project,
    resolver::{
        InMemoryPackageUniverse, PackageCandidate, ResolutionRequest, resolve_dependencies,
    },
    semantic_version::{SemanticVersion, VersionRequirement},
    source::{CancellationToken, ImmutableSourceId, SourceAdapter},
};
use zip::{CompressionMethod, ZipWriter, write::SimpleFileOptions};

const ITERATIONS: usize = 20;
const NETWORK_COLD_ITERATIONS: usize = 3;
const NETWORK_WARM_ITERATIONS: usize = 20;

fn main() {
    let fixture = LocalFixture::new();
    benchmark_manifest_parsing();
    benchmark_lockfile_parsing();
    benchmark_resolution();
    benchmark_extraction(&fixture);
    benchmark_hashing(&fixture);
    benchmark_cache_lookup(&fixture);
    benchmark_materialization(&fixture);
    benchmark_noop_sync(&fixture);
    benchmark_git_fetch_from_environment();
    benchmark_http_fetch_from_environment();
}

fn benchmark_manifest_parsing() {
    let input = "[project]\nname = \"benchmark\"\ngodot = \"4\"\n\n[dependencies]\naddon = { path = \"addons/addon\" }\n";
    benchmark("manifest-parse", "minimal-manifest", ITERATIONS, || {
        black_box(
            Manifest::parse(Path::new("fixture/wukong.toml"), input)
                .expect("benchmark manifest should parse"),
        );
    });
}

fn benchmark_lockfile_parsing() {
    let input = lock_fixture().to_toml();
    benchmark("lockfile-parse", "single-local-package", ITERATIONS, || {
        black_box(
            Lockfile::parse(Path::new("fixture/wukong.lock"), &input)
                .expect("benchmark lockfile should parse"),
        );
    });
}

fn benchmark_resolution() {
    let (universe, request) = resolution_fixture(64);
    let cancellation = CancellationToken::new();
    benchmark("resolution", "chain-64", ITERATIONS, || {
        black_box(
            resolve_dependencies(&universe, &request, &cancellation)
                .expect("benchmark graph should resolve"),
        );
    });
}

fn benchmark_extraction(fixture: &LocalFixture) {
    benchmark("extraction", "zip-64-kib", ITERATIONS, || {
        let extracted = extract_zip(
            &fixture.archive,
            &fixture.extract_parent,
            ExtractionLimits::default(),
        )
        .expect("benchmark ZIP should extract");
        fs::remove_dir_all(extracted.root()).expect("benchmark extraction root should remove");
    });
}

fn benchmark_hashing(fixture: &LocalFixture) {
    let request =
        LocalPathRequest::new(fixture.project.join("wukong.toml"), PathBuf::from("source"));
    let cancellation = CancellationToken::new();
    benchmark("hashing", "local-tree-64-kib", ITERATIONS, || {
        black_box(
            LocalPathAdapter
                .resolve(&request, &cancellation)
                .expect("benchmark tree should hash"),
        );
    });
}

fn benchmark_cache_lookup(fixture: &LocalFixture) {
    let cache = CacheLayout::for_root(fixture.root().join("cache"))
        .expect("benchmark cache should configure");
    let object = publish_prepared_package(&cache, &fixture.prepared)
        .expect("benchmark cache object should publish");
    benchmark("cache-lookup", "prepared-tree-warm", ITERATIONS, || {
        black_box(
            verify_package_object(&cache, object.sha256())
                .expect("benchmark cache object should verify"),
        );
    });
}

fn benchmark_materialization(fixture: &LocalFixture) {
    let destination_root = fixture.root().join("materialized");
    fs::create_dir(&destination_root).expect("benchmark destination should create");
    let source = fixture.source.join("plugin.gd");
    benchmark("materialization", "copy-64-kib", ITERATIONS, || {
        let destination = destination_root.join("plugin.gd");
        black_box(
            materialize_file(&source, &destination, MaterializationPreference::Copy)
                .expect("benchmark file should materialize"),
        );
        fs::remove_file(destination).expect("benchmark destination should remove");
    });
}

fn benchmark_noop_sync(fixture: &LocalFixture) {
    let project = fixture.root().join("sync-project");
    fs::create_dir(&project).expect("benchmark sync project should create");
    let package = InstalledPackage::new(
        PackageName::parse("benchmark-addon").expect("benchmark package name should parse"),
        ImmutableSourceId::new(format!("sha256:{}", fixture.prepared.sha256()))
            .expect("benchmark immutable identity should parse"),
        fixture.prepared.sha256().to_owned(),
    )
    .expect("benchmark installed package should create");
    let package_name =
        PackageName::parse("benchmark-addon").expect("benchmark package name should parse");
    let desired = build_desired_file_map([PackageMaterialization::new(
        &package_name,
        &fixture.prepared,
        Path::new("addons/benchmark-addon"),
    )])
    .expect("benchmark desired files should build");
    let groups = BTreeSet::from([DependencyGroup::Dependencies]);
    sync_project(&project, groups.clone(), [package.clone()], &desired)
        .expect("benchmark initial sync should complete");
    benchmark("noop-sync", "single-package-warm", ITERATIONS, || {
        black_box(
            sync_project(&project, groups.clone(), [package.clone()], &desired)
                .expect("benchmark no-op sync should complete"),
        );
    });
}

fn benchmark_git_fetch_from_environment() {
    let Some((url, revision)) = environment_pair("WUKONG_BENCH_GIT_URL", "WUKONG_BENCH_GIT_REV")
    else {
        return;
    };
    let request = GitSourceRequest::new(url, Some(GitReference::Rev(revision)));
    benchmark(
        "git-fetch-cold",
        "configured-immutable-source",
        NETWORK_COLD_ITERATIONS,
        || {
            let cache = TempDir::new().expect("benchmark cache should create");
            let fetcher = GitFetcher::new(
                CacheLayout::for_root(cache.path().join("cache")).expect("cache should configure"),
            );
            black_box(
                fetcher
                    .fetch(&request, false)
                    .expect("configured Git source should fetch"),
            );
        },
    );
    let cache = TempDir::new().expect("benchmark cache should create");
    let fetcher = GitFetcher::new(
        CacheLayout::for_root(cache.path().join("cache")).expect("cache should configure"),
    );
    fetcher
        .fetch(&request, false)
        .expect("configured Git source should warm the cache");
    benchmark(
        "git-fetch-warm",
        "configured-immutable-source",
        NETWORK_WARM_ITERATIONS,
        || {
            black_box(
                fetcher
                    .fetch(&request, true)
                    .expect("configured Git cache should fetch offline"),
            );
        },
    );
}

fn benchmark_http_fetch_from_environment() {
    let Some((url, sha256)) = environment_pair("WUKONG_BENCH_HTTP_URL", "WUKONG_BENCH_HTTP_SHA256")
    else {
        return;
    };
    benchmark(
        "http-fetch-cold",
        "configured-immutable-source",
        NETWORK_COLD_ITERATIONS,
        || {
            let cache = TempDir::new().expect("benchmark cache should create");
            let fetcher = wukong_core::http_archive::HttpArchiveFetcher::new(
                CacheLayout::for_root(cache.path().join("cache")).expect("cache should configure"),
            );
            black_box(
                fetcher
                    .fetch(&url, &sha256, false)
                    .expect("configured HTTPS archive should fetch"),
            );
        },
    );
    let cache = TempDir::new().expect("benchmark cache should create");
    let fetcher = wukong_core::http_archive::HttpArchiveFetcher::new(
        CacheLayout::for_root(cache.path().join("cache")).expect("cache should configure"),
    );
    fetcher
        .fetch(&url, &sha256, false)
        .expect("configured HTTPS archive should warm the cache");
    benchmark(
        "http-fetch-warm",
        "configured-immutable-source",
        NETWORK_WARM_ITERATIONS,
        || {
            black_box(
                fetcher
                    .fetch(&url, &sha256, true)
                    .expect("configured HTTPS archive should fetch offline"),
            );
        },
    );
}

fn environment_pair(first: &str, second: &str) -> Option<(String, String)> {
    match (env::var(first), env::var(second)) {
        (Ok(first), Ok(second)) => Some((first, second)),
        (Err(_), Err(_)) => {
            println!("benchmark={first} status=skipped reason=not-configured");
            None
        }
        _ => {
            println!("benchmark={first} status=skipped reason=incomplete-configuration");
            None
        }
    }
}

fn benchmark(name: &str, fixture: &str, iterations: usize, mut action: impl FnMut()) {
    let started = Instant::now();
    for _ in 0..iterations {
        action();
    }
    println!(
        "benchmark={name} fixture={fixture} iterations={iterations} elapsed_ns={}",
        started.elapsed().as_nanos()
    );
}

pub(crate) fn lock_fixture() -> Lockfile {
    let checksum = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
    let source = LockedLocalSource::new(
        ImmutableSourceId::new(format!("sha256:{checksum}"))
            .expect("benchmark immutable identity should parse"),
        checksum.to_owned(),
    )
    .expect("benchmark source should create");
    Lockfile::new([LockedPackage::new(
        PackageName::parse("benchmark-addon").expect("benchmark package name should parse"),
        None,
        source,
        checksum.to_owned(),
        checksum.to_owned(),
        BTreeSet::new(),
        ".".into(),
        "addons/benchmark-addon".into(),
        GodotCompatibility::Unknown,
        false,
    )
    .expect("benchmark lock package should create")])
    .expect("benchmark lockfile should create")
}

fn resolution_fixture(package_count: usize) -> (InMemoryPackageUniverse, ResolutionRequest) {
    let version = SemanticVersion::parse("1.0.0").expect("benchmark version should parse");
    let requirement =
        VersionRequirement::parse("^1.0.0").expect("benchmark requirement should parse");
    let mut universe = InMemoryPackageUniverse::new();
    for index in 0..package_count {
        let name_text = format!("package-{index}");
        let name = PackageName::parse(&name_text).expect("benchmark package name should parse");
        let mut dependencies = BTreeMap::new();
        if index > 0 {
            dependencies.insert(
                PackageName::parse(&format!("package-{}", index - 1))
                    .expect("benchmark dependency name should parse"),
                requirement.clone(),
            );
        }
        universe
            .add_candidate(name, PackageCandidate::new(&version, dependencies))
            .expect("benchmark candidate should add");
    }
    let mut request = ResolutionRequest::new();
    request.require(
        PackageName::parse(&format!("package-{}", package_count - 1))
            .expect("benchmark root name should parse"),
        requirement,
    );
    (universe, request)
}

struct LocalFixture {
    directory: TempDir,
    project: PathBuf,
    source: PathBuf,
    prepared: PreparedPackageTree,
    archive: PathBuf,
    extract_parent: PathBuf,
}

impl LocalFixture {
    fn new() -> Self {
        let directory = TempDir::new().expect("benchmark fixture should create");
        let project = directory.path().join("project");
        let source = project.join("source");
        fs::create_dir_all(&source).expect("benchmark source should create");
        fs::write(
            project.join("wukong.toml"),
            "[project]\nname=\"benchmark\"\ngodot=\"4\"\n",
        )
        .expect("benchmark manifest should write");
        fs::write(source.join("plugin.gd"), vec![b'x'; 64 * 1024])
            .expect("benchmark source should write");
        let prepared = prepare_package_tree(&source, &directory.path().join("prepared"))
            .expect("benchmark package should prepare");
        let archive = directory.path().join("fixture.zip");
        write_zip(&archive);
        let extract_parent = directory.path().join("extracted");
        fs::create_dir(&extract_parent).expect("benchmark extraction parent should create");
        Self {
            directory,
            project,
            source,
            prepared,
            archive,
            extract_parent,
        }
    }

    fn root(&self) -> &Path {
        self.directory.path()
    }
}

fn write_zip(path: &Path) {
    let file = fs::File::create(path).expect("benchmark ZIP should create");
    let mut writer = ZipWriter::new(file);
    writer
        .start_file(
            "addons/benchmark-addon/plugin.gd",
            SimpleFileOptions::default().compression_method(CompressionMethod::Stored),
        )
        .expect("benchmark ZIP entry should start");
    writer
        .write_all(&vec![b'x'; 64 * 1024])
        .expect("benchmark ZIP entry should write");
    writer.finish().expect("benchmark ZIP should finish");
}
