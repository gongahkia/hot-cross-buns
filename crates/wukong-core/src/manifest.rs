//! Typed parsing for the version-one `wukong.toml` schema.

#[cfg(feature = "asset-library")]
use crate::asset_library::AssetId;
use crate::{
    credentials::has_sensitive_url_query,
    diagnostic::{Diagnostic, ErrorCode},
    identity::PackageName,
    semantic_version::VersionRequirement,
};
use std::{
    borrow::Borrow,
    collections::BTreeMap,
    error::Error,
    fmt::{self, Display, Formatter},
    path::{Component, Path, PathBuf},
};
use toml_edit::{Document, Item, TableLike};

/// The project manifest file name.
pub const MANIFEST_FILE_NAME: &str = "wukong.toml";

/// The result type returned by manifest parsing.
pub type ManifestResult<T> = std::result::Result<T, Box<Diagnostic>>;

/// A validated project manifest.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Manifest {
    project: Project,
    dependencies: BTreeMap<DependencyAlias, Dependency>,
    dev_dependencies: BTreeMap<DependencyAlias, Dependency>,
}

impl Manifest {
    /// Parses a manifest located at `path`.
    ///
    /// # Errors
    ///
    /// Returns a user diagnostic for invalid TOML or unsupported schema fields.
    pub fn parse(path: &Path, input: &str) -> ManifestResult<Self> {
        let document = Document::parse(input.to_owned()).map_err(|error| {
            boxed(
                Diagnostic::new(ErrorCode::UserInput, "invalid wukong.toml syntax")
                    .with_cause(error)
                    .with_recovery("fix the TOML syntax and retry"),
            )
        })?;
        let root = document.as_table();
        reject_unknown_fields(
            root,
            &["project", "dependencies", "dev-dependencies"],
            path,
            input,
            "root",
        )?;
        let project = parse_project(
            require_table(root, "project", path, input, "root")?,
            path,
            input,
        )?;
        let manifest_directory = path.parent().unwrap_or_else(|| Path::new("."));
        let dependencies = parse_dependencies(
            root.get("dependencies"),
            manifest_directory,
            path,
            input,
            "dependencies",
        )?;
        let dev_dependencies = parse_dependencies(
            root.get("dev-dependencies"),
            manifest_directory,
            path,
            input,
            "dev-dependencies",
        )?;
        Ok(Self {
            project,
            dependencies,
            dev_dependencies,
        })
    }

    /// Returns project metadata.
    #[must_use]
    pub const fn project(&self) -> &Project {
        &self.project
    }

    /// Returns runtime dependencies in deterministic alias order.
    #[must_use]
    pub const fn dependencies(&self) -> &BTreeMap<DependencyAlias, Dependency> {
        &self.dependencies
    }

    /// Returns development dependencies in deterministic alias order.
    #[must_use]
    pub const fn dev_dependencies(&self) -> &BTreeMap<DependencyAlias, Dependency> {
        &self.dev_dependencies
    }
}

/// Required metadata for the Godot project.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Project {
    name: String,
    godot: VersionRequirement,
}

impl Project {
    /// Returns the manifest project name.
    #[must_use]
    pub fn name(&self) -> &str {
        &self.name
    }
    /// Returns the validated Godot version requirement.
    #[must_use]
    pub const fn godot(&self) -> &VersionRequirement {
        &self.godot
    }
}

/// A validated manifest dependency alias.
#[derive(Clone, Debug, Eq, Ord, PartialEq, PartialOrd)]
pub struct DependencyAlias(PackageName);

impl DependencyAlias {
    #[must_use]
    pub fn as_str(&self) -> &str {
        self.0.as_str()
    }
}

impl Borrow<str> for DependencyAlias {
    fn borrow(&self) -> &str {
        self.as_str()
    }
}

/// A dependency declaration.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum Dependency {
    /// A future catalogue version requirement.
    Version(VersionRequirement),
    /// A local directory resolved relative to `wukong.toml`.
    Path {
        /// Directory resolved relative to `wukong.toml` when needed.
        path: PathBuf,
        /// Optional source and target layout overrides.
        layout: DependencyLayout,
    },
    /// A Git source and optional revision selector.
    Git {
        url: String,
        reference: Option<GitReference>,
        /// Optional source and target layout overrides.
        layout: DependencyLayout,
    },
    /// A checksummed HTTP archive.
    Url {
        url: String,
        sha256: String,
        /// Optional source and target layout overrides.
        layout: DependencyLayout,
    },
    /// A feature-gated official `AssetLib` addon ID.
    #[cfg(feature = "asset-library")]
    Asset {
        /// Stable `AssetLib` identifier.
        id: AssetId,
        /// Optional source and target layout overrides.
        layout: DependencyLayout,
    },
}

/// Optional project-owned package-layout selection.
#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct DependencyLayout {
    root: Option<PathBuf>,
    target: Option<PathBuf>,
}

impl DependencyLayout {
    /// Returns an explicit source-relative package root when declared.
    #[must_use]
    pub fn root(&self) -> Option<&Path> {
        self.root.as_deref()
    }

    /// Returns an explicit project-relative installation target when declared.
    #[must_use]
    pub fn target(&self) -> Option<&Path> {
        self.target.as_deref()
    }
}

/// A Git manifest revision selector.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum GitReference {
    Rev(String),
    Tag(String),
    Branch(String),
}

impl GitReference {
    /// Validates a selector before it is passed to a Git implementation.
    ///
    /// # Errors
    ///
    /// Returns an error when the selector cannot safely identify a Git ref.
    pub fn validate(&self) -> Result<(), GitReferenceError> {
        match self {
            Self::Rev(value) if valid_commit(value) => Ok(()),
            Self::Rev(_) => Err(GitReferenceError::ExactRevision),
            Self::Tag(value) | Self::Branch(value) if valid_ref_name(value) => Ok(()),
            Self::Tag(_) | Self::Branch(_) => Err(GitReferenceError::Name),
        }
    }
}

/// An invalid Git revision selector.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum GitReferenceError {
    /// An exact revision was not a complete object ID.
    ExactRevision,
    /// A tag or branch name was not a valid safe ref name.
    Name,
}

impl Display for GitReferenceError {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> fmt::Result {
        match self {
            Self::ExactRevision => {
                formatter.write_str("must be a 40- or 64-character hexadecimal commit ID")
            }
            Self::Name => formatter.write_str("must be a non-empty safe Git reference name"),
        }
    }
}

impl Error for GitReferenceError {}

fn parse_project(table: &dyn TableLike, path: &Path, input: &str) -> ManifestResult<Project> {
    reject_unknown_fields(table, &["name", "godot"], path, input, "project")?;
    let name = required_string(table, "name", path, input, "project")?;
    if name.trim().is_empty() {
        return Err(field_error(
            path,
            input,
            "project.name",
            table.get("name"),
            "must not be empty",
        ));
    }
    let godot_raw = required_string(table, "godot", path, input, "project")?;
    let godot = VersionRequirement::parse(&godot_raw).map_err(|error| {
        field_error(
            path,
            input,
            "project.godot",
            table.get("godot"),
            &format!("invalid version requirement: {error}"),
        )
    })?;
    Ok(Project { name, godot })
}

fn parse_dependencies(
    item: Option<&Item>,
    directory: &Path,
    path: &Path,
    input: &str,
    table_name: &str,
) -> ManifestResult<BTreeMap<DependencyAlias, Dependency>> {
    let Some(item) = item else {
        return Ok(BTreeMap::new());
    };
    let table = item
        .as_table()
        .ok_or_else(|| field_error(path, input, table_name, Some(item), "must be a table"))?;
    let mut dependencies = BTreeMap::new();
    for (key, item) in table {
        let alias = DependencyAlias(
            PackageName::parse(key)
                .map_err(|error| field_error(path, input, key, Some(item), &error.to_string()))?,
        );
        let field = format!("{table_name}.{}", alias.as_str());
        let dependency = if let Some(requirement) = item.as_str() {
            Dependency::Version(VersionRequirement::parse(requirement).map_err(|error| {
                field_error(
                    path,
                    input,
                    &field,
                    Some(item),
                    &format!("invalid version requirement: {error}"),
                )
            })?)
        } else if let Some(source) = item.as_inline_table() {
            parse_source(source, directory, path, input, &field, item)?
        } else {
            return Err(field_error(
                path,
                input,
                &field,
                Some(item),
                "must be a version string or inline source table",
            ));
        };
        dependencies.insert(alias, dependency);
    }
    Ok(dependencies)
}

fn parse_source(
    table: &dyn TableLike,
    directory: &Path,
    path: &Path,
    input: &str,
    field: &str,
    item: &Item,
) -> ManifestResult<Dependency> {
    #[cfg(feature = "asset-library")]
    let allowed = vec![
        "path", "git", "url", "rev", "tag", "branch", "sha256", "asset", "root", "target",
    ];
    #[cfg(not(feature = "asset-library"))]
    let allowed = vec![
        "path", "git", "url", "rev", "tag", "branch", "sha256", "root", "target",
    ];
    reject_unknown_fields(table, &allowed, path, input, field)?;
    let source_count = ["path", "git", "url"]
        .into_iter()
        .filter(|key| table.contains_key(key))
        .count();
    #[cfg(feature = "asset-library")]
    let source_count = source_count + usize::from(table.contains_key("asset"));
    if source_count != 1 {
        return Err(field_error(
            path,
            input,
            field,
            Some(item),
            "must specify exactly one supported source",
        ));
    }
    if table.contains_key("path") {
        parse_path_source(table, directory, path, input, field)
    } else if table.contains_key("git") {
        parse_git_source(table, path, input, field, item)
    } else if table.contains_key("url") {
        parse_url_source(table, path, input, field)
    } else {
        #[cfg(feature = "asset-library")]
        return parse_asset_source(table, path, input, field);
        #[cfg(not(feature = "asset-library"))]
        unreachable!("unsupported sources are rejected before selection")
    }
}

fn parse_path_source(
    table: &dyn TableLike,
    directory: &Path,
    path: &Path,
    input: &str,
    field: &str,
) -> ManifestResult<Dependency> {
    reject_present(
        table,
        &["git", "url", "rev", "tag", "branch", "sha256"],
        path,
        input,
        field,
    )?;
    let raw = required_string(table, "path", path, input, field)?;
    if raw.trim().is_empty() {
        return Err(field_error(
            path,
            input,
            &format!("{field}.path"),
            table.get("path"),
            "must not be empty",
        ));
    }
    if raw.contains('\0') {
        return Err(field_error(
            path,
            input,
            &format!("{field}.path"),
            table.get("path"),
            "must not contain a null character",
        ));
    }
    Ok(Dependency::Path {
        path: resolve_path(directory, Path::new(&raw)),
        layout: parse_layout(table, path, input, field)?,
    })
}

fn parse_git_source(
    table: &dyn TableLike,
    path: &Path,
    input: &str,
    field: &str,
    item: &Item,
) -> ManifestResult<Dependency> {
    reject_present(table, &["path", "url", "sha256"], path, input, field)?;
    let url = safe_git_url(
        required_string(table, "git", path, input, field)?,
        path,
        input,
        &format!("{field}.git"),
        table.get("git"),
    )?;
    let reference_count = ["rev", "tag", "branch"]
        .into_iter()
        .filter(|key| table.contains_key(key))
        .count();
    if reference_count > 1 {
        return Err(field_error(
            path,
            input,
            field,
            Some(item),
            "may specify at most one of rev, tag, or branch",
        ));
    }
    let reference = ["rev", "tag", "branch"]
        .into_iter()
        .find(|key| table.contains_key(key))
        .map(|key| required_string(table, key, path, input, field).map(|value| (key, value)))
        .transpose()?
        .map(|(key, value)| {
            let reference = match key {
                "rev" => GitReference::Rev(value),
                "tag" => GitReference::Tag(value),
                _ => GitReference::Branch(value),
            };
            reference.validate().map_err(|error| {
                field_error(
                    path,
                    input,
                    &format!("{field}.{key}"),
                    table.get(key),
                    &error.to_string(),
                )
            })?;
            Ok::<GitReference, Box<Diagnostic>>(reference)
        })
        .transpose()?;
    Ok(Dependency::Git {
        url,
        reference,
        layout: parse_layout(table, path, input, field)?,
    })
}

fn parse_url_source(
    table: &dyn TableLike,
    path: &Path,
    input: &str,
    field: &str,
) -> ManifestResult<Dependency> {
    reject_present(
        table,
        &["path", "git", "rev", "tag", "branch"],
        path,
        input,
        field,
    )?;
    let url = safe_url(
        required_string(table, "url", path, input, field)?,
        path,
        input,
        &format!("{field}.url"),
        table.get("url"),
    )?;
    let sha256 = required_string(table, "sha256", path, input, field)?;
    if sha256.len() != 64 || !sha256.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err(field_error(
            path,
            input,
            &format!("{field}.sha256"),
            table.get("sha256"),
            "must be a 64-character hexadecimal SHA-256",
        ));
    }
    Ok(Dependency::Url {
        url,
        sha256,
        layout: parse_layout(table, path, input, field)?,
    })
}

#[cfg(feature = "asset-library")]
fn parse_asset_source(
    table: &dyn TableLike,
    path: &Path,
    input: &str,
    field: &str,
) -> ManifestResult<Dependency> {
    reject_present(
        table,
        &["path", "git", "url", "rev", "tag", "branch", "sha256"],
        path,
        input,
        field,
    )?;
    let asset = required_string(table, "asset", path, input, field)?;
    let asset = AssetId::parse(asset).map_err(|error| {
        field_error(
            path,
            input,
            &format!("{field}.asset"),
            table.get("asset"),
            &error.to_string(),
        )
    })?;
    Ok(Dependency::Asset {
        id: asset,
        layout: parse_layout(table, path, input, field)?,
    })
}

fn parse_layout(
    table: &dyn TableLike,
    path: &Path,
    input: &str,
    field: &str,
) -> ManifestResult<DependencyLayout> {
    Ok(DependencyLayout {
        root: optional_layout_path(table, "root", path, input, field)?,
        target: optional_layout_path(table, "target", path, input, field)?,
    })
}

fn optional_layout_path(
    table: &dyn TableLike,
    key: &str,
    path: &Path,
    input: &str,
    field: &str,
) -> ManifestResult<Option<PathBuf>> {
    let Some(item) = table.get(key) else {
        return Ok(None);
    };
    let value = item.as_str().ok_or_else(|| {
        field_error(
            path,
            input,
            &format!("{field}.{key}"),
            Some(item),
            "must be a safe relative path",
        )
    })?;
    let raw = Path::new(value);
    let windows_drive = value
        .as_bytes()
        .first()
        .is_some_and(u8::is_ascii_alphabetic)
        && value.as_bytes().get(1).is_some_and(|byte| *byte == b':');
    let invalid =
        value.is_empty() || value.contains(['\\', '\0']) || value.starts_with('/') || windows_drive;
    if invalid {
        return Err(field_error(
            path,
            input,
            &format!("{field}.{key}"),
            Some(item),
            "must be a safe relative path without traversal or a platform prefix",
        ));
    }
    let mut normalised = PathBuf::new();
    for component in raw.components() {
        match component {
            Component::Normal(part) => normalised.push(part),
            Component::CurDir => {}
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => {
                return Err(field_error(
                    path,
                    input,
                    &format!("{field}.{key}"),
                    Some(item),
                    "must be a safe relative path without traversal or a platform prefix",
                ));
            }
        }
    }
    if normalised.as_os_str().is_empty() {
        return Err(field_error(
            path,
            input,
            &format!("{field}.{key}"),
            Some(item),
            "must be a non-empty relative path",
        ));
    }
    Ok(Some(normalised))
}

fn require_table<'a>(
    table: &'a dyn TableLike,
    key: &str,
    path: &Path,
    input: &str,
    scope: &str,
) -> ManifestResult<&'a dyn TableLike> {
    let item = table
        .get(key)
        .ok_or_else(|| field_error(path, input, &format!("{scope}.{key}"), None, "is required"))?;
    item.as_table_like().ok_or_else(|| {
        field_error(
            path,
            input,
            &format!("{scope}.{key}"),
            Some(item),
            "must be a table",
        )
    })
}

fn required_string(
    table: &dyn TableLike,
    key: &str,
    path: &Path,
    input: &str,
    scope: &str,
) -> ManifestResult<String> {
    let item = table
        .get(key)
        .ok_or_else(|| field_error(path, input, &format!("{scope}.{key}"), None, "is required"))?;
    item.as_str().map(str::to_owned).ok_or_else(|| {
        field_error(
            path,
            input,
            &format!("{scope}.{key}"),
            Some(item),
            "must be a string",
        )
    })
}

fn reject_unknown_fields(
    table: &dyn TableLike,
    allowed: &[&str],
    path: &Path,
    input: &str,
    scope: &str,
) -> ManifestResult<()> {
    if let Some((key, item)) = table.iter().find(|(key, _)| !allowed.contains(key)) {
        return Err(field_error(
            path,
            input,
            &format!("{scope}.{key}"),
            Some(item),
            "is not supported",
        ));
    }
    Ok(())
}

fn reject_present(
    table: &dyn TableLike,
    fields: &[&str],
    path: &Path,
    input: &str,
    scope: &str,
) -> ManifestResult<()> {
    for field in fields {
        if let Some(item) = table.get(field) {
            return Err(field_error(
                path,
                input,
                &format!("{scope}.{field}"),
                Some(item),
                "is incompatible with the selected source",
            ));
        }
    }
    Ok(())
}

fn safe_url(
    value: String,
    path: &Path,
    input: &str,
    field: &str,
    item: Option<&Item>,
) -> ManifestResult<String> {
    if value.trim().is_empty() || value.chars().any(char::is_whitespace) {
        return Err(field_error(
            path,
            input,
            field,
            item,
            "must be a non-empty URL without whitespace",
        ));
    }
    let has_user_info = value.find("://").is_some_and(|scheme_end| {
        let authority = &value[scheme_end + 3..];
        let authority_end = authority.find(['/', '?', '#']).unwrap_or(authority.len());
        authority[..authority_end].contains('@')
    });
    let has_secret_query = has_sensitive_url_query(&value);
    if has_user_info || has_secret_query {
        Err(field_error(
            path,
            input,
            field,
            item,
            "must not contain credentials",
        ))
    } else {
        Ok(value)
    }
}

fn safe_git_url(
    value: String,
    path: &Path,
    input: &str,
    field: &str,
    item: Option<&Item>,
) -> ManifestResult<String> {
    if value.trim().is_empty() || value.chars().any(char::is_whitespace) {
        return Err(field_error(
            path,
            input,
            field,
            item,
            "must be a non-empty URL without whitespace",
        ));
    }
    let has_disallowed_user_info = value.find("://").is_some_and(|scheme_end| {
        let authority = &value[scheme_end + 3..];
        let authority = &authority[..authority.find(['/', '?', '#']).unwrap_or(authority.len())];
        authority.split_once('@').is_some_and(|(user, _)| {
            !value[..scheme_end].eq_ignore_ascii_case("ssh")
                || user.is_empty()
                || user.contains(':')
        })
    });
    let has_secret_query = has_sensitive_url_query(&value);
    if has_disallowed_user_info || has_secret_query {
        Err(field_error(
            path,
            input,
            field,
            item,
            "must not contain credentials",
        ))
    } else {
        Ok(value)
    }
}

fn valid_commit(value: &str) -> bool {
    matches!(value.len(), 40 | 64) && value.bytes().all(|byte| byte.is_ascii_hexdigit())
}

fn valid_ref_name(value: &str) -> bool {
    !value.is_empty()
        && !value.starts_with('-')
        && !value.starts_with('/')
        && !value.ends_with('/')
        && !value.ends_with('.')
        && !value.contains("..")
        && !value.contains("@{")
        && !value.chars().any(|character| {
            character.is_whitespace()
                || character.is_control()
                || matches!(character, '~' | '^' | ':' | '?' | '*' | '[' | '\\')
        })
        && value.split('/').all(|component| {
            !component.is_empty()
                && component != "."
                && component != ".."
                && !has_lock_suffix(component)
        })
}

fn has_lock_suffix(value: &str) -> bool {
    value
        .get(value.len().saturating_sub(5)..)
        .is_some_and(|suffix| suffix.eq_ignore_ascii_case(".lock"))
}

fn resolve_path(directory: &Path, source_path: &Path) -> PathBuf {
    let mut resolved = if source_path.is_absolute() {
        PathBuf::new()
    } else {
        directory.to_path_buf()
    };
    for component in source_path.components() {
        match component {
            Component::Prefix(prefix) => resolved.push(prefix.as_os_str()),
            Component::RootDir => resolved.push(component.as_os_str()),
            Component::CurDir => {}
            Component::ParentDir => {
                if !resolved.pop() && !resolved.has_root() {
                    resolved.push(component.as_os_str());
                }
            }
            Component::Normal(value) => resolved.push(value),
        }
    }
    resolved
}

fn field_error(
    path: &Path,
    input: &str,
    field: &str,
    item: Option<&Item>,
    detail: &str,
) -> Box<Diagnostic> {
    let location = item
        .and_then(Item::span)
        .map(|span| {
            let prefix = &input[..span.start];
            format!(
                " at line {}, column {}",
                prefix.bytes().filter(|byte| *byte == b'\n').count() + 1,
                prefix
                    .rsplit('\n')
                    .next()
                    .map_or(1, |line| line.chars().count() + 1)
            )
        })
        .unwrap_or_default();
    boxed(
        Diagnostic::new(
            ErrorCode::UserInput,
            format!("manifest field {field}{location} {detail}"),
        )
        .with_source(path.display().to_string())
        .with_recovery("fix the manifest field and retry"),
    )
}

fn boxed(diagnostic: Diagnostic) -> Box<Diagnostic> {
    Box::new(diagnostic)
}
