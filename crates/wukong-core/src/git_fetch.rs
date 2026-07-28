//! Immutable Git checkout fetching through the user-installed `git` executable.

use crate::{
    cache::CacheLayout,
    diagnostic::{Diagnostic, ErrorCode},
    git_source::{GitSourceRequest, canonicalize_git_source},
    identity::GitSourceIdentity,
    manifest::GitReference,
    semantic_version::SemanticVersion,
    source::{ImmutableSourceId, ResolvedSource, SourceResult},
};
use fs2::FileExt;
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeMap,
    fs,
    fs::{File, OpenOptions},
    path::{Path, PathBuf},
    process::Command,
};
use tempfile::Builder;

/// A Git repository pinned to one immutable commit.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct GitResolution {
    source: GitSourceIdentity,
    commit: String,
    immutable_id: ImmutableSourceId,
}
impl GitResolution {
    /// Returns the canonical source repository.
    #[must_use]
    pub fn source(&self) -> &GitSourceIdentity {
        &self.source
    }
    /// Returns the complete resolved Git commit ID.
    #[must_use]
    pub fn commit(&self) -> &str {
        &self.commit
    }
}
impl ResolvedSource for GitResolution {
    fn immutable_id(&self) -> &ImmutableSourceId {
        &self.immutable_id
    }
}

/// A verified immutable Git checkout cache entry.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct GitCheckout {
    root: PathBuf,
    resolution: GitResolution,
}

/// A validated prefix stripped from Git tags before semantic-version parsing.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct GitTagPrefix(String);

impl GitTagPrefix {
    /// Validates a non-empty Git tag prefix.
    ///
    /// # Errors
    ///
    /// Returns [`GitTagPrefixError`] when the prefix cannot begin a safe Git tag.
    pub fn parse(value: impl Into<String>) -> Result<Self, GitTagPrefixError> {
        let value = value.into();
        if value.is_empty()
            || GitReference::Tag(format!("{value}0.0.0"))
                .validate()
                .is_err()
        {
            return Err(GitTagPrefixError);
        }
        Ok(Self(value))
    }

    /// Returns the configured tag prefix.
    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

/// An invalid Git tag prefix.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct GitTagPrefixError;

impl std::fmt::Display for GitTagPrefixError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("Git tag prefix must be non-empty and form a safe Git tag prefix")
    }
}

impl std::error::Error for GitTagPrefixError {}

/// Deterministic semantic versions discovered from one Git repository.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct GitVersionCatalog {
    versions: BTreeMap<SemanticVersion, String>,
}

impl GitVersionCatalog {
    /// Returns version-to-immutable-commit mappings in version order.
    #[must_use]
    pub const fn versions(&self) -> &BTreeMap<SemanticVersion, String> {
        &self.versions
    }

    /// Returns the immutable commit selected for `version`.
    #[must_use]
    pub fn commit(&self, version: &SemanticVersion) -> Option<&str> {
        self.versions.get(version).map(String::as_str)
    }
}
impl GitCheckout {
    /// Returns the checkout root.
    #[must_use]
    pub fn root(&self) -> &Path {
        &self.root
    }
    /// Returns the immutable checkout resolution.
    #[must_use]
    pub fn resolution(&self) -> &GitResolution {
        &self.resolution
    }
}

/// Fetches Git sources without handling credentials or invoking a shell.
#[derive(Clone, Debug)]
pub struct GitFetcher {
    cache: CacheLayout,
    executable: PathBuf,
}
impl GitFetcher {
    /// Creates a fetcher that invokes `git` from the user's `PATH`.
    #[must_use]
    pub fn new(cache: CacheLayout) -> Self {
        Self {
            cache,
            executable: PathBuf::from("git"),
        }
    }

    /// Fetches a Git declaration or reuses its verified immutable checkout.
    ///
    /// `offline` permits only an existing selector mapping and verified checkout.
    ///
    /// # Errors
    ///
    /// Returns a redacted diagnostic when Git fails, a revision is unavailable,
    /// or an offline checkout is absent or corrupt.
    pub fn fetch(&self, request: &GitSourceRequest, offline: bool) -> SourceResult<GitCheckout> {
        let source = canonicalize_git_source(request)?;
        self.fetch_remote(&source, request.reference(), source.as_str(), offline)
    }

    /// Discovers semantic-version Git tags and their immutable commits.
    ///
    /// A configured prefix is stripped exactly before parsing a tag as `SemVer`.
    /// Online discovery always refreshes metadata; offline discovery accepts only
    /// a verified cached catalog for the same canonical source and prefix.
    ///
    /// # Errors
    ///
    /// Returns a diagnostic when Git cannot enumerate or peel tags, a version
    /// maps to conflicting commits, or offline metadata is unavailable or invalid.
    pub fn discover_versions(
        &self,
        request: &GitSourceRequest,
        tag_prefix: Option<&GitTagPrefix>,
        offline: bool,
    ) -> SourceResult<GitVersionCatalog> {
        let source = canonicalize_git_source(request)?;
        let _lock = CacheLock::acquire(&self.lock_path(&source))?;
        if offline {
            return self.cached_versions(&source, tag_prefix)?.ok_or_else(|| {
                source_error(
                    source.as_str(),
                    "Git version metadata is unavailable in the local cache",
                    "run without --offline to discover version tags",
                )
            });
        }

        let catalog = self.discover_remote_versions(&source, source.as_str(), tag_prefix)?;
        self.write_cached_versions(&source, tag_prefix, &catalog)?;
        Ok(catalog)
    }

    fn fetch_remote(
        &self,
        source: &GitSourceIdentity,
        reference: Option<&GitReference>,
        remote: &str,
        offline: bool,
    ) -> SourceResult<GitCheckout> {
        let selector = selector(reference);
        let _lock = CacheLock::acquire(&self.lock_path(source))?;
        if let Some(commit) = self.cached_commit(source, &selector)? {
            if let Ok(checkout) = self.verified_checkout(source, &commit) {
                return Ok(checkout);
            }
        }
        if offline {
            return Err(source_error(
                source.as_str(),
                "Git source is unavailable in the local cache",
                "run without --offline to fetch the required Git commit",
            ));
        }
        let parent = self.checkout_parent();
        fs::create_dir_all(&parent)
            .map_err(|error| internal("could not create Git cache directory", error))?;
        let prefix = staging_prefix(source);
        clean_abandoned_staging(&parent, &prefix)?;
        let staging = Builder::new()
            .prefix(&prefix)
            .tempdir_in(&parent)
            .map_err(|error| internal("could not create Git fetch staging directory", error))?;
        let checkout = staging.path().join("checkout");
        self.run(
            &["init", "--quiet", checkout.to_string_lossy().as_ref()],
            source,
        )?;
        self.run_in(
            &checkout,
            [
                "-c",
                "fetch.recurseSubmodules=false",
                "-c",
                "submodule.recurse=false",
                "fetch",
                "--no-tags",
                remote,
                &fetch_spec(reference),
            ],
            source,
        )?;
        let commit = self.output_in(
            &checkout,
            ["rev-parse", "--verify", "FETCH_HEAD^{commit}"],
            source,
        )?;
        let commit = commit.trim();
        GitReference::Rev(commit.to_owned())
            .validate()
            .map_err(|_| {
                source_error(
                    source.as_str(),
                    "Git fetch did not resolve a complete commit",
                    "select a valid Git revision and retry",
                )
            })?;
        self.run_in(
            &checkout,
            ["checkout", "--quiet", "--detach", "--force", commit],
            source,
        )?;
        let resolution = resolution(source.clone(), commit)?;
        let final_path = self.checkout_path(source, resolution.commit());
        let published = self.publish_checkout(&checkout, &final_path, &resolution)?;
        self.write_cached_commit(source, &selector, resolution.commit())?;
        Ok(published)
    }

    fn discover_remote_versions(
        &self,
        source: &GitSourceIdentity,
        remote: &str,
        tag_prefix: Option<&GitTagPrefix>,
    ) -> SourceResult<GitVersionCatalog> {
        let parent = self.checkout_parent();
        fs::create_dir_all(&parent)
            .map_err(|error| internal("could not create Git cache directory", error))?;
        let prefix = version_staging_prefix(source);
        clean_abandoned_staging(&parent, &prefix)?;
        let staging = Builder::new()
            .prefix(&prefix)
            .tempdir_in(&parent)
            .map_err(|error| internal("could not create Git version staging directory", error))?;
        let repository = staging.path().join("repository.git");
        self.run(
            &[
                "init",
                "--bare",
                "--quiet",
                repository.to_string_lossy().as_ref(),
            ],
            source,
        )?;
        self.run_in(
            &repository,
            [
                "-c",
                "fetch.recurseSubmodules=false",
                "-c",
                "submodule.recurse=false",
                "fetch",
                "--quiet",
                "--no-tags",
                remote,
                "+refs/tags/*:refs/tags/*",
            ],
            source,
        )?;
        let mut tags = self
            .output_in(&repository, ["tag", "--list"], source)?
            .lines()
            .map(str::to_owned)
            .collect::<Vec<_>>();
        tags.sort_unstable();
        let mut versions = BTreeMap::new();
        for tag in tags {
            let Some(version) = version_from_tag(&tag, tag_prefix) else {
                continue;
            };
            GitReference::Tag(tag.clone()).validate().map_err(|_| {
                source_error(
                    source.as_str(),
                    "Git returned an unsafe version tag",
                    "remove the unsafe tag from the repository and retry",
                )
            })?;
            let reference = format!("refs/tags/{tag}^{{commit}}");
            let commit = self
                .output_in(&repository, ["rev-parse", "--verify", &reference], source)
                .map_err(|_| {
                    source_error(
                        source.as_str(),
                        "a semantic-version Git tag does not resolve to a commit",
                        "retag the version at a commit and retry",
                    )
                })?;
            let commit = commit.trim();
            GitReference::Rev(commit.to_owned())
                .validate()
                .map_err(|_| {
                    source_error(
                        source.as_str(),
                        "Git version tag did not resolve to a complete commit",
                        "retag the version at a complete commit and retry",
                    )
                })?;
            insert_version(&mut versions, version, commit, source)?;
        }
        Ok(GitVersionCatalog { versions })
    }

    fn publish_checkout(
        &self,
        staged: &Path,
        final_path: &Path,
        resolution: &GitResolution,
    ) -> SourceResult<GitCheckout> {
        if let Some(parent) = final_path.parent() {
            fs::create_dir_all(parent).map_err(|error| {
                internal("could not create Git checkout cache directory", error)
            })?;
        }
        match fs::rename(staged, final_path) {
            Ok(()) => self.verified_checkout(&resolution.source, resolution.commit()),
            Err(_) if final_path.exists() => {
                self.verified_checkout(&resolution.source, resolution.commit())
            }
            Err(error) => Err(internal(
                "could not publish Git checkout cache entry",
                error,
            )),
        }
    }

    fn verified_checkout(
        &self,
        source: &GitSourceIdentity,
        commit: &str,
    ) -> SourceResult<GitCheckout> {
        let root = self.checkout_path(source, commit);
        if !root.is_dir() {
            return Err(source_error(
                source.as_str(),
                "Git checkout is not cached",
                "fetch the source without --offline",
            ));
        }
        let head = self.output_in(&root, ["rev-parse", "--verify", "HEAD^{commit}"], source)?;
        if head.trim() != commit {
            return Err(source_error(
                source.as_str(),
                "Git checkout commit did not match its cache identity",
                "remove the corrupt checkout and fetch again",
            ));
        }
        let status = self.output_in(
            &root,
            ["status", "--porcelain", "--untracked-files=all"],
            source,
        )?;
        if !status.is_empty() {
            return Err(source_error(
                source.as_str(),
                "Git checkout cache entry is modified",
                "remove the corrupt checkout and fetch again",
            ));
        }
        Ok(GitCheckout {
            root,
            resolution: resolution(source.clone(), commit)?,
        })
    }

    fn cached_commit(
        &self,
        source: &GitSourceIdentity,
        selector: &str,
    ) -> SourceResult<Option<String>> {
        let path = self.selector_path(source, selector);
        let input = match fs::read_to_string(&path) {
            Ok(input) => input,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(error) => return Err(internal("could not read Git cache metadata", error)),
        };
        let commit = input
            .strip_suffix('\n')
            .ok_or_else(|| internal("Git cache metadata is invalid", "missing newline"))?;
        GitReference::Rev(commit.to_owned())
            .validate()
            .map_err(|_| internal("Git cache metadata is invalid", "invalid commit"))?;
        Ok(Some(commit.to_owned()))
    }

    fn write_cached_commit(
        &self,
        source: &GitSourceIdentity,
        selector: &str,
        commit: &str,
    ) -> SourceResult<()> {
        let path = self.selector_path(source, selector);
        let parent = path
            .parent()
            .ok_or_else(|| internal("Git metadata path has no parent", "invalid cache layout"))?;
        fs::create_dir_all(parent)
            .map_err(|error| internal("could not create Git cache metadata directory", error))?;
        let temporary = parent.join(format!(".{}.tmp", digest(&[selector, commit])));
        fs::write(&temporary, format!("{commit}\n"))
            .map_err(|error| internal("could not stage Git cache metadata", error))?;
        fs::rename(&temporary, path)
            .map_err(|error| internal("could not publish Git cache metadata", error))
    }

    fn cached_versions(
        &self,
        source: &GitSourceIdentity,
        tag_prefix: Option<&GitTagPrefix>,
    ) -> SourceResult<Option<GitVersionCatalog>> {
        let path = self.version_catalog_path(source, tag_prefix);
        let input = match fs::read_to_string(&path) {
            Ok(input) => input,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(error) => return Err(internal("could not read Git version cache metadata", error)),
        };
        let input = input
            .strip_suffix('\n')
            .ok_or_else(|| metadata_error(source, "Git version cache metadata is invalid"))?;
        let mut lines = input.lines();
        if lines.next() != Some("wukong-git-versions-v1") {
            return Err(metadata_error(
                source,
                "Git version cache metadata has an unsupported schema",
            ));
        }
        let mut versions = BTreeMap::new();
        for line in lines {
            let (version, commit) = line
                .split_once(' ')
                .ok_or_else(|| metadata_error(source, "Git version cache metadata is invalid"))?;
            if version.is_empty() || commit.is_empty() || commit.contains(' ') {
                return Err(metadata_error(
                    source,
                    "Git version cache metadata is invalid",
                ));
            }
            let version = SemanticVersion::parse(version)
                .map_err(|_| metadata_error(source, "Git version cache metadata is invalid"))?
                .without_build_metadata();
            GitReference::Rev(commit.to_owned())
                .validate()
                .map_err(|_| metadata_error(source, "Git version cache metadata is invalid"))?;
            if versions.insert(version, commit.to_owned()).is_some() {
                return Err(metadata_error(
                    source,
                    "Git version cache metadata is ambiguous",
                ));
            }
        }
        Ok(Some(GitVersionCatalog { versions }))
    }

    fn write_cached_versions(
        &self,
        source: &GitSourceIdentity,
        tag_prefix: Option<&GitTagPrefix>,
        catalog: &GitVersionCatalog,
    ) -> SourceResult<()> {
        let path = self.version_catalog_path(source, tag_prefix);
        let parent = path.parent().ok_or_else(|| {
            internal(
                "Git version metadata path has no parent",
                "invalid cache layout",
            )
        })?;
        fs::create_dir_all(parent).map_err(|error| {
            internal(
                "could not create Git version cache metadata directory",
                error,
            )
        })?;
        let mut output = String::from("wukong-git-versions-v1\n");
        for (version, commit) in catalog.versions() {
            output.push_str(&format!("{version} {commit}\n"));
        }
        let temporary = parent.join(format!(
            ".{}.tmp",
            digest(&[source.as_str(), tag_prefix.map_or("", GitTagPrefix::as_str)])
        ));
        fs::write(&temporary, output)
            .map_err(|error| internal("could not stage Git version cache metadata", error))?;
        if path.exists() {
            fs::remove_file(&path)
                .map_err(|error| internal("could not replace Git version cache metadata", error))?;
        }
        fs::rename(&temporary, path)
            .map_err(|error| internal("could not publish Git version cache metadata", error))
    }

    fn checkout_parent(&self) -> PathBuf {
        self.cache.checkouts().join("git").join("sha256")
    }
    fn checkout_path(&self, source: &GitSourceIdentity, commit: &str) -> PathBuf {
        self.checkout_parent()
            .join(digest(&[source.as_str(), commit]))
    }
    fn selector_path(&self, source: &GitSourceIdentity, selector: &str) -> PathBuf {
        self.cache
            .metadata()
            .join("git")
            .join("sha256")
            .join(digest(&[source.as_str(), selector]))
    }
    fn version_catalog_path(
        &self,
        source: &GitSourceIdentity,
        tag_prefix: Option<&GitTagPrefix>,
    ) -> PathBuf {
        self.cache
            .metadata()
            .join("git-versions")
            .join("sha256")
            .join(digest(&[
                source.as_str(),
                tag_prefix.map_or("", GitTagPrefix::as_str),
            ]))
    }
    fn lock_path(&self, source: &GitSourceIdentity) -> PathBuf {
        self.cache
            .locks()
            .join("git")
            .join(format!("{}.lock", digest(&[source.as_str()])))
    }

    fn run(&self, arguments: &[&str], source: &GitSourceIdentity) -> SourceResult<()> {
        let output = Command::new(&self.executable)
            .args(arguments)
            .output()
            .map_err(|error| source_error(source.as_str(), "could not start Git", error))?;
        if output.status.success() {
            Ok(())
        } else {
            Err(source_error(
                source.as_str(),
                "Git command failed",
                "check the repository and Git configuration",
            ))
        }
    }
    fn run_in<const N: usize>(
        &self,
        directory: &Path,
        arguments: [&str; N],
        source: &GitSourceIdentity,
    ) -> SourceResult<()> {
        let output = Command::new(&self.executable)
            .current_dir(directory)
            .args(arguments)
            .output()
            .map_err(|error| source_error(source.as_str(), "could not start Git", error))?;
        if output.status.success() {
            Ok(())
        } else {
            Err(source_error(
                source.as_str(),
                "Git command failed",
                "check the repository and Git configuration",
            ))
        }
    }
    fn output_in<const N: usize>(
        &self,
        directory: &Path,
        arguments: [&str; N],
        source: &GitSourceIdentity,
    ) -> SourceResult<String> {
        let output = Command::new(&self.executable)
            .current_dir(directory)
            .args(arguments)
            .output()
            .map_err(|error| source_error(source.as_str(), "could not start Git", error))?;
        if !output.status.success() {
            return Err(source_error(
                source.as_str(),
                "Git command failed",
                "check the repository and Git configuration",
            ));
        }
        String::from_utf8(output.stdout)
            .map_err(|error| internal("Git returned non-UTF-8 output", error))
    }
}

struct CacheLock(File);
impl CacheLock {
    fn acquire(path: &Path) -> SourceResult<Self> {
        let parent = path
            .parent()
            .ok_or_else(|| internal("Git lock path has no parent", "invalid cache layout"))?;
        fs::create_dir_all(parent)
            .map_err(|error| internal("could not create Git lock directory", error))?;
        let file = OpenOptions::new()
            .create(true)
            .read(true)
            .truncate(false)
            .write(true)
            .open(path)
            .map_err(|error| internal("could not open Git cache lock", error))?;
        file.lock_exclusive()
            .map_err(|error| internal("could not acquire Git cache lock", error))?;
        Ok(Self(file))
    }
}
impl Drop for CacheLock {
    fn drop(&mut self) {
        let _ = FileExt::unlock(&self.0);
    }
}

fn selector(reference: Option<&GitReference>) -> String {
    match reference {
        None => "head".to_owned(),
        Some(GitReference::Rev(value)) => format!("rev:{value}"),
        Some(GitReference::Tag(value)) => format!("tag:{value}"),
        Some(GitReference::Branch(value)) => format!("branch:{value}"),
    }
}
fn fetch_spec(reference: Option<&GitReference>) -> String {
    match reference {
        None => "HEAD".to_owned(),
        Some(GitReference::Rev(value)) => value.clone(),
        Some(GitReference::Tag(value)) => format!("refs/tags/{value}"),
        Some(GitReference::Branch(value)) => format!("refs/heads/{value}"),
    }
}
fn resolution(source: GitSourceIdentity, commit: &str) -> SourceResult<GitResolution> {
    Ok(GitResolution {
        source,
        commit: commit.to_owned(),
        immutable_id: ImmutableSourceId::new(format!("git:{commit}"))
            .map_err(|error| internal("could not create Git immutable identity", error))?,
    })
}
fn version_from_tag(tag: &str, tag_prefix: Option<&GitTagPrefix>) -> Option<SemanticVersion> {
    let version = match tag_prefix {
        Some(prefix) => tag.strip_prefix(prefix.as_str())?,
        None => tag,
    };
    SemanticVersion::parse(version)
        .ok()
        .map(|version| version.without_build_metadata())
}
fn insert_version(
    versions: &mut BTreeMap<SemanticVersion, String>,
    version: SemanticVersion,
    commit: &str,
    source: &GitSourceIdentity,
) -> SourceResult<()> {
    match versions.get(&version) {
        Some(existing) if existing != commit => Err(source_error(
            source.as_str(),
            "Git tags map one semantic version to different commits",
            "remove or retag the conflicting version tags and retry",
        )),
        Some(_) => Ok(()),
        None => {
            versions.insert(version, commit.to_owned());
            Ok(())
        }
    }
}
fn digest(parts: &[&str]) -> String {
    let mut hasher = Sha256::new();
    for part in parts {
        hasher.update((part.len() as u64).to_be_bytes());
        hasher.update(part.as_bytes());
    }
    format!("{:x}", hasher.finalize())
}
fn staging_prefix(source: &GitSourceIdentity) -> String {
    format!(".wukong-git-{}-", digest(&[source.as_str()]))
}
fn version_staging_prefix(source: &GitSourceIdentity) -> String {
    format!(".wukong-git-versions-{}-", digest(&[source.as_str()]))
}
fn clean_abandoned_staging(parent: &Path, prefix: &str) -> SourceResult<()> {
    let entries = fs::read_dir(parent)
        .map_err(|error| internal("could not inspect Git fetch staging directory", error))?;
    for entry in entries {
        let entry =
            entry.map_err(|error| internal("could not inspect Git fetch staging entry", error))?;
        if !entry.file_name().to_string_lossy().starts_with(prefix) {
            continue;
        }
        let metadata = entry
            .file_type()
            .map_err(|error| internal("could not inspect Git fetch staging entry", error))?;
        if metadata.is_dir() {
            fs::remove_dir_all(entry.path()).map_err(|error| {
                internal("could not remove interrupted Git fetch staging", error)
            })?;
        }
    }
    Ok(())
}
fn source_error(
    source: &str,
    message: impl AsRef<str>,
    recovery: impl std::fmt::Display,
) -> Box<Diagnostic> {
    Box::new(
        Diagnostic::new(ErrorCode::SourceAccess, message)
            .with_source(source)
            .with_recovery(recovery.to_string()),
    )
}
fn metadata_error(source: &GitSourceIdentity, message: &str) -> Box<Diagnostic> {
    Box::new(
        Diagnostic::new(ErrorCode::IntegrityFailure, message)
            .with_source(source.as_str())
            .with_recovery("remove the Git version metadata cache and retry"),
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
    use super::{GitFetcher, GitSourceIdentity, GitTagPrefix};
    use crate::{
        cache::CacheLayout, diagnostic::ErrorCode, git_source::GitSourceRequest,
        manifest::GitReference, semantic_version::SemanticVersion,
    };
    use std::{collections::BTreeMap, fs, path::Path, process::Command, thread};
    use tempfile::TempDir;

    #[test]
    fn invariant_git_fetch_publishes_a_clean_immutable_checkout_and_supports_offline_reuse() {
        let fixture = Fixture::new();
        let source = GitSourceIdentity::new("https://fixture.test/addon.git".to_owned());
        let reference = GitReference::Branch("main".to_owned());
        let first = fixture
            .fetcher()
            .fetch_remote(&source, Some(&reference), fixture.remote(), false)
            .expect("fetch should work");
        fs::remove_dir_all(fixture.remote()).expect("remote should remove");
        let second = fixture
            .fetcher()
            .fetch_remote(&source, Some(&reference), fixture.remote(), true)
            .expect("offline cache reuse should work");

        assert_eq!(first.resolution().commit(), second.resolution().commit());
        assert_eq!(
            fs::read_to_string(first.root().join("plugin.gd")).expect("file should exist"),
            "fixture"
        );
    }

    #[test]
    fn invariant_failed_git_fetch_never_publishes_a_checkout() {
        let fixture = Fixture::new();
        let source = GitSourceIdentity::new("https://fixture.test/missing.git".to_owned());
        let missing = GitReference::Branch("missing".to_owned());

        assert!(
            fixture
                .fetcher()
                .fetch_remote(&source, Some(&missing), fixture.remote(), false)
                .is_err()
        );
        assert!(
            fs::read_dir(fixture.path().join("cache/v1/checkouts/git/sha256"))
                .expect("cache checkout directory should exist")
                .next()
                .is_none()
        );
    }

    #[test]
    fn invariant_concurrent_git_fetches_share_one_verified_checkout() {
        let fixture = Fixture::new();
        let source = GitSourceIdentity::new("https://fixture.test/concurrent.git".to_owned());
        let reference = GitReference::Branch("main".to_owned());
        let remote = fixture.remote().to_owned();
        let remote_second = remote.clone();
        let first = fixture.fetcher();
        let second = fixture.fetcher();
        let first_source = source.clone();
        let first_reference = reference.clone();

        let first = thread::spawn(move || {
            first
                .fetch_remote(&first_source, Some(&first_reference), &remote, false)
                .expect("first fetch should work")
        });
        let second = thread::spawn(move || {
            second
                .fetch_remote(&source, Some(&reference), &remote_second, false)
                .expect("second fetch should work")
        });
        let first = first.join().expect("first thread should join");
        let second = second.join().expect("second thread should join");

        assert_eq!(first.root(), second.root());
        assert_eq!(first.resolution(), second.resolution());
    }

    #[test]
    fn invariant_git_tags_and_exact_revisions_resolve_to_the_same_complete_commit() {
        let fixture = Fixture::new();
        let source = GitSourceIdentity::new("https://fixture.test/tagged.git".to_owned());
        let tag = GitReference::Tag("v1.0.0".to_owned());
        let tagged = fixture
            .fetcher()
            .fetch_remote(&source, Some(&tag), fixture.remote(), false)
            .expect("tag fetch should work");
        let revision = GitReference::Rev(tagged.resolution().commit().to_owned());
        let exact = fixture
            .fetcher()
            .fetch_remote(&source, Some(&revision), fixture.remote(), false)
            .expect("exact revision fetch should work");

        assert_eq!(tagged.resolution(), exact.resolution());
    }

    #[test]
    fn invariant_git_version_tags_map_to_commits_and_reuse_verified_metadata_offline() {
        let fixture = Fixture::new();
        let first = fixture.commit();
        fixture.commit_change("second");
        let second = fixture.commit();
        fixture.annotated_tag("v1.1.0");
        fixture.lightweight_tag("not-a-version");
        fixture.push();

        let source = GitSourceIdentity::new("https://fixture.test/versioned.git".to_owned());
        let prefix = GitTagPrefix::parse("v").expect("prefix should parse");
        let fetcher = fixture.fetcher();
        let catalog = fetcher
            .discover_remote_versions(&source, fixture.remote(), Some(&prefix))
            .expect("version tags should resolve");
        assert_eq!(
            catalog.versions(),
            &BTreeMap::from([
                (
                    SemanticVersion::parse("1.0.0").expect("version should parse"),
                    first
                ),
                (
                    SemanticVersion::parse("1.1.0").expect("version should parse"),
                    second
                ),
            ])
        );

        fetcher
            .write_cached_versions(&source, Some(&prefix), &catalog)
            .expect("catalog should cache");
        let metadata = fetcher.version_catalog_path(&source, Some(&prefix));
        let persisted = fs::read_to_string(&metadata).expect("metadata should read");
        assert!(!persisted.contains(fixture.remote()));
        assert!(!persisted.contains(source.as_str()));
        fs::remove_dir_all(fixture.remote()).expect("remote should remove");
        assert_eq!(
            fetcher
                .cached_versions(&source, Some(&prefix))
                .expect("offline catalog should verify"),
            Some(catalog)
        );
    }

    #[test]
    fn invariant_git_version_discovery_applies_the_configured_prefix_exactly() {
        let fixture = Fixture::new();
        fixture.commit_change("plain");
        let plain = fixture.commit();
        fixture.lightweight_tag("1.1.0");
        fixture.push();

        let source = GitSourceIdentity::new("https://fixture.test/prefix.git".to_owned());
        let fetcher = fixture.fetcher();
        let prefixed = fetcher
            .discover_remote_versions(
                &source,
                fixture.remote(),
                Some(&GitTagPrefix::parse("v").expect("prefix should parse")),
            )
            .expect("prefixed discovery should work");
        assert_eq!(prefixed.versions().len(), 1);
        assert!(
            prefixed
                .commit(&SemanticVersion::parse("1.0.0").expect("version should parse"))
                .is_some()
        );

        let plain_catalog = fetcher
            .discover_remote_versions(&source, fixture.remote(), None)
            .expect("plain discovery should work");
        assert_eq!(
            plain_catalog.versions(),
            &BTreeMap::from([(
                SemanticVersion::parse("1.1.0").expect("version should parse"),
                plain,
            )])
        );
        assert!(GitTagPrefix::parse("").is_err());
    }

    #[test]
    fn invariant_conflicting_git_tags_for_one_semantic_version_fail_before_caching() {
        let fixture = Fixture::new();
        fixture.commit_change("conflicting");
        fixture.annotated_tag("v1.0.0+build");
        fixture.push();

        let source = GitSourceIdentity::new("https://fixture.test/conflict.git".to_owned());
        let fetcher = fixture.fetcher();
        let error = fetcher
            .discover_remote_versions(
                &source,
                fixture.remote(),
                Some(&GitTagPrefix::parse("v").expect("prefix should parse")),
            )
            .expect_err("different commits for one version should fail");
        assert_eq!(error.code(), ErrorCode::SourceAccess);
        assert!(error.message().contains("different commits"));
        assert!(
            !fetcher
                .version_catalog_path(
                    &source,
                    Some(&GitTagPrefix::parse("v").expect("prefix should parse")),
                )
                .exists()
        );
    }

    #[test]
    fn invariant_corrupt_git_version_metadata_is_rejected_offline() {
        let fixture = Fixture::new();
        let source = GitSourceIdentity::new("https://fixture.test/corrupt.git".to_owned());
        let fetcher = fixture.fetcher();
        let path = fetcher.version_catalog_path(&source, None);
        fs::create_dir_all(path.parent().expect("metadata parent should exist"))
            .expect("metadata parent should create");
        fs::write(path, "wukong-git-versions-v1\n1.0.0 invalid\n").expect("metadata should write");

        let error = fetcher
            .cached_versions(&source, None)
            .expect_err("corrupt metadata should not be used");
        assert_eq!(error.code(), ErrorCode::IntegrityFailure);
    }

    #[test]
    fn invariant_interrupted_git_fetch_staging_is_removed_before_retry() {
        let fixture = Fixture::new();
        let source = GitSourceIdentity::new("https://fixture.test/interrupted.git".to_owned());
        let reference = GitReference::Branch("main".to_owned());
        let fetcher = fixture.fetcher();
        let abandoned = fetcher
            .checkout_parent()
            .join(format!("{}abandoned", super::staging_prefix(&source)));
        fs::create_dir_all(&abandoned).expect("abandoned staging should create");

        fetcher
            .fetch_remote(&source, Some(&reference), fixture.remote(), false)
            .expect("retry should work");

        assert!(!abandoned.exists());
    }

    #[test]
    #[ignore = "requires network access to a public pinned Git repository"]
    fn invariant_public_https_repository_fetches_an_exact_commit() {
        let fixture = TempDir::new().expect("fixture should exist");
        let fetcher = GitFetcher::new(
            CacheLayout::for_root(fixture.path().join("cache")).expect("cache should work"),
        );
        let request = GitSourceRequest::new(
            "https://github.com/Goutte/godot-addon-animated-shape-2d.git".to_owned(),
            Some(GitReference::Rev(
                "4ab90a80b815bc1ad4a8d7eea92c785e654bfd91".to_owned(),
            )),
        );

        let checkout = fetcher
            .fetch(&request, false)
            .expect("public fetch should work");

        assert_eq!(
            checkout.resolution().commit(),
            "4ab90a80b815bc1ad4a8d7eea92c785e654bfd91"
        );
    }

    struct Fixture {
        directory: TempDir,
        remote: std::path::PathBuf,
        work: std::path::PathBuf,
    }
    impl Fixture {
        fn new() -> Self {
            let directory = TempDir::new().expect("fixture should exist");
            let remote = directory.path().join("remote.git");
            let work = directory.path().join("work");
            git(
                directory.path(),
                [
                    "init",
                    "--quiet",
                    "--bare",
                    remote.to_string_lossy().as_ref(),
                ],
            );
            git(
                directory.path(),
                ["init", "--quiet", work.to_string_lossy().as_ref()],
            );
            git(&work, ["config", "user.email", "fixture@example.test"]);
            git(&work, ["config", "user.name", "fixture"]);
            fs::write(work.join("plugin.gd"), "fixture").expect("file should write");
            git(&work, ["add", "plugin.gd"]);
            git(&work, ["commit", "--quiet", "-m", "fixture"]);
            git(&work, ["branch", "-M", "main"]);
            git(&work, ["tag", "v1.0.0"]);
            git(
                &work,
                ["remote", "add", "origin", remote.to_string_lossy().as_ref()],
            );
            git(&work, ["push", "--quiet", "origin", "main", "--tags"]);
            Self {
                directory,
                remote,
                work,
            }
        }
        fn path(&self) -> &Path {
            self.directory.path()
        }
        fn remote(&self) -> &str {
            self.remote.to_str().expect("remote should be UTF-8")
        }
        fn fetcher(&self) -> GitFetcher {
            GitFetcher::new(
                CacheLayout::for_root(self.path().join("cache")).expect("cache should work"),
            )
        }
        fn commit(&self) -> String {
            git_output(&self.work, &["rev-parse", "--verify", "HEAD^{commit}"])
                .trim()
                .to_owned()
        }
        fn commit_change(&self, content: &str) {
            fs::write(self.work.join("plugin.gd"), content).expect("file should write");
            git(&self.work, ["add", "plugin.gd"]);
            git(&self.work, ["commit", "--quiet", "-m", content]);
        }
        fn lightweight_tag(&self, tag: &str) {
            git_dynamic(&self.work, &["tag", tag]);
        }
        fn annotated_tag(&self, tag: &str) {
            git_dynamic(&self.work, &["tag", "--annotate", tag, "--message", tag]);
        }
        fn push(&self) {
            git(&self.work, ["push", "--quiet", "origin", "main", "--tags"]);
        }
    }
    fn git<const N: usize>(directory: &Path, arguments: [&str; N]) {
        git_dynamic(directory, &arguments);
    }
    fn git_dynamic(directory: &Path, arguments: &[&str]) {
        assert!(
            Command::new("git")
                .current_dir(directory)
                .args(arguments)
                .status()
                .expect("git should start")
                .success()
        );
    }
    fn git_output(directory: &Path, arguments: &[&str]) -> String {
        let output = Command::new("git")
            .current_dir(directory)
            .args(arguments)
            .output()
            .expect("git should start");
        assert!(output.status.success());
        String::from_utf8(output.stdout).expect("Git output should be UTF-8")
    }
}
