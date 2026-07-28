//! Deterministic desired-file ownership maps and pre-mutation conflict checks.

use crate::{
    diagnostic::{Diagnostic, ErrorCode},
    identity::PackageName,
    package_tree::PreparedPackageTree,
};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    io::Read,
    path::{Component, Path, PathBuf},
};
use unicode_normalization::UnicodeNormalization;

/// A canonical package tree selected for project materialisation.
#[derive(Clone, Copy, Debug)]
pub struct PackageMaterialization<'a> {
    name: &'a PackageName,
    tree: &'a PreparedPackageTree,
    target_path: &'a Path,
}
impl<'a> PackageMaterialization<'a> {
    /// Creates a package materialisation input.
    #[must_use]
    pub const fn new(
        name: &'a PackageName,
        tree: &'a PreparedPackageTree,
        target_path: &'a Path,
    ) -> Self {
        Self {
            name,
            tree,
            target_path,
        }
    }
}

/// One desired project file and every package sharing its exact content.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DesiredFile {
    path: PathBuf,
    source_path: PathBuf,
    owners: BTreeSet<PackageName>,
    sha256: String,
    executable: bool,
}
impl DesiredFile {
    /// Returns the project-relative target path.
    #[must_use]
    pub fn path(&self) -> &Path {
        &self.path
    }
    /// Returns the canonical source file used for materialisation.
    #[must_use]
    pub fn source_path(&self) -> &Path {
        &self.source_path
    }
    /// Returns all packages with identical claims on this file.
    #[must_use]
    pub fn owners(&self) -> &BTreeSet<PackageName> {
        &self.owners
    }
    /// Returns the content checksum.
    #[must_use]
    pub fn sha256(&self) -> &str {
        &self.sha256
    }
    /// Returns whether the canonical file is executable.
    #[must_use]
    pub const fn executable(&self) -> bool {
        self.executable
    }
}

/// All desired project files in deterministic portable-path order.
#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct DesiredFileMap {
    files: BTreeMap<PathBuf, DesiredFile>,
}
impl DesiredFileMap {
    /// Returns desired files in canonical project-relative path order.
    #[must_use]
    pub fn files(&self) -> &BTreeMap<PathBuf, DesiredFile> {
        &self.files
    }
}

/// Builds a desired map, rejecting incompatible exact or portable-path claims.
///
/// Exact claims with matching checksums and executable bits share one desired
/// file and retain every owner. No project path is modified.
///
/// # Errors
///
/// Returns a diagnostic for unsafe target paths, unreadable trees, or conflicts.
pub fn build_desired_file_map<'a>(
    packages: impl IntoIterator<Item = PackageMaterialization<'a>>,
) -> Result<DesiredFileMap, Box<Diagnostic>> {
    let mut files = BTreeMap::new();
    let mut portable_paths = BTreeMap::<String, PathBuf>::new();
    for package in packages {
        let target_root = safe_target_path(package.target_path)?;
        for file in package.tree.files() {
            let path = target_root.join(file.path());
            let portable = portable_path_key(&path)?;
            if let Some(first) = portable_paths.insert(portable, path.clone()) {
                if first != path {
                    return Err(conflict(
                        "package paths collide on a case-insensitive filesystem",
                        &first,
                        &path,
                    ));
                }
            }
            let source_path = package.tree.root().join(file.path());
            let sha256 = file_sha256(&source_path)?;
            let candidate = DesiredFile {
                path: path.clone(),
                source_path,
                owners: BTreeSet::from([package.name.clone()]),
                sha256,
                executable: file.executable(),
            };
            match files.get_mut(&path) {
                None => {
                    files.insert(path, candidate);
                }
                Some(existing)
                    if existing.sha256 == candidate.sha256
                        && existing.executable == candidate.executable =>
                {
                    existing.owners.insert(package.name.clone());
                }
                Some(existing) => {
                    return Err(Box::new(
                        Diagnostic::new(
                            ErrorCode::UserInput,
                            format!(
                                "package files claim {} with incompatible content: {} conflicts with {}",
                                existing.path.display(),
                                owners(&existing.owners),
                                package.name.as_str(),
                            ),
                        )
                        .with_recovery(
                            "configure distinct target paths or remove one conflicting package",
                        ),
                    ));
                }
            }
        }
    }
    Ok(DesiredFileMap { files })
}

/// Refuses desired paths already occupied by files not proven Wukong-owned.
///
/// # Errors
///
/// Returns a diagnostic before mutation when an unowned project path conflicts.
pub fn validate_project_file_conflicts(
    project_root: &Path,
    desired: &DesiredFileMap,
    previously_owned: &BTreeSet<PathBuf>,
) -> Result<(), Box<Diagnostic>> {
    for path in desired.files.keys() {
        let destination = project_root.join(path);
        if fs::symlink_metadata(&destination).is_ok() && !previously_owned.contains(path) {
            return Err(Box::new(
                Diagnostic::new(
                    ErrorCode::UserInput,
                    format!(
                        "project-owned file conflicts with package target {}",
                        path.display()
                    ),
                )
                .with_recovery("move the project file or configure a different package target"),
            ));
        }
        let mut ancestor = destination.parent();
        while let Some(path) = ancestor {
            if path == project_root {
                break;
            }
            if let Ok(metadata) = fs::symlink_metadata(path) {
                if !metadata.file_type().is_dir() {
                    return Err(Box::new(
                        Diagnostic::new(
                            ErrorCode::UserInput,
                            format!(
                                "project path ancestor {} is not a directory",
                                path.display()
                            ),
                        )
                        .with_recovery("move the conflicting project file before synchronising"),
                    ));
                }
            }
            ancestor = path.parent();
        }
    }
    Ok(())
}

fn safe_target_path(value: &Path) -> Result<PathBuf, Box<Diagnostic>> {
    let mut target = PathBuf::new();
    for component in value.components() {
        match component {
            Component::Normal(component) => target.push(component),
            Component::CurDir
            | Component::ParentDir
            | Component::RootDir
            | Component::Prefix(_) => {
                return Err(Box::new(
                    Diagnostic::new(ErrorCode::UserInput, "package target path must be relative")
                        .with_recovery("use a safe path below the project root"),
                ));
            }
        }
    }
    if target.as_os_str().is_empty() {
        Err(Box::new(
            Diagnostic::new(
                ErrorCode::UserInput,
                "package target path must not be empty",
            )
            .with_recovery("use a safe path below the project root"),
        ))
    } else {
        Ok(target)
    }
}

fn portable_path_key(path: &Path) -> Result<String, Box<Diagnostic>> {
    let value = path.to_str().ok_or_else(|| {
        Box::new(
            Diagnostic::new(
                ErrorCode::UserInput,
                "package target path is not valid Unicode",
            )
            .with_recovery("use portable Unicode package paths"),
        )
    })?;
    Ok(value.nfc().flat_map(char::to_lowercase).collect())
}

fn file_sha256(path: &Path) -> Result<String, Box<Diagnostic>> {
    let mut file = fs::File::open(path).map_err(|error| source_error(path, error))?;
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 8192];
    loop {
        let read = file
            .read(&mut buffer)
            .map_err(|error| source_error(path, error))?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

fn conflict(message: &str, first: &Path, second: &Path) -> Box<Diagnostic> {
    Box::new(
        Diagnostic::new(
            ErrorCode::UserInput,
            format!("{message}: {} and {}", first.display(), second.display()),
        )
        .with_recovery("configure distinct target paths or remove one conflicting package"),
    )
}

fn source_error(path: &Path, error: std::io::Error) -> Box<Diagnostic> {
    Box::new(
        Diagnostic::new(
            ErrorCode::SourceAccess,
            format!("could not read prepared package file {}", path.display()),
        )
        .with_cause(error)
        .with_recovery("restore the prepared package and retry"),
    )
}

fn owners(owners: &BTreeSet<PackageName>) -> String {
    owners
        .iter()
        .map(PackageName::as_str)
        .collect::<Vec<_>>()
        .join(", ")
}
