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
    name: Option<PackageName>,
    version: SemanticVersion,
    dependencies: BTreeMap<PackageName, VersionRequirement>,
}

impl PackageCandidate {
    /// Creates an unbound candidate with canonical version identity.
    ///
    /// [`InMemoryPackageUniverse::add_candidate`] binds it to the supplied
    /// package. Source adapters should use [`Self::for_package`] or
    /// [`Self::load_required`] so resolver selection can verify identity.
    #[must_use]
    pub fn new(
        version: &SemanticVersion,
        dependencies: BTreeMap<PackageName, VersionRequirement>,
    ) -> Self {
        Self {
            name: None,
            version: version.without_build_metadata(),
            dependencies,
        }
    }

    /// Creates a candidate bound to one canonical package name.
    #[must_use]
    pub fn for_package(
        package: PackageName,
        version: &SemanticVersion,
        dependencies: BTreeMap<PackageName, VersionRequirement>,
    ) -> Self {
        Self {
            name: Some(package),
            version: version.without_build_metadata(),
            dependencies,
        }
    }

    /// Reads a required candidate from package-owned metadata.
    ///
    /// # Errors
    ///
    /// Returns metadata parsing or I/O diagnostics, an integrity diagnostic for
    /// a metadata-name mismatch, and a user diagnostic when metadata is absent.
    pub fn load_required(package: &PackageName, package_root: &Path) -> ResolverResult<Self> {
        let metadata = PackageMetadata::load_required(package_root)
            .map_err(|error| Box::new((*error).with_package(package.as_str())))?;
        let candidate = Self::for_package(
            metadata.name().clone(),
            metadata.version(),
            metadata.dependencies().clone(),
        );
        candidate.bind_to(package)
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

    fn bind_to(mut self, package: &PackageName) -> ResolverResult<Self> {
        if self.name.is_none() {
            self.name = Some(package.clone());
        }
        validate_candidate_identity(package, &self)?;
        Ok(self)
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
        let candidate = candidate.bind_to(&package)?;
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
    runtime_roots: BTreeSet<PackageName>,
    development_roots: BTreeSet<PackageName>,
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
        self.require_runtime(package, requirement);
    }

    /// Adds a direct runtime requirement.
    pub fn require_runtime(&mut self, package: PackageName, requirement: VersionRequirement) {
        self.runtime_roots.insert(package.clone());
        self.direct_dependencies.insert(package, requirement);
    }

    /// Adds a direct development requirement.
    pub fn require_development(&mut self, package: PackageName, requirement: VersionRequirement) {
        self.development_roots.insert(package.clone());
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

    /// Returns direct runtime package roots in deterministic name order.
    #[must_use]
    pub const fn runtime_roots(&self) -> &BTreeSet<PackageName> {
        &self.runtime_roots
    }

    /// Returns direct development package roots in deterministic name order.
    #[must_use]
    pub const fn development_roots(&self) -> &BTreeSet<PackageName> {
        &self.development_roots
    }

    /// Returns preferred locked versions in deterministic name order.
    #[must_use]
    pub const fn locked(&self) -> &BTreeMap<PackageName, SemanticVersion> {
        &self.locked
    }
}

/// The selected group closure for a resolved package.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ResolvedDependencyGroup {
    /// Reachable from at least one direct runtime root.
    Runtime,
    /// Reachable only from direct development roots.
    Development,
}

/// One selected package in a resolved graph.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ResolvedPackage {
    version: SemanticVersion,
    dependencies: BTreeMap<PackageName, VersionRequirement>,
    group: ResolvedDependencyGroup,
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

    /// Returns the package's deterministic runtime or development-only group.
    #[must_use]
    pub const fn group(&self) -> ResolvedDependencyGroup {
        self.group
    }

    /// Returns whether the package belongs only to the development closure.
    #[must_use]
    pub const fn is_development(&self) -> bool {
        matches!(self.group, ResolvedDependencyGroup::Development)
    }
}

/// A complete deterministic selection of transitive packages.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ResolvedGraph {
    packages: BTreeMap<PackageName, ResolvedPackage>,
    runtime_roots: BTreeSet<PackageName>,
    development_roots: BTreeSet<PackageName>,
}

impl ResolvedGraph {
    /// Returns selected packages in deterministic name order.
    #[must_use]
    pub const fn packages(&self) -> &BTreeMap<PackageName, ResolvedPackage> {
        &self.packages
    }

    /// Returns selected direct runtime roots in deterministic name order.
    #[must_use]
    pub const fn runtime_roots(&self) -> &BTreeSet<PackageName> {
        &self.runtime_roots
    }

    /// Returns selected direct development roots in deterministic name order.
    #[must_use]
    pub const fn development_roots(&self) -> &BTreeSet<PackageName> {
        &self.development_roots
    }

    /// Returns selected package names for runtime-only or development-inclusive work.
    #[must_use]
    pub fn package_names(&self, include_development: bool) -> Vec<&PackageName> {
        self.packages
            .iter()
            .filter(|(_, package)| include_development || !package.is_development())
            .map(|(name, _)| name)
            .collect()
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
                group: ResolvedDependencyGroup::Runtime,
            },
        );
    }
    detect_cycle(&packages)?;
    let runtime_roots = request
        .runtime_roots()
        .iter()
        .filter(|name| packages.contains_key(*name))
        .cloned()
        .collect();
    let development_roots = request
        .development_roots()
        .iter()
        .filter(|name| packages.contains_key(*name))
        .cloned()
        .collect();
    classify_groups(&mut packages, &runtime_roots, &development_roots);
    Ok(ResolvedGraph {
        packages,
        runtime_roots,
        development_roots,
    })
}

fn classify_groups(
    packages: &mut BTreeMap<PackageName, ResolvedPackage>,
    runtime_roots: &BTreeSet<PackageName>,
    development_roots: &BTreeSet<PackageName>,
) {
    let runtime = reachable_packages(packages, runtime_roots);
    let development = reachable_packages(packages, development_roots);
    for (name, package) in packages {
        package.group = if development.contains(name) && !runtime.contains(name) {
            ResolvedDependencyGroup::Development
        } else {
            ResolvedDependencyGroup::Runtime
        };
    }
}

fn reachable_packages(
    packages: &BTreeMap<PackageName, ResolvedPackage>,
    roots: &BTreeSet<PackageName>,
) -> BTreeSet<PackageName> {
    let mut reachable = BTreeSet::new();
    let mut pending = roots.iter().cloned().collect::<Vec<_>>();
    while let Some(name) = pending.pop() {
        if !reachable.insert(name.clone()) {
            continue;
        }
        if let Some(package) = packages.get(&name) {
            pending.extend(package.dependencies.keys().cloned());
        }
    }
    reachable
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
            .map_err(ResolverProviderError::from_diagnostic)?;
        for candidate in &candidates {
            validate_candidate_identity(package, candidate)
                .map_err(ResolverProviderError::from_diagnostic)?;
        }
        candidates.sort_by(|left, right| left.version().cmp(right.version()));
        for pair in candidates.windows(2) {
            if pair[0].version() == pair[1].version() {
                return Err(ResolverProviderError::from_diagnostic(Box::new(
                    Diagnostic::new(
                        ErrorCode::IntegrityFailure,
                        format!(
                            "package {package} supplies duplicate version {}",
                            pair[0].version()
                        ),
                    )
                    .with_package(package.as_str())
                    .with_recovery(
                        "make each immutable source candidate use one canonical version",
                    ),
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
                ResolverProviderError::from_diagnostic(Box::new(
                    Diagnostic::new(
                        ErrorCode::SourceAccess,
                        format!("package {package} has no version {version}"),
                    )
                    .with_package(package.as_str())
                    .with_recovery("check the package source and metadata, then retry"),
                ))
            })
    }

    fn requirements(
        &self,
        dependencies: &BTreeMap<PackageName, VersionRequirement>,
    ) -> Result<DependencyConstraints<SolverPackage, Ranges<SemanticVersion>>, ResolverProviderError>
    {
        let mut constraints = DependencyConstraints::default();
        for (package, requirement) in dependencies {
            let candidates = self.candidates(package)?;
            let mut matching = candidates
                .iter()
                .filter(|candidate| requirement.matches(candidate.version()));
            let Some(first) = matching.next() else {
                return Err(ResolverProviderError::from_diagnostic(Box::new(
                    Diagnostic::new(
                        ErrorCode::UserInput,
                        format!("package {package} has no candidate satisfying {requirement}"),
                    )
                    .with_package(package.as_str())
                    .with_recovery("add a reviewed compatible candidate or adjust the requirement"),
                )));
            };
            let range = matching.fold(
                Ranges::singleton(first.version().clone()),
                |range, candidate| range.union(&Ranges::singleton(candidate.version().clone())),
            );
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
            return SemanticVersion::parse("0.0.0").map(Some).map_err(|error| {
                ResolverProviderError::from_diagnostic(Box::new(
                    Diagnostic::new(
                        ErrorCode::InternalFailure,
                        "could not construct the root resolver version",
                    )
                    .with_cause(error)
                    .with_recovery("report this as a wukong bug"),
                ))
            });
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
            .map_err(ResolverProviderError::from_diagnostic)
    }
}

#[derive(Debug)]
struct ResolverProviderError(Box<Diagnostic>);

impl ResolverProviderError {
    fn from_diagnostic(diagnostic: Box<Diagnostic>) -> Self {
        Self(diagnostic)
    }

    fn into_diagnostic(self) -> Box<Diagnostic> {
        self.0
    }
}

impl Display for ResolverProviderError {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> fmt::Result {
        self.0.fmt(formatter)
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
        PubGrubError::ErrorInShouldCancel(_) => Box::new(
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
        } => package_diagnostic(&package, source.into_diagnostic()),
    }
}

fn validate_candidate_identity(
    package: &PackageName,
    candidate: &PackageCandidate,
) -> ResolverResult<()> {
    match candidate.name.as_ref() {
        Some(name) if name == package => Ok(()),
        Some(name) => Err(Box::new(
            Diagnostic::new(
                ErrorCode::IntegrityFailure,
                format!(
                    "resolver candidate metadata name {name} does not match requested package {package}"
                ),
            )
            .with_package(package.as_str())
            .with_recovery("correct package.name before resolving"),
        )),
        None => Err(Box::new(
            Diagnostic::new(
                ErrorCode::IntegrityFailure,
                format!("resolver candidate for package {package} has no metadata identity"),
            )
            .with_package(package.as_str())
            .with_recovery("construct candidates from validated package metadata"),
        )),
    }
}

fn package_diagnostic(package: &SolverPackage, diagnostic: Box<Diagnostic>) -> Box<Diagnostic> {
    if diagnostic.package().is_some() {
        diagnostic
    } else {
        Box::new((*diagnostic).with_package(package.to_string()))
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
