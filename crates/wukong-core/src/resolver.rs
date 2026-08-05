//! Source-neutral, lazy transitive dependency resolution.

use crate::{
    diagnostic::{Diagnostic, ErrorCode},
    identity::PackageName,
    package_metadata::PackageMetadata,
    semantic_version::{SemanticVersion, VersionRequirement},
    source::CancellationToken,
};
use pubgrub::{
    DefaultStringReporter, Dependencies, DependencyConstraints, DependencyProvider,
    PackageResolutionStatistics, PubGrubError, Ranges, Reporter, resolve,
};
use std::{
    cell::RefCell,
    collections::{BTreeMap, BTreeSet},
    error::Error,
    fmt::{self, Display, Formatter},
    path::Path,
};

/// Result type returned by resolver operations.
pub type ResolverResult<T> = Result<T, Box<Diagnostic>>;

/// A package candidate supplied by a source adapter.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PackageCandidate {
    version: SemanticVersion,
    dependencies: BTreeMap<PackageName, VersionRequirement>,
}

impl PackageCandidate {
    /// Creates a candidate with canonical version identity.
    #[must_use]
    pub fn new(
        version: &SemanticVersion,
        dependencies: BTreeMap<PackageName, VersionRequirement>,
    ) -> Self {
        Self {
            version: version.without_build_metadata(),
            dependencies,
        }
    }

    /// Reads a required candidate from package-owned metadata.
    ///
    /// # Errors
    ///
    /// Returns metadata parsing or I/O diagnostics, including a user diagnostic
    /// when package metadata is absent.
    pub fn load_required(package_root: &Path) -> ResolverResult<Self> {
        PackageMetadata::load_required(package_root)
            .map(|metadata| Self::new(metadata.version(), metadata.dependencies().clone()))
    }

    /// Returns the candidate's canonical semantic version.
    #[must_use]
    pub const fn version(&self) -> &SemanticVersion {
        &self.version
    }

    /// Returns transitive requirements in deterministic name order.
    #[must_use]
    pub const fn dependencies(&self) -> &BTreeMap<PackageName, VersionRequirement> {
        &self.dependencies
    }
}

/// Source-neutral catalogue queried lazily while resolving.
pub trait PackageUniverse {
    /// Returns every immutable candidate known for `package`.
    ///
    /// An unknown package must return an empty list. Returned candidates must
    /// not execute package scripts or mutate the project.
    ///
    /// # Errors
    ///
    /// Returns a diagnostic when a source cannot provide a trusted candidate
    /// catalogue or package metadata.
    fn candidates(&self, package: &PackageName) -> ResolverResult<Vec<PackageCandidate>>;
}

/// Deterministic in-memory package universe for source adapters and tests.
#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct InMemoryPackageUniverse {
    packages: BTreeMap<PackageName, Vec<PackageCandidate>>,
}

impl InMemoryPackageUniverse {
    /// Creates an empty package universe.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Adds a candidate for a package.
    ///
    /// # Errors
    ///
    /// Returns a diagnostic when the source supplies two candidates with the
    /// same canonical version identity.
    pub fn add_candidate(
        &mut self,
        package: PackageName,
        candidate: PackageCandidate,
    ) -> ResolverResult<()> {
        let package_display = package.to_string();
        let candidates = self.packages.entry(package).or_default();
        if candidates
            .iter()
            .any(|existing| existing.version() == candidate.version())
        {
            return Err(Box::new(
                Diagnostic::new(
                    ErrorCode::IntegrityFailure,
                    format!(
                        "package {package_display} supplies duplicate version {}",
                        candidate.version()
                    ),
                )
                .with_package(package_display)
                .with_recovery("make each immutable source candidate use one canonical version"),
            ));
        }
        candidates.push(candidate);
        candidates.sort_by(|left, right| left.version().cmp(right.version()));
        Ok(())
    }
}

impl PackageUniverse for InMemoryPackageUniverse {
    fn candidates(&self, package: &PackageName) -> ResolverResult<Vec<PackageCandidate>> {
        Ok(self.packages.get(package).cloned().unwrap_or_default())
    }
}

/// Direct requirements and valid prior lock selections supplied to the resolver.
#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct ResolutionRequest {
    direct_dependencies: BTreeMap<PackageName, VersionRequirement>,
    locked: BTreeMap<PackageName, SemanticVersion>,
}

impl ResolutionRequest {
    /// Creates an empty request.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Adds a direct requirement.
    pub fn require(&mut self, package: PackageName, requirement: VersionRequirement) {
        self.direct_dependencies.insert(package, requirement);
    }

    /// Adds a preferred existing lock selection.
    pub fn prefer_locked(&mut self, package: PackageName, version: &SemanticVersion) {
        self.locked
            .insert(package, version.without_build_metadata());
    }

    /// Returns direct requirements in deterministic name order.
    #[must_use]
    pub const fn direct_dependencies(&self) -> &BTreeMap<PackageName, VersionRequirement> {
        &self.direct_dependencies
    }

    /// Returns preferred locked versions in deterministic name order.
    #[must_use]
    pub const fn locked(&self) -> &BTreeMap<PackageName, SemanticVersion> {
        &self.locked
    }
}

/// One selected package in a resolved graph.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ResolvedPackage {
    version: SemanticVersion,
    dependencies: BTreeMap<PackageName, VersionRequirement>,
}

impl ResolvedPackage {
    /// Returns the selected canonical version.
    #[must_use]
    pub const fn version(&self) -> &SemanticVersion {
        &self.version
    }

    /// Returns requirements declared by the selected candidate.
    #[must_use]
    pub const fn dependencies(&self) -> &BTreeMap<PackageName, VersionRequirement> {
        &self.dependencies
    }
}

/// A complete deterministic selection of transitive packages.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ResolvedGraph {
    packages: BTreeMap<PackageName, ResolvedPackage>,
}

impl ResolvedGraph {
    /// Returns selected packages in deterministic name order.
    #[must_use]
    pub const fn packages(&self) -> &BTreeMap<PackageName, ResolvedPackage> {
        &self.packages
    }
}

/// Resolves every direct and transitive requirement without mutating project files.
///
/// # Errors
///
/// Returns a structured diagnostic for unavailable metadata, unsatisfiable
/// constraints, cycles, cancellation, or malformed source candidates.
pub fn resolve_dependencies(
    universe: &dyn PackageUniverse,
    request: &ResolutionRequest,
    cancellation: &CancellationToken,
) -> ResolverResult<ResolvedGraph> {
    let provider = ResolverProvider::new(universe, request, cancellation);
    let root = SolverPackage::Root;
    let root_version = SemanticVersion::parse("0.0.0").map_err(|error| {
        Box::new(
            Diagnostic::new(ErrorCode::InternalFailure, "invalid internal root version")
                .with_cause(error),
        )
    })?;
    let selected = resolve(&provider, root, root_version).map_err(provider_error)?;
    let mut packages = BTreeMap::new();
    for (package, version) in selected {
        let SolverPackage::Package(package) = package else {
            continue;
        };
        let candidate = provider.candidate(&package, &version).map_err(|error| {
            Box::new(
                Diagnostic::new(
                    ErrorCode::InternalFailure,
                    format!("resolved candidate {package} {version} disappeared"),
                )
                .with_cause(error),
            )
        })?;
        packages.insert(
            package,
            ResolvedPackage {
                version,
                dependencies: candidate.dependencies,
            },
        );
    }
    detect_cycle(&packages)?;
    Ok(ResolvedGraph { packages })
}

#[derive(Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
enum SolverPackage {
    Root,
    Package(PackageName),
}

impl Display for SolverPackage {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> fmt::Result {
        match self {
            Self::Root => formatter.write_str("root"),
            Self::Package(package) => package.fmt(formatter),
        }
    }
}

struct ResolverProvider<'a> {
    universe: &'a dyn PackageUniverse,
    request: &'a ResolutionRequest,
    cancellation: &'a CancellationToken,
    candidates: RefCell<BTreeMap<PackageName, Vec<PackageCandidate>>>,
}

impl<'a> ResolverProvider<'a> {
    fn new(
        universe: &'a dyn PackageUniverse,
        request: &'a ResolutionRequest,
        cancellation: &'a CancellationToken,
    ) -> Self {
        Self {
            universe,
            request,
            cancellation,
            candidates: RefCell::new(BTreeMap::new()),
        }
    }

    fn candidates(
        &self,
        package: &PackageName,
    ) -> Result<Vec<PackageCandidate>, ResolverProviderError> {
        if let Some(candidates) = self.candidates.borrow().get(package) {
            return Ok(candidates.clone());
        }
        let mut candidates = self
            .universe
            .candidates(package)
            .map_err(|error| ResolverProviderError(error.to_string()))?;
        candidates.sort_by(|left, right| left.version().cmp(right.version()));
        for pair in candidates.windows(2) {
            if pair[0].version() == pair[1].version() {
                return Err(ResolverProviderError(format!(
                    "package {package} supplies duplicate version {}",
                    pair[0].version()
                )));
            }
        }
        self.candidates
            .borrow_mut()
            .insert(package.clone(), candidates.clone());
        Ok(candidates)
    }

    fn candidate(
        &self,
        package: &PackageName,
        version: &SemanticVersion,
    ) -> Result<PackageCandidate, ResolverProviderError> {
        self.candidates(package)?
            .into_iter()
            .find(|candidate| candidate.version() == version)
            .ok_or_else(|| {
                ResolverProviderError(format!("package {package} has no version {version}"))
            })
    }

    fn requirements(
        &self,
        dependencies: &BTreeMap<PackageName, VersionRequirement>,
    ) -> Result<DependencyConstraints<SolverPackage, Ranges<SemanticVersion>>, ResolverProviderError>
    {
        let mut constraints = DependencyConstraints::default();
        for (package, requirement) in dependencies {
            let range = self
                .candidates(package)?
                .into_iter()
                .filter(|candidate| requirement.matches(candidate.version()))
                .fold(Ranges::empty(), |range, candidate| {
                    range.union(&Ranges::singleton(candidate.version().clone()))
                });
            constraints.insert(SolverPackage::Package(package.clone()), range);
        }
        Ok(constraints)
    }
}

impl DependencyProvider for ResolverProvider<'_> {
    type P = SolverPackage;
    type V = SemanticVersion;
    type VS = Ranges<SemanticVersion>;
    type Priority = std::cmp::Reverse<(usize, SolverPackage)>;
    type M = String;
    type Err = ResolverProviderError;

    fn prioritize(
        &self,
        package: &Self::P,
        range: &Self::VS,
        _: &PackageResolutionStatistics,
    ) -> Self::Priority {
        let candidates = match package {
            SolverPackage::Root => 1,
            SolverPackage::Package(package) => self.candidates(package).map_or(0, |candidates| {
                candidates
                    .iter()
                    .filter(|candidate| range.contains(candidate.version()))
                    .count()
            }),
        };
        std::cmp::Reverse((candidates, package.clone()))
    }

    fn choose_version(
        &self,
        package: &Self::P,
        range: &Self::VS,
    ) -> Result<Option<Self::V>, Self::Err> {
        let SolverPackage::Package(package) = package else {
            return SemanticVersion::parse("0.0.0")
                .map(Some)
                .map_err(|error| ResolverProviderError(error.to_string()));
        };
        let candidates = self.candidates(package)?;
        if let Some(locked) = self.request.locked().get(package) {
            if range.contains(locked)
                && candidates
                    .iter()
                    .any(|candidate| candidate.version() == locked)
            {
                return Ok(Some(locked.clone()));
            }
        }
        Ok(candidates
            .iter()
            .filter(|candidate| range.contains(candidate.version()))
            .map(|candidate| candidate.version().clone())
            .max())
    }

    fn get_dependencies(
        &self,
        package: &Self::P,
        version: &Self::V,
    ) -> Result<Dependencies<Self::P, Self::VS, Self::M>, Self::Err> {
        let dependencies = match package {
            SolverPackage::Root => self.request.direct_dependencies().clone(),
            SolverPackage::Package(package) => self.candidate(package, version)?.dependencies,
        };
        Ok(Dependencies::Available(self.requirements(&dependencies)?))
    }

    fn should_cancel(&self) -> Result<(), Self::Err> {
        self.cancellation
            .check()
            .map_err(|error| ResolverProviderError(error.to_string()))
    }
}

#[derive(Debug)]
struct ResolverProviderError(String);

impl Display for ResolverProviderError {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.0)
    }
}

impl Error for ResolverProviderError {}

fn provider_error(error: PubGrubError<ResolverProvider<'_>>) -> Box<Diagnostic> {
    match error {
        PubGrubError::NoSolution(mut derivation) => {
            derivation.collapse_no_versions();
            Box::new(
                Diagnostic::new(
                    ErrorCode::UserInput,
                    format!(
                        "dependency resolution failed:\n{}",
                        DefaultStringReporter::report(&derivation)
                    ),
                )
                .with_recovery("adjust the incompatible dependency requirements and retry"),
            )
        }
        PubGrubError::ErrorInShouldCancel(error) => Box::new(
            Diagnostic::new(
                ErrorCode::SourceAccess,
                "dependency resolution was cancelled",
            )
            .with_cause(error)
            .with_recovery("retry the operation when ready"),
        ),
        PubGrubError::ErrorChoosingVersion {
            package, source, ..
        }
        | PubGrubError::ErrorRetrievingDependencies {
            package, source, ..
        } => Box::new(
            Diagnostic::new(
                ErrorCode::SourceAccess,
                format!("could not resolve package {package}"),
            )
            .with_package(package.to_string())
            .with_cause(source)
            .with_recovery("check the package source and metadata, then retry"),
        ),
    }
}

fn detect_cycle(packages: &BTreeMap<PackageName, ResolvedPackage>) -> ResolverResult<()> {
    let mut visiting = BTreeSet::new();
    let mut visited = BTreeSet::new();
    let mut path = Vec::new();
    for package in packages.keys() {
        visit(package, packages, &mut visiting, &mut visited, &mut path)?;
    }
    Ok(())
}

fn visit(
    package: &PackageName,
    packages: &BTreeMap<PackageName, ResolvedPackage>,
    visiting: &mut BTreeSet<PackageName>,
    visited: &mut BTreeSet<PackageName>,
    path: &mut Vec<PackageName>,
) -> ResolverResult<()> {
    if visited.contains(package) {
        return Ok(());
    }
    if !visiting.insert(package.clone()) {
        let start = path.iter().position(|item| item == package).unwrap_or(0);
        let cycle = path[start..]
            .iter()
            .chain(std::iter::once(package))
            .map(ToString::to_string)
            .collect::<Vec<_>>()
            .join(" -> ");
        return Err(Box::new(
            Diagnostic::new(ErrorCode::UserInput, format!("dependency cycle: {cycle}"))
                .with_package(package.to_string())
                .with_recovery("remove the cyclic package requirement and retry"),
        ));
    }
    path.push(package.clone());
    if let Some(selected) = packages.get(package) {
        for dependency in selected.dependencies().keys() {
            if packages.contains_key(dependency) {
                visit(dependency, packages, visiting, visited, path)?;
            }
        }
    }
    path.pop();
    visiting.remove(package);
    visited.insert(package.clone());
    Ok(())
}
