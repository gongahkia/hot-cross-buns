//! HTTPS archive acquisition for validated project source-catalog candidates.

use crate::{
    archive::{ExtractionLimits, extract_zip},
    diagnostic::{Diagnostic, ErrorCode},
    http_archive::HttpArchiveFetcher,
    identity::PackageName,
    package_metadata::PackageMetadata,
    source::SourceResult,
    source_catalog::ValidatedCatalogHttpCandidate,
};
use std::path::{Path, PathBuf};
use tempfile::TempDir;

pub(crate) struct CatalogHttpExtraction {
    _staging: TempDir,
    root: PathBuf,
}

impl CatalogHttpExtraction {
    pub(crate) fn root(&self) -> &Path {
        &self.root
    }
}

/// HTTPS archive acquisition and metadata admission for source-catalog entries.
#[derive(Clone, Debug)]
pub struct CatalogHttpAdapter {
    fetcher: HttpArchiveFetcher,
}

impl CatalogHttpAdapter {
    /// Creates an adapter backed by `fetcher`'s checksum-addressed archive cache.
    #[must_use]
    pub const fn new(fetcher: HttpArchiveFetcher) -> Self {
        Self { fetcher }
    }

    /// Acquires a catalog archive and verifies required package metadata.
    ///
    /// This reuses the HTTPS fetcher's redirect, TLS, checksum, and offline
    /// cache policy. ZIP content is extracted only inside disposable staging;
    /// this method does not publish a lockfile or package tree.
    ///
    /// # Errors
    ///
    /// Returns a diagnostic when the archive is unavailable or unsafe, ZIP
    /// extraction fails, metadata is missing, or metadata name/version differs
    /// from the project-reviewed catalog declaration.
    pub fn verify_package_metadata(
        &self,
        package: &PackageName,
        candidate: &ValidatedCatalogHttpCandidate,
        staging_parent: &Path,
        offline: bool,
    ) -> SourceResult<PackageMetadata> {
        let extracted = self.fetch_and_extract(candidate, staging_parent, offline)?;
        Self::verify_extracted_package_metadata(package, candidate, extracted.root())
    }

    pub(crate) fn fetch_and_extract(
        &self,
        candidate: &ValidatedCatalogHttpCandidate,
        staging_parent: &Path,
        offline: bool,
    ) -> SourceResult<CatalogHttpExtraction> {
        let archive = self
            .fetcher
            .fetch(candidate.url(), candidate.sha256(), offline)?;
        let staging = TempDir::new_in(staging_parent).map_err(|error| {
            Box::new(
                Diagnostic::new(
                    ErrorCode::InternalFailure,
                    "could not create catalog archive metadata staging directory",
                )
                .with_cause(error)
                .with_recovery("check staging-directory permissions and retry"),
            )
        })?;
        let extracted = extract_zip(archive.path(), staging.path(), ExtractionLimits::default())?;
        Ok(CatalogHttpExtraction {
            _staging: staging,
            root: extracted.root().to_path_buf(),
        })
    }

    pub(crate) fn verify_extracted_package_metadata(
        package: &PackageName,
        candidate: &ValidatedCatalogHttpCandidate,
        extracted_root: &Path,
    ) -> SourceResult<PackageMetadata> {
        let metadata_root = extracted_root.join(candidate.root());
        let metadata = PackageMetadata::load_optional(&metadata_root)?.ok_or_else(|| {
            Box::new(
                Diagnostic::new(
                    ErrorCode::IntegrityFailure,
                    format!(
                        "package {} archive version {} has no wukong-package.toml",
                        package.as_str(),
                        candidate.version()
                    ),
                )
                .with_package(package.as_str())
                .with_source(candidate.url())
                .with_recovery("add valid package metadata below the catalog root before locking"),
            )
        })?;
        if metadata.name() != package {
            return Err(Box::new(
                Diagnostic::new(
                    ErrorCode::IntegrityFailure,
                    format!(
                        "package {} archive version {} has metadata name {}, expected {}",
                        package.as_str(),
                        candidate.version(),
                        metadata.name(),
                        package.as_str()
                    ),
                )
                .with_package(package.as_str())
                .with_source(candidate.url())
                .with_recovery("correct package.name before locking"),
            ));
        }
        if metadata.version().without_build_metadata()
            != candidate.version().without_build_metadata()
        {
            return Err(Box::new(
                Diagnostic::new(
                    ErrorCode::IntegrityFailure,
                    format!(
                        "package {} archive version {} has metadata version {}, expected {}",
                        package.as_str(),
                        candidate.version(),
                        metadata.version(),
                        candidate.version()
                    ),
                )
                .with_package(package.as_str())
                .with_source(candidate.url())
                .with_recovery("correct package.version before locking"),
            ));
        }
        Ok(metadata)
    }
}

#[cfg(test)]
mod tests {
    use super::CatalogHttpAdapter;
    use crate::{
        cache::CacheLayout,
        diagnostic::ErrorCode,
        http_archive::HttpArchiveFetcher,
        identity::PackageName,
        source_catalog::{SourceCatalog, ValidatedCatalogCandidate, ValidatedCatalogHttpCandidate},
    };
    use sha2::{Digest, Sha256};
    use std::{
        fs,
        io::Write,
        net::TcpListener,
        path::{Path, PathBuf},
    };
    use tempfile::TempDir;
    use zip::{CompressionMethod, ZipWriter, write::SimpleFileOptions};

    #[test]
    fn invariant_catalog_http_admission_reuses_verified_archive_cache_offline() {
        let fixture = Fixture::new("catalog", "1.2.3");
        let metadata = fixture
            .adapter()
            .verify_package_metadata(&package(), fixture.candidate(), fixture.staging(), true)
            .expect("verified warm archive should admit offline");

        assert_eq!(metadata.name().as_str(), "catalog");
        assert_eq!(metadata.version().to_string(), "1.2.3");
        assert!(staging_entries(fixture.staging()).is_empty());
        assert_no_connection(&fixture.listener);
    }

    #[test]
    fn invariant_catalog_http_admission_rejects_mismatched_package_name() {
        let fixture = Fixture::new("other", "1.2.3");

        let error = fixture
            .adapter()
            .verify_package_metadata(&package(), fixture.candidate(), fixture.staging(), true)
            .expect_err("metadata name mismatch must fail");

        assert_eq!(error.code(), ErrorCode::IntegrityFailure);
        assert_eq!(error.package(), Some("catalog"));
        assert!(error.message().contains("catalog"));
        assert!(error.message().contains("other"));
    }

    #[test]
    fn invariant_catalog_http_admission_rejects_mismatched_package_version() {
        let fixture = Fixture::new("catalog", "1.2.4");

        let error = fixture
            .adapter()
            .verify_package_metadata(&package(), fixture.candidate(), fixture.staging(), true)
            .expect_err("metadata version mismatch must fail");

        assert_eq!(error.code(), ErrorCode::IntegrityFailure);
        assert_eq!(error.package(), Some("catalog"));
        assert!(error.message().contains("1.2.3"));
        assert!(error.message().contains("1.2.4"));
    }

    struct Fixture {
        directory: TempDir,
        cache: CacheLayout,
        listener: TcpListener,
        candidate: ValidatedCatalogHttpCandidate,
    }

    impl Fixture {
        fn new(metadata_name: &str, metadata_version: &str) -> Self {
            let directory = TempDir::new().expect("fixture should exist");
            let cache =
                CacheLayout::for_root(directory.path().join("cache")).expect("cache should create");
            let listener = TcpListener::bind(("127.0.0.1", 0)).expect("listener should bind");
            listener
                .set_nonblocking(true)
                .expect("listener should become nonblocking");
            let url = format!(
                "https://127.0.0.1:{}/catalog.zip",
                listener
                    .local_addr()
                    .expect("listener address should exist")
                    .port()
            );
            let bytes = archive(metadata_name, metadata_version);
            let sha256 = checksum(&bytes);
            let candidate = candidate(&url, &sha256);
            let archive_path = cache.downloads().join("sha256").join(&sha256);
            fs::create_dir_all(archive_path.parent().expect("archive parent should exist"))
                .expect("archive parent should create");
            fs::write(archive_path, bytes).expect("verified archive should write");
            Self {
                directory,
                cache,
                listener,
                candidate,
            }
        }

        fn adapter(&self) -> CatalogHttpAdapter {
            CatalogHttpAdapter::new(HttpArchiveFetcher::new(self.cache.clone()))
        }

        fn candidate(&self) -> &ValidatedCatalogHttpCandidate {
            &self.candidate
        }

        fn staging(&self) -> &Path {
            self.directory.path()
        }
    }

    fn candidate(url: &str, sha256: &str) -> ValidatedCatalogHttpCandidate {
        let catalog = SourceCatalog::parse(
            Path::new("fixture/wukong.sources.toml"),
            &format!(
                "schema = 1\n\n[[package]]\nname = \"catalog\"\n[package.http]\nversion = \"1.2.3\"\nurl = \"{url}\"\nsha256 = \"{sha256}\"\nroot = \"addons/catalog\"\n"
            ),
        )
        .expect("catalog should parse")
        .validate(Path::new("fixture/wukong.sources.toml"))
        .expect("catalog should validate");
        let candidate = catalog
            .packages()
            .values()
            .next()
            .and_then(|candidates| candidates.first())
            .expect("candidate should exist");
        let ValidatedCatalogCandidate::Http(candidate) = candidate else {
            panic!("candidate should be HTTP");
        };
        candidate.clone()
    }

    fn package() -> PackageName {
        PackageName::parse("catalog").expect("package name should parse")
    }

    fn archive(name: &str, version: &str) -> Vec<u8> {
        let mut output = Vec::new();
        let mut archive = ZipWriter::new(std::io::Cursor::new(&mut output));
        let options = SimpleFileOptions::default().compression_method(CompressionMethod::Stored);
        archive
            .start_file("addons/catalog/wukong-package.toml", options)
            .expect("metadata entry should start");
        write!(
            archive,
            "[package]\nschema = 1\nname = \"{name}\"\nversion = \"{version}\"\ngodot = \"4\"\n"
        )
        .expect("metadata should write");
        archive
            .start_file("addons/catalog/plugin.gd", options)
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

    fn staging_entries(path: &Path) -> Vec<PathBuf> {
        fs::read_dir(path)
            .expect("staging parent should be readable")
            .map(|entry| entry.expect("staging entry should read").path())
            .filter(|path| path.file_name().is_some_and(|name| name != "cache"))
            .collect()
    }

    fn assert_no_connection(listener: &TcpListener) {
        match listener.accept() {
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {}
            Ok((_, address)) => panic!("offline archive fetch opened a socket to {address}"),
            Err(error) => panic!("could not inspect offline archive listener: {error}"),
        }
    }
}
