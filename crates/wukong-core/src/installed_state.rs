//! Deterministic installed-package ownership metadata.

use crate::{
    diagnostic::{Diagnostic, ErrorCode},
    identity::PackageName,
    source::ImmutableSourceId,
};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    io::Read,
    path::{Component, Path, PathBuf},
};
use toml_edit::{Document, Item, TableLike};

/// The directory containing Wukong-managed project metadata.
pub const STATE_DIRECTORY_NAME: &str = ".wukong";
/// The installed-state metadata filename.
pub const STATE_FILE_NAME: &str = "state.toml";
/// The supported installed-state schema.
pub const STATE_SCHEMA: i64 = 1;

/// A dependency group selected for materialisation.
#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd)]
pub enum DependencyGroup {
    /// Normal project dependencies.
    Dependencies,
    /// Development-only dependencies.
    DevDependencies,
}
impl DependencyGroup {
    fn parse(value: &str) -> Result<Self, Box<Diagnostic>> {
        match value {
            "dependencies" => Ok(Self::Dependencies),
            "dev-dependencies" => Ok(Self::DevDependencies),
            _ => Err(user(
                "state.groups contains an unsupported dependency group",
                "use dependencies or dev-dependencies",
            )),
        }
    }
    const fn as_str(self) -> &'static str {
        match self {
            Self::Dependencies => "dependencies",
            Self::DevDependencies => "dev-dependencies",
        }
    }
}

/// How one package-owned file was materialised.
#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd)]
pub enum MaterializationStrategy {
    /// A standalone file copy.
    Copy,
    /// A same-filesystem hard link.
    Hardlink,
    /// A copy-on-write reflink.
    Reflink,
}
impl MaterializationStrategy {
    fn parse(value: &str) -> Result<Self, Box<Diagnostic>> {
        match value {
            "copy" => Ok(Self::Copy),
            "hardlink" => Ok(Self::Hardlink),
            "reflink" => Ok(Self::Reflink),
            _ => Err(user(
                "file.materialization contains an unsupported strategy",
                "use copy, hardlink, or reflink",
            )),
        }
    }
    const fn as_str(self) -> &'static str {
        match self {
            Self::Copy => "copy",
            Self::Hardlink => "hardlink",
            Self::Reflink => "reflink",
        }
    }
}

/// One installed package's immutable identity.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct InstalledPackage {
    name: PackageName,
    source_immutable_id: ImmutableSourceId,
    package_sha256: String,
}
impl InstalledPackage {
    /// Creates a validated installed-package identity.
    ///
    /// # Errors
    ///
    /// Returns a diagnostic when the package checksum is not a SHA-256 digest.
    pub fn new(
        name: PackageName,
        source_immutable_id: ImmutableSourceId,
        package_sha256: String,
    ) -> Result<Self, Box<Diagnostic>> {
        valid_sha256(&package_sha256, "package.package_sha256")?;
        Ok(Self {
            name,
            source_immutable_id,
            package_sha256,
        })
    }
    /// Returns the package name.
    #[must_use]
    pub fn name(&self) -> &PackageName {
        &self.name
    }
    /// Returns the immutable source identity.
    #[must_use]
    pub fn source_immutable_id(&self) -> &ImmutableSourceId {
        &self.source_immutable_id
    }
    /// Returns the canonical prepared-package checksum.
    #[must_use]
    pub fn package_sha256(&self) -> &str {
        &self.package_sha256
    }
}

/// One project file owned by an installed package.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct OwnedFile {
    path: PathBuf,
    packages: BTreeSet<PackageName>,
    sha256: String,
    materialization: MaterializationStrategy,
}
impl OwnedFile {
    /// Creates a validated package-owned project-file record.
    ///
    /// # Errors
    ///
    /// Returns a diagnostic when the path or checksum is unsafe.
    pub fn new(
        path: impl AsRef<Path>,
        packages: BTreeSet<PackageName>,
        sha256: String,
        materialization: MaterializationStrategy,
    ) -> Result<Self, Box<Diagnostic>> {
        let path = safe_relative_path(path.as_ref(), "file.path")?;
        valid_sha256(&sha256, "file.sha256")?;
        if packages.is_empty() {
            return Err(user(
                "file.packages must not be empty",
                "record at least one installed package owner",
            ));
        }
        Ok(Self {
            path,
            packages,
            sha256,
            materialization,
        })
    }
    /// Returns the safe project-relative owned path.
    #[must_use]
    pub fn path(&self) -> &Path {
        &self.path
    }
    /// Returns every owning package name in canonical order.
    #[must_use]
    pub fn packages(&self) -> &BTreeSet<PackageName> {
        &self.packages
    }
    /// Returns the content hash recorded at materialisation time.
    #[must_use]
    pub fn sha256(&self) -> &str {
        &self.sha256
    }
    /// Returns the strategy used for this file.
    #[must_use]
    pub const fn materialization(&self) -> MaterializationStrategy {
        self.materialization
    }
}

/// Deterministic installed-state metadata for one project.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct InstalledState {
    groups: BTreeSet<DependencyGroup>,
    packages: BTreeMap<PackageName, InstalledPackage>,
    files: BTreeMap<PathBuf, OwnedFile>,
}

/// A non-mutating verification summary for installed state files.
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub struct InstalledStateVerification {
    verified_files: usize,
    missing_files: usize,
    modified_files: usize,
}
impl InstalledStateVerification {
    /// Returns the number of owned files matching their recorded hashes.
    #[must_use]
    pub const fn verified_files(self) -> usize {
        self.verified_files
    }

    /// Returns the number of owned files that are missing.
    #[must_use]
    pub const fn missing_files(self) -> usize {
        self.missing_files
    }

    /// Returns the number of owned files whose hash no longer matches state.
    #[must_use]
    pub const fn modified_files(self) -> usize {
        self.modified_files
    }
}
impl InstalledState {
    /// Creates installed state with validated ownership references.
    ///
    /// # Errors
    ///
    /// Returns a diagnostic for duplicate entries or a file whose package is absent.
    pub fn new(
        groups: BTreeSet<DependencyGroup>,
        packages: impl IntoIterator<Item = InstalledPackage>,
        files: impl IntoIterator<Item = OwnedFile>,
    ) -> Result<Self, Box<Diagnostic>> {
        let mut package_entries = BTreeMap::new();
        for package in packages {
            if package_entries
                .insert(package.name.clone(), package)
                .is_some()
            {
                return Err(user(
                    "installed state contains a duplicate package identity",
                    "retain one installed record per package name",
                ));
            }
        }
        let mut file_entries = BTreeMap::new();
        for file in files {
            if !file
                .packages
                .iter()
                .all(|package| package_entries.contains_key(package))
            {
                return Err(user(
                    "installed file references a package that is not installed",
                    "record every file owner as an installed package identity",
                ));
            }
            if file_entries.insert(file.path.clone(), file).is_some() {
                return Err(user(
                    "installed state contains duplicate owned paths",
                    "retain one owner for each project-relative path",
                ));
            }
        }
        Ok(Self {
            groups,
            packages: package_entries,
            files: file_entries,
        })
    }

    /// Parses a schema-one state document.
    ///
    /// # Errors
    ///
    /// Returns a diagnostic for malformed, unsupported, or unsafe state data.
    pub fn parse(path: &Path, input: &str) -> Result<Self, Box<Diagnostic>> {
        let document = Document::parse(input.to_owned()).map_err(|error| {
            Box::new(
                Diagnostic::new(ErrorCode::UserInput, "invalid installed-state TOML")
                    .with_cause(error)
                    .with_source(path.display().to_string())
                    .with_recovery("restore a valid .wukong/state.toml or run wukong sync"),
            )
        })?;
        let root = document.as_table();
        known(root, &["schema", "groups", "package", "file"], "state")?;
        if integer(root, "schema", "state")? != STATE_SCHEMA {
            return Err(user(
                "state.schema must be 1",
                "regenerate installed state with a supported wukong version",
            ));
        }
        let groups = groups(root)?;
        let packages = tables(root, "package", "state")?
            .into_iter()
            .map(parse_package)
            .collect::<Result<Vec<_>, _>>()?;
        let files = tables(root, "file", "state")?
            .into_iter()
            .map(parse_file)
            .collect::<Result<Vec<_>, _>>()?;
        Self::new(groups, packages, files)
    }

    /// Serialises deterministic schema-one TOML.
    #[must_use]
    pub fn to_toml(&self) -> String {
        let mut output = String::from("schema = 1\n");
        array(
            &mut output,
            "groups",
            self.groups.iter().map(|group| group.as_str()),
        );
        for package in self.packages.values() {
            output.push_str("\n[[package]]\n");
            line(&mut output, "name", package.name.as_str());
            line(
                &mut output,
                "source_immutable_id",
                package.source_immutable_id.as_str(),
            );
            line(&mut output, "package_sha256", &package.package_sha256);
        }
        for file in self.files.values() {
            output.push_str("\n[[file]]\n");
            line(&mut output, "path", path_string(&file.path));
            array(
                &mut output,
                "packages",
                file.packages.iter().map(PackageName::as_str),
            );
            line(&mut output, "sha256", &file.sha256);
            line(
                &mut output,
                "materialization",
                file.materialization.as_str(),
            );
        }
        output
    }

    /// Returns selected dependency groups in canonical order.
    #[must_use]
    pub fn groups(&self) -> &BTreeSet<DependencyGroup> {
        &self.groups
    }
    /// Returns installed packages by canonical name.
    #[must_use]
    pub fn packages(&self) -> &BTreeMap<PackageName, InstalledPackage> {
        &self.packages
    }
    /// Returns owned project files by canonical relative path.
    #[must_use]
    pub fn files(&self) -> &BTreeMap<PathBuf, OwnedFile> {
        &self.files
    }
}

/// Returns the project-local Wukong state directory.
#[must_use]
pub fn state_directory(project_root: &Path) -> PathBuf {
    project_root.join(STATE_DIRECTORY_NAME)
}

/// Returns the project-local Wukong installed-state path.
#[must_use]
pub fn state_path(project_root: &Path) -> PathBuf {
    state_directory(project_root).join(STATE_FILE_NAME)
}

/// Verifies that installed files still match their recorded ownership hashes.
///
/// Missing and modified files are reported in the returned summary without
/// mutating the project.
///
/// # Errors
///
/// Returns a diagnostic when a recorded path cannot be read for a reason other
/// than it being absent.
pub fn verify_installed_state(
    project_root: &Path,
    state: &InstalledState,
) -> Result<InstalledStateVerification, Box<Diagnostic>> {
    let mut report = InstalledStateVerification::default();
    for file in state.files().values() {
        match file_sha256(&project_root.join(file.path())) {
            Ok(hash) if hash == file.sha256() => report.verified_files += 1,
            Ok(_) => report.modified_files += 1,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                report.missing_files += 1;
            }
            Err(error) => {
                return Err(Box::new(
                    Diagnostic::new(
                        ErrorCode::InternalFailure,
                        "could not verify an installed package file",
                    )
                    .with_cause(error)
                    .with_recovery("check project permissions and retry"),
                ));
            }
        }
    }
    Ok(report)
}

/// Creates `.wukong` if it does not already exist.
///
/// # Errors
///
/// Returns a diagnostic if the path is not a real directory or cannot be created.
pub fn create_state_directory(project_root: &Path) -> Result<PathBuf, Box<Diagnostic>> {
    let directory = state_directory(project_root);
    match fs::symlink_metadata(&directory) {
        Ok(metadata) if metadata.file_type().is_dir() => Ok(directory),
        Ok(_) => Err(user(
            ".wukong exists but is not a directory",
            "move the conflicting path before running wukong sync",
        )),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            fs::create_dir(&directory).map_err(|error| {
                Box::new(
                    Diagnostic::new(ErrorCode::InternalFailure, "could not create .wukong")
                        .with_cause(error)
                        .with_recovery("check project permissions and retry"),
                )
            })?;
            Ok(directory)
        }
        Err(error) => Err(Box::new(
            Diagnostic::new(ErrorCode::InternalFailure, "could not inspect .wukong")
                .with_cause(error)
                .with_recovery("check project permissions and retry"),
        )),
    }
}

fn parse_package(table: &dyn TableLike) -> Result<InstalledPackage, Box<Diagnostic>> {
    known(
        table,
        &["name", "source_immutable_id", "package_sha256"],
        "package",
    )?;
    let name = PackageName::parse(&string(table, "name", "package")?).map_err(|error| {
        user(
            format!("package.name {error}"),
            "use a canonical package name",
        )
    })?;
    let immutable = ImmutableSourceId::new(string(table, "source_immutable_id", "package")?)
        .map_err(|error| {
            user(
                error.to_string(),
                "use a non-empty immutable source identity",
            )
        })?;
    InstalledPackage::new(name, immutable, string(table, "package_sha256", "package")?)
}

fn parse_file(table: &dyn TableLike) -> Result<OwnedFile, Box<Diagnostic>> {
    known(
        table,
        &["path", "packages", "sha256", "materialization"],
        "file",
    )?;
    let packages = package_names(table, "packages", "file")?;
    OwnedFile::new(
        PathBuf::from(string(table, "path", "file")?),
        packages,
        string(table, "sha256", "file")?,
        MaterializationStrategy::parse(&string(table, "materialization", "file")?)?,
    )
}

fn package_names(
    table: &dyn TableLike,
    key: &str,
    scope: &str,
) -> Result<BTreeSet<PackageName>, Box<Diagnostic>> {
    let values = table.get(key).and_then(Item::as_array).ok_or_else(|| {
        user(
            format!("{scope}.{key} must be an array"),
            "use sorted package names",
        )
    })?;
    let mut packages = BTreeSet::new();
    for value in values {
        let value = value.as_str().ok_or_else(|| {
            user(
                format!("{scope}.{key} entries must be strings"),
                "use package names",
            )
        })?;
        let name = PackageName::parse(value).map_err(|error| {
            user(
                format!("{scope}.{key} {error}"),
                "use canonical package names",
            )
        })?;
        if !packages.insert(name) {
            return Err(user(
                format!("{scope}.{key} must not contain duplicates"),
                "remove duplicate package owners",
            ));
        }
    }
    if packages.is_empty()
        || values.len() != packages.len()
        || !values
            .iter()
            .filter_map(toml_edit::Value::as_str)
            .collect::<Vec<_>>()
            .windows(2)
            .all(|pair| pair[0] < pair[1])
    {
        return Err(user(
            format!("{scope}.{key} must be non-empty and sorted"),
            "use sorted canonical package names",
        ));
    }
    Ok(packages)
}

fn groups(table: &dyn TableLike) -> Result<BTreeSet<DependencyGroup>, Box<Diagnostic>> {
    let values = table
        .get("groups")
        .and_then(Item::as_array)
        .ok_or_else(|| {
            user(
                "state.groups must be an array",
                "use a sorted dependency-group array",
            )
        })?;
    let mut groups = BTreeSet::new();
    for value in values {
        let value = value.as_str().ok_or_else(|| {
            user(
                "state.groups entries must be strings",
                "use dependency-group names",
            )
        })?;
        if !groups.insert(DependencyGroup::parse(value)?) {
            return Err(user(
                "state.groups must not contain duplicates",
                "remove duplicate dependency groups",
            ));
        }
    }
    if values.len() != groups.len()
        || !values
            .iter()
            .filter_map(toml_edit::Value::as_str)
            .collect::<Vec<_>>()
            .windows(2)
            .all(|pair| pair[0] < pair[1])
    {
        return Err(user(
            "state.groups must be sorted",
            "sort dependency groups ascending",
        ));
    }
    Ok(groups)
}

fn tables<'a>(
    table: &'a dyn TableLike,
    key: &str,
    scope: &str,
) -> Result<Vec<&'a dyn TableLike>, Box<Diagnostic>> {
    table
        .get(key)
        .map(|item| {
            item.as_array_of_tables()
                .ok_or_else(|| {
                    user(
                        format!("{scope}.{key} must be an array of tables"),
                        "use [[package]] or [[file]] entries",
                    )
                })
                .map(|tables| tables.iter().map(|table| table as &dyn TableLike).collect())
        })
        .transpose()
        .map(Option::unwrap_or_default)
}

fn string(table: &dyn TableLike, key: &str, scope: &str) -> Result<String, Box<Diagnostic>> {
    table
        .get(key)
        .and_then(Item::as_str)
        .map(str::to_owned)
        .ok_or_else(|| {
            user(
                format!("{scope}.{key} must be a string"),
                "use a string value",
            )
        })
}

fn integer(table: &dyn TableLike, key: &str, scope: &str) -> Result<i64, Box<Diagnostic>> {
    table.get(key).and_then(Item::as_integer).ok_or_else(|| {
        user(
            format!("{scope}.{key} must be an integer"),
            "use an integer",
        )
    })
}

fn known(table: &dyn TableLike, fields: &[&str], scope: &str) -> Result<(), Box<Diagnostic>> {
    for (key, _) in table.iter() {
        if !fields.contains(&key) {
            return Err(user(
                format!("{scope}.{key} is not supported"),
                "remove unknown installed-state fields",
            ));
        }
    }
    Ok(())
}

fn safe_relative_path(value: &Path, field: &str) -> Result<PathBuf, Box<Diagnostic>> {
    if value.as_os_str().is_empty() || value.to_string_lossy().contains('\\') {
        return Err(user(
            format!("{field} must be a safe slash-separated relative path"),
            "use a non-empty path below the project root",
        ));
    }
    let mut output = PathBuf::new();
    for component in value.components() {
        match component {
            Component::Normal(component) => output.push(component),
            Component::CurDir
            | Component::ParentDir
            | Component::RootDir
            | Component::Prefix(_) => {
                return Err(user(
                    format!("{field} must be a safe relative path"),
                    "use a path below the project root",
                ));
            }
        }
    }
    if output
        .components()
        .next()
        .is_some_and(|component| component.as_os_str() == STATE_DIRECTORY_NAME)
    {
        Err(user(
            "file.path must not overwrite .wukong metadata",
            "materialise package files outside .wukong",
        ))
    } else {
        Ok(output)
    }
}

fn valid_sha256(value: &str, field: &str) -> Result<(), Box<Diagnostic>> {
    if value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || matches!(byte, b'a'..=b'f'))
    {
        Ok(())
    } else {
        Err(user(
            format!("{field} must be a lowercase SHA-256 digest"),
            "use a 64-character lowercase hexadecimal digest",
        ))
    }
}

fn file_sha256(path: &Path) -> Result<String, std::io::Error> {
    let mut file = fs::File::open(path)?;
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 8192];
    loop {
        let read = file.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

fn path_string(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

fn line(output: &mut String, key: &str, value: impl AsRef<str>) {
    output.push_str(key);
    output.push_str(" = ");
    output.push_str(&quote(value.as_ref()));
    output.push('\n');
}

fn array<'a>(output: &mut String, key: &str, values: impl IntoIterator<Item = &'a str>) {
    output.push_str(key);
    output.push_str(" = [");
    let mut first = true;
    for value in values {
        if !first {
            output.push_str(", ");
        }
        output.push_str(&quote(value));
        first = false;
    }
    output.push_str("]\n");
}

fn quote(value: &str) -> String {
    let mut output = String::from("\"");
    for character in value.chars() {
        match character {
            '\\' => output.push_str("\\\\"),
            '\"' => output.push_str("\\\""),
            '\n' => output.push_str("\\n"),
            '\r' => output.push_str("\\r"),
            '\t' => output.push_str("\\t"),
            character if character < ' ' => {
                output.push_str(&format!("\\u{:04x}", character as u32));
            }
            character => output.push(character),
        }
    }
    output.push('\"');
    output
}

fn user(message: impl AsRef<str>, recovery: impl AsRef<str>) -> Box<Diagnostic> {
    Box::new(
        Diagnostic::new(ErrorCode::UserInput, message)
            .with_source(STATE_FILE_NAME)
            .with_recovery(recovery),
    )
}
