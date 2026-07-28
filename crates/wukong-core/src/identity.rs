//! Canonical package names, local source identities, and conflict detection.

use std::{
    borrow::Borrow,
    collections::BTreeMap,
    error::Error,
    fmt::{self, Display, Formatter},
    fs,
    io::{self, ErrorKind},
    path::{Component, Path, PathBuf},
};

/// A canonical ASCII package name.
#[derive(Clone, Debug, Eq, Ord, PartialEq, PartialOrd)]
pub struct PackageName(String);

impl PackageName {
    /// Parses and validates a canonical package name.
    ///
    /// # Errors
    ///
    /// Returns [`PackageNameError`] when `value` is not lowercase ASCII with
    /// optional internal hyphens.
    pub fn parse(value: &str) -> Result<Self, PackageNameError> {
        let valid = !value.is_empty()
            && value
                .bytes()
                .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
            && value
                .as_bytes()
                .first()
                .is_some_and(u8::is_ascii_alphanumeric)
            && value
                .as_bytes()
                .last()
                .is_some_and(u8::is_ascii_alphanumeric);
        if valid {
            Ok(Self(value.to_owned()))
        } else {
            Err(PackageNameError)
        }
    }

    /// Returns the canonical package name.
    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl Display for PackageName {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> fmt::Result {
        formatter.write_str(self.as_str())
    }
}

impl Borrow<str> for PackageName {
    fn borrow(&self) -> &str {
        self.as_str()
    }
}

/// An invalid package-name error.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct PackageNameError;

impl Display for PackageNameError {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> fmt::Result {
        formatter.write_str("must use lowercase ASCII letters, digits, and internal hyphens")
    }
}

impl Error for PackageNameError {}

/// An absolute, filesystem-canonical local package directory.
#[derive(Clone, Debug, Eq, Ord, PartialEq, PartialOrd)]
pub struct LocalSourceIdentity(PathBuf);

impl LocalSourceIdentity {
    /// Canonicalises an existing local package path.
    ///
    /// # Errors
    ///
    /// Returns an I/O error when the path cannot be canonicalised.
    pub fn from_existing_path(path: &Path) -> io::Result<Self> {
        let canonical = fs::canonicalize(path)?;
        Self::from_canonical_path(canonical)
            .map_err(|error| io::Error::new(ErrorKind::InvalidInput, error))
    }

    /// Validates a path already canonicalised by a source adapter.
    ///
    /// # Errors
    ///
    /// Returns [`LocalSourceIdentityError`] for a relative or lexically
    /// unnormalised path.
    pub fn from_canonical_path(path: PathBuf) -> Result<Self, LocalSourceIdentityError> {
        let has_unresolved_component = path
            .components()
            .any(|component| matches!(component, Component::CurDir | Component::ParentDir));
        if path.is_absolute() && !has_unresolved_component {
            Ok(Self(path))
        } else {
            Err(LocalSourceIdentityError)
        }
    }

    /// Returns the canonical local package directory.
    #[must_use]
    pub fn path(&self) -> &Path {
        &self.0
    }
}

/// An invalid local source-identity path error.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct LocalSourceIdentityError;

impl Display for LocalSourceIdentityError {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> fmt::Result {
        formatter.write_str("local source identity must be an absolute path without . or ..")
    }
}

impl Error for LocalSourceIdentityError {}

/// A source identity implemented by the current local-path vertical slice.
#[derive(Clone, Debug, Eq, Ord, PartialEq, PartialOrd)]
pub enum SourceIdentity {
    /// A filesystem-canonical local package directory.
    Local(LocalSourceIdentity),
}

/// A package name paired with a canonical source identity.
#[derive(Clone, Debug, Eq, Ord, PartialEq, PartialOrd)]
pub struct PackageIdentity {
    name: PackageName,
    source: SourceIdentity,
}

impl PackageIdentity {
    /// Creates a package identity.
    #[must_use]
    pub const fn new(name: PackageName, source: SourceIdentity) -> Self {
        Self { name, source }
    }

    /// Returns the canonical package name.
    #[must_use]
    pub const fn name(&self) -> &PackageName {
        &self.name
    }

    /// Returns the source-qualified identity.
    #[must_use]
    pub const fn source(&self) -> &SourceIdentity {
        &self.source
    }
}

/// A deterministic collection that rejects source conflicts by package name.
#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct PackageIdentitySet {
    identities: BTreeMap<PackageName, PackageIdentity>,
}

impl PackageIdentitySet {
    /// Inserts an identity or reports a conflicting source for the same name.
    ///
    /// Re-inserting an identical identity is a no-op and returns `Ok(false)`.
    ///
    /// # Errors
    ///
    /// Returns [`PackageIdentityConflict`] before any source operation when
    /// the name already maps to a different source identity.
    pub fn insert(&mut self, identity: PackageIdentity) -> Result<bool, PackageIdentityConflict> {
        match self.identities.get(identity.name()) {
            None => {
                self.identities.insert(identity.name.clone(), identity);
                Ok(true)
            }
            Some(existing) if existing == &identity => Ok(false),
            Some(existing) => Err(PackageIdentityConflict {
                existing: existing.clone(),
                attempted: identity,
            }),
        }
    }

    /// Returns identities in deterministic package-name order.
    #[must_use]
    pub fn identities(&self) -> impl ExactSizeIterator<Item = &PackageIdentity> {
        self.identities.values()
    }
}

/// A conflict between two source-qualified identities sharing one package name.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PackageIdentityConflict {
    existing: PackageIdentity,
    attempted: PackageIdentity,
}

impl PackageIdentityConflict {
    /// Returns the identity already associated with the package name.
    #[must_use]
    pub const fn existing(&self) -> &PackageIdentity {
        &self.existing
    }

    /// Returns the conflicting identity that was attempted.
    #[must_use]
    pub const fn attempted(&self) -> &PackageIdentity {
        &self.attempted
    }
}

impl Display for PackageIdentityConflict {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> fmt::Result {
        write!(
            formatter,
            "package {} has conflicting source identities",
            self.existing.name()
        )
    }
}

impl Error for PackageIdentityConflict {}
