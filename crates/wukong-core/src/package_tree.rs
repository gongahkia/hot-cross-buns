//! Deterministic preparation of portable package staging trees.

use crate::diagnostic::{Diagnostic, ErrorCode, Modification, RollbackStatus};
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeMap,
    ffi::OsStr,
    fs,
    io::{self, ErrorKind, Read, Write},
    path::{Path, PathBuf},
};
use unicode_normalization::UnicodeNormalization;

/// A regular file recorded in a prepared package tree.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PreparedPackageFile {
    path: PathBuf,
    executable: bool,
    sha256: String,
}

impl PreparedPackageFile {
    /// Returns the NFC-normalised path relative to the prepared tree root.
    #[must_use]
    pub fn path(&self) -> &Path {
        &self.path
    }

    /// Returns whether the canonical file has an executable bit.
    #[must_use]
    pub const fn executable(&self) -> bool {
        self.executable
    }

    /// Returns the lowercase hexadecimal SHA-256 of the copied file content.
    #[must_use]
    pub fn sha256(&self) -> &str {
        &self.sha256
    }
}

/// A verified package tree prepared in a staging directory.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PreparedPackageTree {
    root: PathBuf,
    sha256: String,
    files: Vec<PreparedPackageFile>,
}

impl PreparedPackageTree {
    /// Returns the staging directory containing canonical package content.
    #[must_use]
    pub fn root(&self) -> &Path {
        &self.root
    }

    /// Returns the lowercase hexadecimal SHA-256 tree hash.
    #[must_use]
    pub fn sha256(&self) -> &str {
        &self.sha256
    }

    /// Returns files in deterministic path order.
    #[must_use]
    pub fn files(&self) -> &[PreparedPackageFile] {
        &self.files
    }
}

/// Copies a selected package root into a new canonical staging directory.
///
/// `staging_root` must not exist and its parent must already exist. The caller
/// must supply the source root selected by package-layout detection; this
/// function intentionally does not infer a layout.
///
/// # Errors
///
/// Returns a diagnostic for unsafe source entries, portable-path collisions,
/// inaccessible source content, or staging I/O failure. A failed copy removes
/// the newly created staging tree.
pub fn prepare_package_tree(
    source_root: &Path,
    staging_root: &Path,
) -> Result<PreparedPackageTree, Box<Diagnostic>> {
    let source_root = canonical_source_root(source_root)?;
    let mut entries = scan_entries(&source_root, Path::new(""))?;
    entries.sort_by(|left, right| left.relative.cmp(&right.relative));
    reject_collisions(&entries)?;
    fs::create_dir(staging_root).map_err(|error| staging_error(staging_root, error))?;

    match copy_and_hash(&entries, staging_root) {
        Ok((sha256, files)) => Ok(PreparedPackageTree {
            root: staging_root.to_path_buf(),
            sha256,
            files,
        }),
        Err(error) => Err(clean_staging(staging_root, *error)),
    }
}

/// Scans and hashes a canonical package tree without copying it.
///
/// The returned tree references `source_root` directly. Callers must only use
/// it as a read-only source while the underlying directory remains stable.
///
/// # Errors
///
/// Returns a diagnostic for unsafe source entries, portable-path collisions,
/// inaccessible source content, or a source that changes during hashing.
pub fn inspect_package_tree(source_root: &Path) -> Result<PreparedPackageTree, Box<Diagnostic>> {
    let source_root = canonical_source_root(source_root)?;
    let mut entries = scan_entries(&source_root, Path::new(""))?;
    entries.sort_by(|left, right| left.relative.cmp(&right.relative));
    reject_collisions(&entries)?;
    let (sha256, files) = hash_entries(&entries)?;
    Ok(PreparedPackageTree {
        root: source_root,
        sha256,
        files,
    })
}

#[derive(Debug)]
struct SourceEntry {
    source: PathBuf,
    relative: String,
    kind: EntryKind,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum EntryKind {
    Directory,
    File { executable: bool },
}

fn canonical_source_root(source_root: &Path) -> Result<PathBuf, Box<Diagnostic>> {
    let canonical =
        fs::canonicalize(source_root).map_err(|error| source_error(source_root, error))?;
    let metadata = fs::metadata(&canonical).map_err(|error| source_error(&canonical, error))?;
    if metadata.is_dir() {
        Ok(canonical)
    } else {
        Err(Box::new(
            Diagnostic::new(
                ErrorCode::SourceAccess,
                format!(
                    "package source root {} is not a directory",
                    canonical.display()
                ),
            )
            .with_recovery("select an addon directory and retry"),
        ))
    }
}

fn scan_entries(
    directory: &Path,
    relative_directory: &Path,
) -> Result<Vec<SourceEntry>, Box<Diagnostic>> {
    let mut children = fs::read_dir(directory)
        .map_err(|error| source_error(directory, error))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| source_error(directory, error))?;
    children.sort_by_key(fs::DirEntry::file_name);

    let mut entries = Vec::new();
    for child in children {
        let name = child.file_name();
        if source_control_entry(&name) {
            continue;
        }
        let name = name.to_str().ok_or_else(|| invalid_name(&child.path()))?;
        let normalized = name.nfc().collect::<String>();
        let relative = relative_directory.join(normalized);
        let source = child.path();
        let metadata =
            fs::symlink_metadata(&source).map_err(|error| source_error(&source, error))?;
        let kind = if metadata.file_type().is_dir() {
            EntryKind::Directory
        } else if metadata.file_type().is_file() {
            EntryKind::File {
                executable: is_executable(&metadata),
            }
        } else if metadata.file_type().is_symlink() {
            return Err(Box::new(
                Diagnostic::new(
                    ErrorCode::SourceAccess,
                    format!(
                        "package source contains unsupported symlink {}",
                        source.display()
                    ),
                )
                .with_recovery("replace symlinks with regular files or directories"),
            ));
        } else {
            return Err(Box::new(
                Diagnostic::new(
                    ErrorCode::SourceAccess,
                    format!(
                        "package source contains unsupported entry {}",
                        source.display()
                    ),
                )
                .with_recovery("remove special filesystem entries from the package"),
            ));
        };
        entries.push(SourceEntry {
            source: source.clone(),
            relative: relative_string(&relative)?,
            kind,
        });
        if kind == EntryKind::Directory {
            entries.extend(scan_entries(&source, &relative)?);
        }
    }
    Ok(entries)
}

fn source_control_entry(name: &OsStr) -> bool {
    matches!(name.to_str(), Some(".git" | ".hg" | ".svn"))
}

fn relative_string(path: &Path) -> Result<String, Box<Diagnostic>> {
    let mut components = Vec::new();
    for component in path.components() {
        let std::path::Component::Normal(component) = component else {
            return Err(Box::new(
                Diagnostic::new(ErrorCode::InternalFailure, "prepared path is not relative")
                    .with_recovery("report this as a wukong bug"),
            ));
        };
        components.push(
            component
                .to_str()
                .ok_or_else(|| invalid_name(path))?
                .to_owned(),
        );
    }
    Ok(components.join("/"))
}

fn reject_collisions(entries: &[SourceEntry]) -> Result<(), Box<Diagnostic>> {
    if let Some((first, second)) = collision(entries.iter().map(|entry| entry.relative.as_str())) {
        return Err(Box::new(
            Diagnostic::new(
                ErrorCode::SourceAccess,
                format!("package source paths collide after normalisation: {first}, {second}"),
            )
            .with_recovery("rename one colliding path before installing"),
        ));
    }
    Ok(())
}

fn collision<'a>(paths: impl IntoIterator<Item = &'a str>) -> Option<(&'a str, &'a str)> {
    let mut seen = BTreeMap::new();
    for path in paths {
        let key = path.nfc().flat_map(char::to_lowercase).collect::<String>();
        if let Some(first) = seen.insert(key, path) {
            return Some((first, path));
        }
    }
    None
}

fn copy_and_hash(
    entries: &[SourceEntry],
    staging_root: &Path,
) -> Result<(String, Vec<PreparedPackageFile>), Box<Diagnostic>> {
    let mut files = Vec::new();
    let mut hasher = Sha256::new();
    for entry in entries {
        let destination = staging_root.join(&entry.relative);
        match entry.kind {
            EntryKind::Directory => {
                fs::create_dir(&destination).map_err(|error| staging_error(&destination, error))?;
                hash_directory(&mut hasher, &entry.relative);
            }
            EntryKind::File { executable } => {
                let sha256 = copy_file_and_hash(
                    &entry.source,
                    &destination,
                    executable,
                    &mut hasher,
                    &entry.relative,
                )?;
                files.push(PreparedPackageFile {
                    path: PathBuf::from(&entry.relative),
                    executable,
                    sha256,
                });
            }
        }
    }
    Ok((format!("{:x}", hasher.finalize()), files))
}

fn hash_entries(
    entries: &[SourceEntry],
) -> Result<(String, Vec<PreparedPackageFile>), Box<Diagnostic>> {
    let mut files = Vec::new();
    let mut hasher = Sha256::new();
    for entry in entries {
        match entry.kind {
            EntryKind::Directory => hash_directory(&mut hasher, &entry.relative),
            EntryKind::File { executable } => {
                let sha256 = hash_file(&entry.source, executable, &mut hasher, &entry.relative)?;
                files.push(PreparedPackageFile {
                    path: PathBuf::from(&entry.relative),
                    executable,
                    sha256,
                });
            }
        }
    }
    Ok((format!("{:x}", hasher.finalize()), files))
}

fn hash_file(
    source: &Path,
    executable: bool,
    tree_hasher: &mut Sha256,
    relative: &str,
) -> Result<String, Box<Diagnostic>> {
    let metadata = fs::symlink_metadata(source).map_err(|error| source_error(source, error))?;
    if !metadata.file_type().is_file() {
        return Err(changed_source_file(source));
    }
    let mut input = fs::File::open(source).map_err(|error| source_error(source, error))?;
    tree_hasher.update(b"f");
    update_length_prefixed(tree_hasher, relative.as_bytes());
    tree_hasher.update([u8::from(executable)]);
    tree_hasher.update(metadata.len().to_be_bytes());
    let mut file_hasher = Sha256::new();
    let mut buffer = vec![0_u8; 64 * 1024];
    let mut read_total = 0_u64;
    loop {
        let read = input
            .read(&mut buffer)
            .map_err(|error| source_error(source, error))?;
        if read == 0 {
            break;
        }
        tree_hasher.update(&buffer[..read]);
        file_hasher.update(&buffer[..read]);
        let read = u64::try_from(read)
            .map_err(|_| source_error(source, io::Error::other("buffer length should fit u64")))?;
        read_total = read_total
            .checked_add(read)
            .ok_or_else(|| source_error(source, io::Error::other("byte count overflow")))?;
    }
    let current = fs::symlink_metadata(source).map_err(|error| source_error(source, error))?;
    if !current.file_type().is_file()
        || current.len() != metadata.len()
        || read_total != metadata.len()
    {
        return Err(changed_source_file(source));
    }
    Ok(format!("{:x}", file_hasher.finalize()))
}

fn copy_file_and_hash(
    source: &Path,
    destination: &Path,
    executable: bool,
    tree_hasher: &mut Sha256,
    relative: &str,
) -> Result<String, Box<Diagnostic>> {
    let metadata = fs::symlink_metadata(source).map_err(|error| source_error(source, error))?;
    if !metadata.file_type().is_file() {
        return Err(changed_source_file(source));
    }
    let mut input = fs::File::open(source).map_err(|error| source_error(source, error))?;
    let mut output =
        fs::File::create(destination).map_err(|error| staging_error(destination, error))?;
    tree_hasher.update(b"f");
    update_length_prefixed(tree_hasher, relative.as_bytes());
    tree_hasher.update([u8::from(executable)]);
    tree_hasher.update(metadata.len().to_be_bytes());
    let mut file_hasher = Sha256::new();
    let mut buffer = vec![0_u8; 64 * 1024];
    let mut copied = 0_u64;
    loop {
        let read = input
            .read(&mut buffer)
            .map_err(|error| source_error(source, error))?;
        if read == 0 {
            break;
        }
        output
            .write_all(&buffer[..read])
            .map_err(|error| staging_error(destination, error))?;
        tree_hasher.update(&buffer[..read]);
        file_hasher.update(&buffer[..read]);
        let read = u64::try_from(read).map_err(|_| {
            staging_error(
                destination,
                io::Error::other("buffer length should fit u64"),
            )
        })?;
        copied = copied.checked_add(read).ok_or_else(|| {
            staging_error(destination, io::Error::other("copied byte count overflow"))
        })?;
    }
    if copied != metadata.len() {
        return Err(changed_source_file(source));
    }
    output
        .flush()
        .map_err(|error| staging_error(destination, error))?;
    #[cfg(unix)]
    set_canonical_permissions(destination, executable)?;
    #[cfg(not(unix))]
    let _ = executable;
    Ok(format!("{:x}", file_hasher.finalize()))
}

fn changed_source_file(source: &Path) -> Box<Diagnostic> {
    Box::new(
        Diagnostic::new(
            ErrorCode::SourceAccess,
            format!(
                "package source file changed while preparing {}",
                source.display()
            ),
        )
        .with_recovery("retry after source changes have finished"),
    )
}

fn hash_directory(hasher: &mut Sha256, relative: &str) {
    hash_record(hasher, b'd', relative, None, None);
}

fn hash_record(
    hasher: &mut Sha256,
    kind: u8,
    relative: &str,
    executable: Option<bool>,
    contents: Option<&[u8]>,
) {
    hasher.update([kind]);
    update_length_prefixed(hasher, relative.as_bytes());
    if let Some(executable) = executable {
        hasher.update([u8::from(executable)]);
    }
    update_length_prefixed(hasher, contents.unwrap_or_default());
}

fn update_length_prefixed(hasher: &mut Sha256, bytes: &[u8]) {
    hasher.update((bytes.len() as u64).to_be_bytes());
    hasher.update(bytes);
}

#[cfg(unix)]
fn is_executable(metadata: &fs::Metadata) -> bool {
    use std::os::unix::fs::PermissionsExt;

    metadata.permissions().mode() & 0o111 != 0
}

#[cfg(not(unix))]
fn is_executable(_metadata: &fs::Metadata) -> bool {
    false
}

#[cfg(unix)]
fn set_canonical_permissions(path: &Path, executable: bool) -> Result<(), Box<Diagnostic>> {
    use std::os::unix::fs::PermissionsExt;

    let mode = if executable { 0o755 } else { 0o644 };
    fs::set_permissions(path, fs::Permissions::from_mode(mode))
        .map_err(|error| staging_error(path, error))
}

fn clean_staging(staging_root: &Path, diagnostic: Diagnostic) -> Box<Diagnostic> {
    match fs::remove_dir_all(staging_root) {
        Ok(()) => Box::new(
            diagnostic
                .with_modification(Modification::Staged(staging_root.to_path_buf()))
                .with_rollback(RollbackStatus::Succeeded),
        ),
        Err(cleanup) => Box::new(
            diagnostic
                .with_cause(cleanup)
                .with_modification(Modification::Staged(staging_root.to_path_buf()))
                .with_rollback(RollbackStatus::Failed),
        ),
    }
}

fn source_error(path: &Path, error: io::Error) -> Box<Diagnostic> {
    let message = if error.kind() == ErrorKind::NotFound {
        format!("package source {} does not exist", path.display())
    } else {
        format!("could not read package source {}", path.display())
    };
    Box::new(
        Diagnostic::new(ErrorCode::SourceAccess, message)
            .with_cause(error)
            .with_recovery("check the package source path and retry"),
    )
}

fn staging_error(path: &Path, error: io::Error) -> Box<Diagnostic> {
    Box::new(
        Diagnostic::new(
            ErrorCode::InternalFailure,
            format!("could not prepare staging path {}", path.display()),
        )
        .with_cause(error)
        .with_recovery("check staging-directory permissions and retry"),
    )
}

fn invalid_name(path: &Path) -> Box<Diagnostic> {
    Box::new(
        Diagnostic::new(
            ErrorCode::SourceAccess,
            format!("package source path {} is not valid UTF-8", path.display()),
        )
        .with_recovery("use UTF-8 file names in package sources"),
    )
}

#[cfg(test)]
mod tests {
    use super::collision;

    #[test]
    fn invariant_case_collision_fixture_is_rejected() {
        assert_eq!(
            collision(["Addon.gd", "addon.gd"]),
            Some(("Addon.gd", "addon.gd"))
        );
    }

    #[test]
    fn invariant_unicode_normalisation_collision_fixture_is_rejected() {
        assert_eq!(
            collision(["caf\u{e9}.gd", "cafe\u{301}.gd"]),
            Some(("caf\u{e9}.gd", "cafe\u{301}.gd"))
        );
    }
}
