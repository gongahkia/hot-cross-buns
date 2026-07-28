//! HTTPS archive download, checksum verification, and immutable cache publication.

use crate::{
    cache::CacheLayout,
    diagnostic::{Diagnostic, ErrorCode},
};
use fs2::FileExt;
use sha2::{Digest, Sha256};
use std::{
    fs,
    fs::{File, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
    time::Duration,
};
use tempfile::Builder;
use ureq::Agent;

const MAX_DOWNLOAD_BYTES: u64 = 256 * 1024 * 1024;

/// Non-bypassable HTTP archive download limits.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct DownloadLimits {
    max_bytes: u64,
}
impl Default for DownloadLimits {
    fn default() -> Self {
        Self {
            max_bytes: MAX_DOWNLOAD_BYTES,
        }
    }
}
impl DownloadLimits {
    /// Returns a caller-requested limit clamped to the secure default.
    #[must_use]
    pub const fn tightened(max_bytes: u64) -> Self {
        Self {
            max_bytes: if max_bytes < MAX_DOWNLOAD_BYTES {
                max_bytes
            } else {
                MAX_DOWNLOAD_BYTES
            },
        }
    }
}

/// A verified immutable archive download cached by SHA-256.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CachedArchive {
    path: PathBuf,
    sha256: String,
}
impl CachedArchive {
    /// Returns the verified archive file.
    #[must_use]
    pub fn path(&self) -> &Path {
        &self.path
    }
    /// Returns the verified lowercase SHA-256 digest.
    #[must_use]
    pub fn sha256(&self) -> &str {
        &self.sha256
    }
}

/// Fetches HTTPS archives without persisting source URLs.
#[derive(Clone, Debug)]
pub struct HttpArchiveFetcher {
    cache: CacheLayout,
    limits: DownloadLimits,
}
impl HttpArchiveFetcher {
    /// Creates an archive fetcher with secure default limits.
    #[must_use]
    pub const fn new(cache: CacheLayout) -> Self {
        Self {
            cache,
            limits: DownloadLimits {
                max_bytes: MAX_DOWNLOAD_BYTES,
            },
        }
    }
    /// Selects a limit no larger than the secure default.
    #[must_use]
    pub const fn with_limits(mut self, limits: DownloadLimits) -> Self {
        self.limits = limits;
        self
    }
    /// Fetches an HTTPS archive or reuses a verified checksum-addressed file.
    ///
    /// # Errors
    ///
    /// Returns a redacted diagnostic for invalid URLs, unavailable offline
    /// cache entries, oversized responses, checksum mismatch, or transport I/O.
    pub fn fetch(
        &self,
        url: &str,
        sha256: &str,
        offline: bool,
    ) -> Result<CachedArchive, Box<Diagnostic>> {
        self.fetch_with(url, sha256, offline, |staged| {
            download(url, staged, sha256, self.limits)
        })
    }

    fn fetch_with(
        &self,
        url: &str,
        sha256: &str,
        offline: bool,
        download_staged: impl FnOnce(&Path) -> Result<(), Box<Diagnostic>>,
    ) -> Result<CachedArchive, Box<Diagnostic>> {
        validate(url, sha256)?;
        let final_path = self.cache.downloads().join("sha256").join(sha256);
        let _lock = Lock::acquire(
            &self
                .cache
                .locks()
                .join("http")
                .join(format!("{sha256}.lock")),
        )?;
        if final_path.is_file() {
            return verify(&final_path, sha256);
        }
        if offline {
            return Err(source(
                url,
                "archive is unavailable in the local cache",
                "run without --offline to download it",
            ));
        }
        let parent = final_path
            .parent()
            .ok_or_else(|| internal("archive cache path has no parent", "invalid cache layout"))?;
        fs::create_dir_all(parent)
            .map_err(|error| internal("could not create archive cache directory", error))?;
        let prefix = staging_prefix(sha256);
        clean_abandoned_staging(parent, &prefix)?;
        let staging = Builder::new()
            .prefix(&prefix)
            .tempdir_in(parent)
            .map_err(|error| internal("could not create archive download staging", error))?;
        let staged = staging.path().join("archive");
        download_staged(&staged)?;
        match fs::rename(&staged, &final_path) {
            Ok(()) => {
                #[cfg(unix)]
                sync_directory(parent)?;
                verify(&final_path, sha256)
            }
            Err(_) if final_path.is_file() => verify(&final_path, sha256),
            Err(error) => Err(internal("could not publish archive cache entry", error)),
        }
    }
}

fn download(
    url: &str,
    staged: &Path,
    expected: &str,
    limits: DownloadLimits,
) -> Result<(), Box<Diagnostic>> {
    let agent: Agent = Agent::config_builder()
        .https_only(true)
        .max_redirects(0)
        .timeout_global(Some(Duration::from_secs(60)))
        .build()
        .into();
    let mut current = safe_url(url)?;
    let mut redirects = 0_u8;
    let response = loop {
        let response = agent
            .get(current.as_str())
            .call()
            .map_err(|error| source(url, "could not download HTTPS archive", error))?;
        if !response.status().is_redirection() {
            break response;
        }
        if redirects == 5 {
            return Err(source(
                url,
                "archive redirect limit was exceeded",
                "use an archive URL with at most five HTTPS redirects",
            ));
        }
        let next = response
            .headers()
            .get("location")
            .and_then(|value| value.to_str().ok())
            .ok_or_else(|| {
                source(
                    url,
                    "archive redirect did not provide a valid location",
                    "use an archive URL with valid HTTPS redirects",
                )
            })?;
        current = redirect_target(&current, next, url)?;
        redirects += 1;
    };
    if !response.status().is_success() {
        return Err(source(
            url,
            "archive server returned an unsuccessful response",
            format!("server returned HTTP {}", response.status()),
        ));
    }
    if response
        .headers()
        .get("content-length")
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.parse::<u64>().ok())
        .is_some_and(|size| size > limits.max_bytes)
    {
        return Err(source(
            url,
            "archive response exceeds the download-size limit",
            size_limit_recovery(limits),
        ));
    }
    let mut input = response.into_body().into_reader();
    stream_download(&mut input, staged, expected, limits, url)
}

fn stream_download(
    input: &mut impl Read,
    staged: &Path,
    expected: &str,
    limits: DownloadLimits,
    url: &str,
) -> Result<(), Box<Diagnostic>> {
    let mut output = OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(staged)
        .map_err(|error| internal("could not stage archive download", error))?;
    let mut hash = Sha256::new();
    let mut total = 0_u64;
    let mut buffer = [0_u8; 8192];
    loop {
        let count = input
            .read(&mut buffer)
            .map_err(|error| source(url, "could not read archive response", error))?;
        if count == 0 {
            break;
        }
        total = total.checked_add(count as u64).ok_or_else(|| {
            source(
                url,
                "archive response exceeds the download-size limit",
                size_limit_recovery(limits),
            )
        })?;
        if total > limits.max_bytes {
            return Err(source(
                url,
                "archive response exceeds the download-size limit",
                size_limit_recovery(limits),
            ));
        }
        output
            .write_all(&buffer[..count])
            .map_err(|error| internal("could not stage archive download", error))?;
        hash.update(&buffer[..count]);
    }
    output
        .sync_all()
        .map_err(|error| internal("could not flush archive download", error))?;
    if format!("{:x}", hash.finalize()) != expected {
        return Err(integrity(
            url,
            "archive checksum did not match the declared SHA-256",
            "correct the checksum or archive URL",
        ));
    }
    Ok(())
}
fn verify(path: &Path, expected: &str) -> Result<CachedArchive, Box<Diagnostic>> {
    if !path
        .metadata()
        .map_err(|error| internal("could not inspect archive cache entry", error))?
        .is_file()
    {
        return Err(Box::new(
            Diagnostic::new(
                ErrorCode::IntegrityFailure,
                "archive cache entry is not a regular file",
            )
            .with_recovery("remove the corrupt archive cache entry and retry"),
        ));
    }
    let mut file =
        File::open(path).map_err(|error| internal("could not read archive cache entry", error))?;
    let mut hash = Sha256::new();
    let mut buffer = [0_u8; 8192];
    loop {
        let count = file
            .read(&mut buffer)
            .map_err(|error| internal("could not verify archive cache entry", error))?;
        if count == 0 {
            break;
        }
        hash.update(&buffer[..count]);
    }
    if format!("{:x}", hash.finalize()) != expected {
        return Err(Box::new(
            Diagnostic::new(
                ErrorCode::IntegrityFailure,
                "archive cache entry failed checksum verification",
            )
            .with_recovery("remove the corrupt archive cache entry and retry"),
        ));
    }
    Ok(CachedArchive {
        path: path.to_path_buf(),
        sha256: expected.to_owned(),
    })
}
fn validate(url: &str, sha256: &str) -> Result<(), Box<Diagnostic>> {
    safe_url(url)?;
    if sha256.len() != 64
        || !sha256
            .bytes()
            .all(|byte| byte.is_ascii_digit() || matches!(byte, b'a'..=b'f'))
    {
        return Err(Box::new(
            Diagnostic::new(
                ErrorCode::UserInput,
                "archive checksum must be lowercase SHA-256",
            )
            .with_recovery("use a 64-character lowercase hexadecimal SHA-256"),
        ));
    }
    Ok(())
}
fn safe_url(url: &str) -> Result<url::Url, Box<Diagnostic>> {
    let parsed =
        url::Url::parse(url).map_err(|error| source(url, "archive URL is invalid", error))?;
    if parsed.scheme() != "https"
        || parsed.host_str().is_none()
        || !parsed.username().is_empty()
        || parsed.password().is_some()
        || parsed.fragment().is_some()
        || parsed
            .query_pairs()
            .any(|(key, _)| is_sensitive_query_key(&key))
    {
        return Err(source(
            url,
            "archive URL must be credential-free HTTPS without a fragment",
            "use an HTTPS archive URL without credentials",
        ));
    }
    Ok(parsed)
}
fn redirect_target(
    current: &url::Url,
    location: &str,
    original: &str,
) -> Result<url::Url, Box<Diagnostic>> {
    let target = current
        .join(location)
        .map_err(|error| source(original, "archive redirect target is invalid", error))?;
    safe_url(target.as_str()).map_err(|_| {
        source(
            original,
            "archive redirect target is not safe HTTPS",
            "use an archive URL with valid HTTPS redirects",
        )
    })
}
fn is_sensitive_query_key(key: &str) -> bool {
    let key = key.to_ascii_lowercase();
    key.contains("token")
        || key.contains("secret")
        || key.contains("password")
        || key.contains("credential")
        || key == "key"
        || key.contains("api_key")
        || key.contains("apikey")
}
fn size_limit_recovery(limits: DownloadLimits) -> String {
    format!("use an archive no larger than {} bytes", limits.max_bytes)
}
fn staging_prefix(sha256: &str) -> String {
    format!(".wukong-download-{sha256}-")
}
fn clean_abandoned_staging(parent: &Path, prefix: &str) -> Result<(), Box<Diagnostic>> {
    let entries = fs::read_dir(parent)
        .map_err(|error| internal("could not inspect archive download staging", error))?;
    for entry in entries {
        let entry =
            entry.map_err(|error| internal("could not inspect archive download staging", error))?;
        if !entry.file_name().to_string_lossy().starts_with(prefix) {
            continue;
        }
        if entry
            .file_type()
            .map_err(|error| internal("could not inspect archive download staging", error))?
            .is_dir()
        {
            fs::remove_dir_all(entry.path()).map_err(|error| {
                internal("could not remove interrupted archive download", error)
            })?;
        }
    }
    Ok(())
}
#[cfg(unix)]
fn sync_directory(path: &Path) -> Result<(), Box<Diagnostic>> {
    File::open(path)
        .and_then(|directory| directory.sync_all())
        .map_err(|error| internal("could not flush archive cache directory", error))
}
struct Lock(File);
impl Lock {
    fn acquire(path: &Path) -> Result<Self, Box<Diagnostic>> {
        fs::create_dir_all(
            path.parent().ok_or_else(|| {
                internal("archive lock path has no parent", "invalid cache layout")
            })?,
        )
        .map_err(|error| internal("could not create archive lock directory", error))?;
        let file = OpenOptions::new()
            .create(true)
            .read(true)
            .write(true)
            .truncate(false)
            .open(path)
            .map_err(|error| internal("could not open archive cache lock", error))?;
        file.lock_exclusive()
            .map_err(|error| internal("could not acquire archive cache lock", error))?;
        Ok(Self(file))
    }
}
impl Drop for Lock {
    fn drop(&mut self) {
        let _ = FileExt::unlock(&self.0);
    }
}
fn source(
    url: &str,
    message: impl AsRef<str>,
    recovery: impl std::fmt::Display,
) -> Box<Diagnostic> {
    Box::new(
        Diagnostic::new(ErrorCode::SourceAccess, message)
            .with_source(url)
            .with_recovery(recovery.to_string()),
    )
}
fn integrity(
    url: &str,
    message: impl AsRef<str>,
    recovery: impl std::fmt::Display,
) -> Box<Diagnostic> {
    Box::new(
        Diagnostic::new(ErrorCode::IntegrityFailure, message)
            .with_source(url)
            .with_recovery(recovery.to_string()),
    )
}
fn internal(message: &str, error: impl std::fmt::Display) -> Box<Diagnostic> {
    Box::new(
        Diagnostic::new(ErrorCode::InternalFailure, message)
            .with_cause(error)
            .with_recovery("check cache permissions and retry"),
    )
}

#[cfg(test)]
mod tests {
    use super::{
        CachedArchive, DownloadLimits, HttpArchiveFetcher, clean_abandoned_staging,
        redirect_target, staging_prefix, stream_download,
    };
    use crate::{cache::CacheLayout, diagnostic::ErrorCode};
    use sha2::{Digest, Sha256};
    use std::{
        fs,
        io::{self, Cursor, Read},
    };
    use tempfile::TempDir;

    #[test]
    fn invariant_archive_download_publishes_a_verified_zip_and_reuses_warm_cache() {
        let fixture = Fixture::new();
        let body = empty_zip();
        let checksum = checksum(&body);
        let first = fixture
            .fetch_with_body(&body, &checksum, false)
            .expect("fetch should work");

        zip::ZipArchive::new(fs::File::open(first.path()).expect("archive should exist"))
            .expect("download should be a ZIP");
        let second = fixture
            .fetcher
            .fetch_with(fixture.url, &checksum, true, |_| {
                panic!("warm cache must not download")
            })
            .expect("offline warm cache should work");

        assert_eq!(first, second);
        assert_eq!(first.sha256(), checksum);
    }

    #[test]
    fn invariant_archive_checksum_mismatch_never_publishes_a_cache_entry() {
        let fixture = Fixture::new();
        let body = empty_zip();
        let checksum = "0".repeat(64);

        let error = fixture
            .fetch_with_body(&body, &checksum, false)
            .expect_err("checksum mismatch should fail");

        assert_eq!(error.code(), ErrorCode::IntegrityFailure);
        assert!(!fixture.archive_path(&checksum).exists());
    }

    #[test]
    fn invariant_archive_size_limit_and_interruption_never_publish_partial_content() {
        let fixture = Fixture::new();
        let body = empty_zip();
        let archive_checksum = checksum(&body);
        let limited = HttpArchiveFetcher::new(fixture.cache.clone())
            .with_limits(DownloadLimits::tightened((body.len() - 1) as u64));
        let error = limited
            .fetch_with(fixture.url, &archive_checksum, false, |staged| {
                let mut input = Cursor::new(&body);
                stream_download(
                    &mut input,
                    staged,
                    &archive_checksum,
                    DownloadLimits::tightened((body.len() - 1) as u64),
                    fixture.url,
                )
            })
            .expect_err("oversized archive should fail");
        assert_eq!(error.code(), ErrorCode::SourceAccess);
        assert!(!fixture.archive_path(&archive_checksum).exists());

        let interrupted_checksum = checksum(b"partial archive");
        let error = fixture
            .fetcher
            .fetch_with(fixture.url, &interrupted_checksum, false, |staged| {
                let mut input = InterruptedReader::new(b"partial archive");
                stream_download(
                    &mut input,
                    staged,
                    &interrupted_checksum,
                    DownloadLimits::default(),
                    fixture.url,
                )
            })
            .expect_err("interrupted download should fail");
        assert_eq!(error.code(), ErrorCode::SourceAccess);
        assert!(!fixture.archive_path(&interrupted_checksum).exists());
    }

    #[test]
    fn invariant_interrupted_archive_staging_is_removed_before_retry() {
        let fixture = Fixture::new();
        let body = empty_zip();
        let checksum = checksum(&body);
        let parent = fixture.cache.downloads().join("sha256");
        fs::create_dir_all(&parent).expect("download parent should create");
        let abandoned = parent.join(format!("{}abandoned", staging_prefix(&checksum)));
        fs::create_dir_all(&abandoned).expect("abandoned staging should create");

        fixture
            .fetch_with_body(&body, &checksum, false)
            .expect("retry should work");

        assert!(!abandoned.exists());
        clean_abandoned_staging(&parent, &staging_prefix(&checksum))
            .expect("second cleanup should work");
    }

    #[test]
    fn invariant_archive_redirects_and_urls_must_remain_credential_free_https() {
        let current = url::Url::parse("https://fixture.test/addon.zip").expect("URL should parse");

        assert_eq!(
            redirect_target(&current, "/next.zip", current.as_str())
                .expect("relative HTTPS redirect should work")
                .as_str(),
            "https://fixture.test/next.zip"
        );
        for location in [
            "http://fixture.test/next.zip",
            "https://user:password@fixture.test/next.zip",
            "https://fixture.test/next.zip?access_token=secret",
            "https://fixture.test/next.zip#fragment",
        ] {
            assert!(redirect_target(&current, location, current.as_str()).is_err());
        }
        let fixture = Fixture::new();
        assert!(
            fixture
                .fetcher
                .fetch("http://fixture.test/addon.zip", &"0".repeat(64), false)
                .is_err()
        );
        assert!(
            fixture
                .fetcher
                .fetch("https://", &"0".repeat(64), false)
                .is_err()
        );
    }

    #[test]
    #[ignore = "requires network access to a public pinned HTTPS archive"]
    fn invariant_public_https_zip_download_is_checksum_verified() {
        let fixture = Fixture::new();
        let archive = fixture
            .fetcher
            .fetch(
                "https://github.com/Goutte/godot-addon-animated-shape-2d/archive/4ab90a80b815bc1ad4a8d7eea92c785e654bfd91.zip",
                "77c61f3a6ace3a2b9d1729f6d52af90e6c9b6671e1db798cd91dec1ad666e91b",
                false,
            )
            .expect("public HTTPS archive should download");

        zip::ZipArchive::new(fs::File::open(archive.path()).expect("archive should exist"))
            .expect("download should be a ZIP");
    }

    #[test]
    #[ignore = "requires network access to an invalid TLS endpoint"]
    fn invariant_invalid_tls_is_rejected_before_archive_publication() {
        let fixture = Fixture::new();
        let checksum = "0".repeat(64);

        let error = fixture
            .fetcher
            .fetch("https://self-signed.badssl.com/", &checksum, false)
            .expect_err("invalid TLS should fail");

        assert_eq!(error.code(), ErrorCode::SourceAccess);
        assert!(!fixture.archive_path(&checksum).exists());
    }

    struct Fixture {
        _directory: TempDir,
        cache: CacheLayout,
        fetcher: HttpArchiveFetcher,
        url: &'static str,
    }
    impl Fixture {
        fn new() -> Self {
            let directory = TempDir::new().expect("fixture should exist");
            let cache = CacheLayout::for_root(directory.path().join("cache"))
                .expect("cache layout should work");
            let fetcher = HttpArchiveFetcher::new(cache.clone());
            Self {
                _directory: directory,
                cache,
                fetcher,
                url: "https://fixture.test/addon.zip",
            }
        }
        fn fetch_with_body(
            &self,
            body: &[u8],
            checksum: &str,
            offline: bool,
        ) -> Result<CachedArchive, Box<crate::diagnostic::Diagnostic>> {
            self.fetcher
                .fetch_with(self.url, checksum, offline, |staged| {
                    let mut input = Cursor::new(body);
                    stream_download(
                        &mut input,
                        staged,
                        checksum,
                        DownloadLimits::default(),
                        self.url,
                    )
                })
        }
        fn archive_path(&self, checksum: &str) -> std::path::PathBuf {
            self.cache.downloads().join("sha256").join(checksum)
        }
    }

    struct InterruptedReader {
        input: Cursor<&'static [u8]>,
        interrupted: bool,
    }
    impl InterruptedReader {
        fn new(input: &'static [u8]) -> Self {
            Self {
                input: Cursor::new(input),
                interrupted: false,
            }
        }
    }
    impl Read for InterruptedReader {
        fn read(&mut self, buffer: &mut [u8]) -> io::Result<usize> {
            if self.interrupted {
                return Err(io::Error::new(
                    io::ErrorKind::Interrupted,
                    "fixture interruption",
                ));
            }
            self.interrupted = true;
            self.input.read(buffer)
        }
    }

    fn empty_zip() -> Vec<u8> {
        vec![
            0x50, 0x4b, 0x05, 0x06, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
            0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
        ]
    }
    fn checksum(content: &[u8]) -> String {
        let mut hasher = Sha256::new();
        hasher.update(content);
        format!("{:x}", hasher.finalize())
    }
}
