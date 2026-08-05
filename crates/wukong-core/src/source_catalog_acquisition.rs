//! Lazy, package-scoped acquisition of validated source-catalog candidates.

use crate::{
    cache::{CacheLayout, CacheObject, publish_prepared_package, verify_package_object},
    diagnostic::{Diagnostic, ErrorCode},
    git_fetch::GitFetcher,
    git_source::GitSourceRequest,
    identity::{GitSourceIdentity, PackageName},
    manifest::GitReference,
    package_metadata::PackageMetadata,
    package_tree::prepare_package_tree,
    semantic_version::SemanticVersion,
    source::{CancellationToken, SourceResult},
    source_catalog::{ValidatedCatalogCandidate, ValidatedSourceCatalog},
    source_catalog_git::{CatalogGitAdapter, CatalogGitVersionCandidate},
    source_catalog_http::CatalogHttpAdapter,
};
use std::{
    collections::BTreeMap,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};
use tempfile::TempDir;

/// An immutable source whose package content has been admitted to the cache.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum AcquiredCatalogSource {
    /// A Git source observed at a complete commit.
    Git {
        /// Canonical repository URL.
        source: GitSourceIdentity,
        /// Complete immutable commit ID.
        commit: String,
        /// Source-relative package root.
        root: PathBuf,
    },
    /// A checksum-pinned HTTPS archive source.
    Http {
        /// Canonical credential-free archive URL.
        url: String,
        /// Lowercase SHA-256 checksum.
        sha256: String,
        /// Source-relative package root.
        root: PathBuf,
    },
}

/// One catalog candidate with verified metadata and a verified package cache object.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AcquiredCatalogCandidate {
    version: SemanticVersion,
    metadata: PackageMetadata,
    source: AcquiredCatalogSource,
    cache_object: CacheObject,
}

impl AcquiredCatalogCandidate {
    /// Returns the candidate's canonical semantic version.
    #[must_use]
    pub const fn version(&self) -> &SemanticVersion {
        &self.version
    }

    /// Returns the required package metadata that admitted this candidate.
    #[must_use]
    pub const fn metadata(&self) -> &PackageMetadata {
        &self.metadata
    }

    /// Returns the immutable source used to acquire this candidate.
    #[must_use]
    pub const fn source(&self) -> &AcquiredCatalogSource {
        &self.source
    }

    /// Returns the verified content-addressed prepared package object.
    #[must_use]
    pub const fn cache_object(&self) -> &CacheObject {
        &self.cache_object
    }
}

/// Lazily acquires source-catalog candidates only for requested package names.
#[derive(Clone, Debug)]
pub struct CatalogCandidateAcquirer {
    catalog: ValidatedSourceCatalog,
    cache: CacheLayout,
    git: GitFetcher,
    http: CatalogHttpAdapter,
    offline: bool,
    package_locks: Arc<Mutex<BTreeMap<PackageName, Arc<Mutex<()>>>>>,
    acquired: Arc<Mutex<BTreeMap<PackageName, Vec<AcquiredCatalogCandidate>>>>,
}

impl CatalogCandidateAcquirer {
    /// Creates a lazy acquirer for one validated catalog and cache layout.
    #[must_use]
    pub fn new(catalog: ValidatedSourceCatalog, cache: CacheLayout, offline: bool) -> Self {
        let git = GitFetcher::new(cache.clone());
        Self {
            catalog,
            cache: cache.clone(),
            git,
            http: CatalogHttpAdapter::new(crate::http_archive::HttpArchiveFetcher::new(cache)),
            offline,
            package_locks: Arc::default(),
            acquired: Arc::default(),
        }
    }

    /// Acquires every reviewed candidate for `package` in deterministic order.
    ///
    /// Unknown package names return an empty set without source access. Clones
    /// share per-package acquisition state; every returned cached package object
    /// is re-verified before use.
    ///
    /// # Errors
    ///
    /// Returns a diagnostic when cancellation is requested, a requested source
    /// cannot be acquired safely, or a prepared cache object is corrupt.
    pub fn acquire(
        &self,
        package: &PackageName,
        cancellation: &CancellationToken,
    ) -> SourceResult<Vec<AcquiredCatalogCandidate>> {
        cancellation.check()?;
        let package_lock = self.package_lock(package)?;
        let _package_lock = package_lock
            .lock()
            .map_err(|_| internal("catalog package acquisition lock was poisoned"))?;
        cancellation.check()?;
        if let Some(candidates) = self.acquired_candidates(package)? {
            self.verify_candidates(&candidates)?;
            return Ok(candidates);
        }
        let candidates = self.acquire_uncached(package, cancellation)?;
        self.verify_candidates(&candidates)?;
        self.acquired
            .lock()
            .map_err(|_| internal("catalog acquisition cache lock was poisoned"))?
            .insert(package.clone(), candidates.clone());
        Ok(candidates)
    }

    fn package_lock(&self, package: &PackageName) -> SourceResult<Arc<Mutex<()>>> {
        let mut package_locks = self
            .package_locks
            .lock()
            .map_err(|_| internal("catalog package lock registry was poisoned"))?;
        Ok(package_locks
            .entry(package.clone())
            .or_insert_with(|| Arc::new(Mutex::new(())))
            .clone())
    }

    fn acquired_candidates(
        &self,
        package: &PackageName,
    ) -> SourceResult<Option<Vec<AcquiredCatalogCandidate>>> {
        Ok(self
            .acquired
            .lock()
            .map_err(|_| internal("catalog acquisition cache lock was poisoned"))?
            .get(package)
            .cloned())
    }

    fn acquire_uncached(
        &self,
        package: &PackageName,
        cancellation: &CancellationToken,
    ) -> SourceResult<Vec<AcquiredCatalogCandidate>> {
        let Some(declarations) = self.catalog.packages().get(package) else {
            return Ok(Vec::new());
        };
        let mut candidates = Vec::new();
        for declaration in declarations {
            cancellation.check()?;
            match declaration {
                ValidatedCatalogCandidate::Git(declaration) => {
                    let discovered = CatalogGitAdapter::new(self.git.clone())
                        .discover_candidates(declaration, self.offline)?;
                    for candidate in discovered.into_values() {
                        cancellation.check()?;
                        candidates.push(self.acquire_git(package, &candidate, cancellation)?);
                    }
                }
                ValidatedCatalogCandidate::Http(declaration) => {
                    candidates.push(self.acquire_http(package, declaration, cancellation)?);
                }
            }
        }
        unique_candidates(package, candidates)
    }

    fn acquire_git(
        &self,
        package: &PackageName,
        candidate: &CatalogGitVersionCandidate,
        cancellation: &CancellationToken,
    ) -> SourceResult<AcquiredCatalogCandidate> {
        cancellation.check()?;
        let checkout = self.git.fetch(
            &GitSourceRequest::new(
                candidate.source().as_str().to_owned(),
                Some(GitReference::Rev(candidate.commit().to_owned())),
            ),
            self.offline,
        )?;
        cancellation.check()?;
        let metadata = candidate.verify_package_metadata(package, checkout.root())?;
        let cache_object =
            self.prepare_cache_object(&checkout.root().join(candidate.root()), cancellation)?;
        Ok(AcquiredCatalogCandidate {
            version: candidate.version().clone(),
            metadata,
            source: AcquiredCatalogSource::Git {
                source: candidate.source().clone(),
                commit: candidate.commit().to_owned(),
                root: candidate.root().to_owned(),
            },
            cache_object,
        })
    }

    fn acquire_http(
        &self,
        package: &PackageName,
        candidate: &crate::source_catalog::ValidatedCatalogHttpCandidate,
        cancellation: &CancellationToken,
    ) -> SourceResult<AcquiredCatalogCandidate> {
        cancellation.check()?;
        let staging = TempDir::new().map_err(|error| {
            internal_with_cause("could not create catalog archive staging", error)
        })?;
        let extracted = self
            .http
            .fetch_and_extract(candidate, staging.path(), self.offline)?;
        cancellation.check()?;
        let metadata = CatalogHttpAdapter::verify_extracted_package_metadata(
            package,
            candidate,
            extracted.root(),
        )?;
        let cache_object =
            self.prepare_cache_object(&extracted.root().join(candidate.root()), cancellation)?;
        Ok(AcquiredCatalogCandidate {
            version: candidate.version().without_build_metadata(),
            metadata,
            source: AcquiredCatalogSource::Http {
                url: candidate.url().to_owned(),
                sha256: candidate.sha256().to_owned(),
                root: candidate.root().to_owned(),
            },
            cache_object,
        })
    }

    fn prepare_cache_object(
        &self,
        source_root: &Path,
        cancellation: &CancellationToken,
    ) -> SourceResult<CacheObject> {
        cancellation.check()?;
        let staging = TempDir::new().map_err(|error| {
            internal_with_cause("could not create catalog package staging", error)
        })?;
        let prepared = prepare_package_tree(source_root, &staging.path().join("prepared"))?;
        cancellation.check()?;
        publish_prepared_package(&self.cache, &prepared)
    }

    fn verify_candidates(&self, candidates: &[AcquiredCatalogCandidate]) -> SourceResult<()> {
        for candidate in candidates {
            verify_package_object(&self.cache, candidate.cache_object().sha256())?;
        }
        Ok(())
    }
}

fn source_key(source: &AcquiredCatalogSource) -> String {
    match source {
        AcquiredCatalogSource::Git {
            source,
            commit,
            root,
        } => {
            format!("git:{}:{commit}:{}", source.as_str(), root.display())
        }
        AcquiredCatalogSource::Http { url, sha256, root } => {
            format!("http:{url}:{sha256}:{}", root.display())
        }
    }
}

/// Deduplicates exact immutable candidates and rejects ambiguous versions.
///
/// # Errors
///
/// Returns an integrity diagnostic when one package version has distinct
/// canonical source identities.
pub fn unique_candidates(
    package: &PackageName,
    candidates: Vec<AcquiredCatalogCandidate>,
) -> SourceResult<Vec<AcquiredCatalogCandidate>> {
    let mut versions =
        BTreeMap::<SemanticVersion, BTreeMap<String, AcquiredCatalogCandidate>>::new();
    for candidate in candidates {
        versions
            .entry(candidate.version().clone())
            .or_default()
            .entry(source_key(candidate.source()))
            .or_insert(candidate);
    }
    let mut unique = Vec::new();
    for (version, sources) in versions {
        if sources.len() > 1 {
            return Err(Box::new(
                Diagnostic::new(
                    ErrorCode::IntegrityFailure,
                    format!(
                        "package {} version {version} has ambiguous catalog sources: {}",
                        package.as_str(),
                        sources.keys().cloned().collect::<Vec<_>>().join(", ")
                    ),
                )
                .with_package(package.as_str())
                .with_recovery("retain one reviewed immutable source for this package version"),
            ));
        }
        unique.extend(sources.into_values());
    }
    Ok(unique)
}

fn internal(message: &str) -> Box<Diagnostic> {
    Box::new(
        Diagnostic::new(ErrorCode::InternalFailure, message)
            .with_recovery("restart the operation and report the failure if it persists"),
    )
}

fn internal_with_cause(message: &str, cause: impl std::fmt::Display) -> Box<Diagnostic> {
    Box::new(
        Diagnostic::new(ErrorCode::InternalFailure, message)
            .with_cause(cause)
            .with_recovery("check temporary-directory permissions and retry"),
    )
}

#[cfg(test)]
mod tests {
    use super::{AcquiredCatalogSource, CatalogCandidateAcquirer, unique_candidates};
    use crate::{
        cache::CacheLayout, diagnostic::ErrorCode, identity::PackageName,
        source::CancellationToken, source_catalog::SourceCatalog,
    };
    use sha2::{Digest, Sha256};
    use std::{fs, io::Write, net::TcpListener, path::Path, thread};
    use tempfile::TempDir;
    use zip::{CompressionMethod, ZipWriter, write::SimpleFileOptions};

    #[test]
    fn invariant_catalog_acquisition_never_accesses_unselected_package_sources() {
        let fixture = Fixture::new();
        let candidates = fixture
            .acquirer()
            .acquire(&fixture.selected, &CancellationToken::new())
            .expect("selected cached package should acquire");

        assert_eq!(candidates.len(), 1);
        assert_no_connection(&fixture.unselected_listener);
    }

    #[test]
    fn invariant_catalog_acquisition_honours_cancellation_before_source_access() {
        let fixture = Fixture::new();
        let cancellation = CancellationToken::new();
        cancellation.cancel();

        let error = fixture
            .acquirer()
            .acquire(&fixture.unselected, &cancellation)
            .expect_err("cancelled acquisition must fail before source access");

        assert_eq!(error.code(), ErrorCode::SourceAccess);
        assert_no_connection(&fixture.unselected_listener);
    }

    #[test]
    fn invariant_concurrent_catalog_acquisition_converges_on_one_verified_cache_object() {
        let fixture = Fixture::new();
        let acquirer = fixture.acquirer();
        let first_acquirer = acquirer.clone();
        let first_package = fixture.selected.clone();
        let second_acquirer = acquirer.clone();
        let second_package = fixture.selected.clone();

        let first = thread::spawn(move || {
            first_acquirer
                .acquire(&first_package, &CancellationToken::new())
                .expect("first acquisition should work")
        });
        let second = thread::spawn(move || {
            second_acquirer
                .acquire(&second_package, &CancellationToken::new())
                .expect("second acquisition should reuse the result")
        });
        let first = first.join().expect("first acquisition should not panic");
        let second = second.join().expect("second acquisition should not panic");

        assert_eq!(first.len(), 1);
        assert_eq!(first[0].cache_object(), second[0].cache_object());
        assert_eq!(
            first[0].cache_object().path(),
            second[0].cache_object().path()
        );
    }

    #[test]
    fn invariant_corrupt_catalog_package_cache_fails_before_reuse() {
        let fixture = Fixture::new();
        let acquirer = fixture.acquirer();
        let first = acquirer
            .acquire(&fixture.selected, &CancellationToken::new())
            .expect("initial acquisition should work");
        fs::write(first[0].cache_object().path().join("plugin.gd"), "corrupt")
            .expect("cache object should become corrupt");

        let error = acquirer
            .acquire(&fixture.selected, &CancellationToken::new())
            .expect_err("corrupt cache must fail before candidate reuse");

        assert_eq!(error.code(), ErrorCode::IntegrityFailure);
    }

    #[test]
    fn invariant_catalog_candidate_identity_deduplicates_exact_sources_deterministically() {
        let fixture = Fixture::new();
        let candidate = fixture
            .acquirer()
            .acquire(&fixture.selected, &CancellationToken::new())
            .expect("candidate should acquire")
            .pop()
            .expect("candidate should exist");

        let unique = unique_candidates(
            &fixture.selected,
            vec![candidate.clone(), candidate.clone(), candidate],
        )
        .expect("exact source identities should deduplicate");

        assert_eq!(unique.len(), 1);
    }

    #[test]
    fn invariant_catalog_candidate_identity_rejects_ambiguous_sources_independently_of_order() {
        let fixture = Fixture::new();
        let candidate = fixture
            .acquirer()
            .acquire(&fixture.selected, &CancellationToken::new())
            .expect("candidate should acquire")
            .pop()
            .expect("candidate should exist");
        let mut mirror = candidate.clone();
        mirror.source = AcquiredCatalogSource::Http {
            url: "https://mirror.fixture.test/selected.zip".to_owned(),
            sha256: match mirror.source() {
                AcquiredCatalogSource::Http { sha256, .. } => sha256.clone(),
                AcquiredCatalogSource::Git { .. } => panic!("fixture should be HTTP"),
            },
            root: Path::new("addons/selected").to_path_buf(),
        };

        let first = unique_candidates(&fixture.selected, vec![candidate.clone(), mirror.clone()])
            .expect_err("distinct source identities must fail");
        let second = unique_candidates(&fixture.selected, vec![mirror, candidate])
            .expect_err("candidate order must not change ambiguity");

        assert_eq!(first.code(), ErrorCode::IntegrityFailure);
        assert_eq!(first.message(), second.message());
        assert!(
            first
                .message()
                .contains("https://fixture.test/selected.zip")
        );
        assert!(
            first
                .message()
                .contains("https://mirror.fixture.test/selected.zip")
        );
    }

    struct Fixture {
        _directory: TempDir,
        cache: CacheLayout,
        catalog: crate::source_catalog::ValidatedSourceCatalog,
        selected: PackageName,
        unselected: PackageName,
        unselected_listener: TcpListener,
    }

    impl Fixture {
        fn new() -> Self {
            let directory = TempDir::new().expect("fixture should exist");
            let cache =
                CacheLayout::for_root(directory.path().join("cache")).expect("cache should create");
            let unselected_listener =
                TcpListener::bind(("127.0.0.1", 0)).expect("listener should bind");
            unselected_listener
                .set_nonblocking(true)
                .expect("listener should become nonblocking");
            let selected_archive = archive();
            let selected_sha256 = checksum(&selected_archive);
            let selected_archive_path = cache.downloads().join("sha256").join(&selected_sha256);
            fs::create_dir_all(
                selected_archive_path
                    .parent()
                    .expect("archive parent should exist"),
            )
            .expect("archive parent should create");
            fs::write(selected_archive_path, selected_archive).expect("archive should write");
            let unselected_url = format!(
                "https://127.0.0.1:{}/unselected.zip",
                unselected_listener
                    .local_addr()
                    .expect("listener should have an address")
                    .port()
            );
            let catalog = SourceCatalog::parse(
                Path::new("fixture/wukong.sources.toml"),
                &format!(
                    "schema = 1\n\n[[package]]\nname = \"selected\"\n[package.http]\nversion = \"1.2.3\"\nurl = \"https://fixture.test/selected.zip\"\nsha256 = \"{selected_sha256}\"\nroot = \"addons/selected\"\n\n[[package]]\nname = \"unselected\"\n[package.http]\nversion = \"1.0.0\"\nurl = \"{unselected_url}\"\nsha256 = \"{}\"\nroot = \"addons/unselected\"\n",
                    "0".repeat(64)
                ),
            )
            .expect("catalog should parse")
            .validate(Path::new("fixture/wukong.sources.toml"))
            .expect("catalog should validate");
            Self {
                _directory: directory,
                cache,
                catalog,
                selected: PackageName::parse("selected").expect("package should parse"),
                unselected: PackageName::parse("unselected").expect("package should parse"),
                unselected_listener,
            }
        }

        fn acquirer(&self) -> CatalogCandidateAcquirer {
            CatalogCandidateAcquirer::new(self.catalog.clone(), self.cache.clone(), true)
        }
    }

    fn archive() -> Vec<u8> {
        let mut output = Vec::new();
        let mut archive = ZipWriter::new(std::io::Cursor::new(&mut output));
        let options = SimpleFileOptions::default().compression_method(CompressionMethod::Stored);
        archive
            .start_file("addons/selected/wukong-package.toml", options)
            .expect("metadata entry should start");
        archive
            .write_all(
                b"[package]\nschema = 1\nname = \"selected\"\nversion = \"1.2.3\"\ngodot = \"4\"\n",
            )
            .expect("metadata should write");
        archive
            .start_file("addons/selected/plugin.gd", options)
            .expect("plugin entry should start");
        archive
            .write_all(b"extends Node\n")
            .expect("plugin should write");
        archive.finish().expect("archive should finish");
        output
    }

    fn checksum(bytes: &[u8]) -> String {
        format!("{:x}", Sha256::digest(bytes))
    }

    fn assert_no_connection(listener: &TcpListener) {
        match listener.accept() {
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {}
            Ok((_, address)) => panic!("unexpected source access to {address}"),
            Err(error) => panic!("could not inspect source access: {error}"),
        }
    }
}
