//! Transactional reconciliation of a desired package-file map into one project.

use crate::{
    diagnostic::{Diagnostic, ErrorCode, Modification},
    installed_state::{
        DependencyGroup, InstalledPackage, InstalledState, MaterializationStrategy, OwnedFile,
        STATE_FILE_NAME, create_state_directory, state_directory, state_path,
    },
    materialization::{MaterializationPreference, materialize_file},
    operation_lock::AdvisoryLock,
    ownership::{DesiredFile, DesiredFileMap, validate_project_file_conflicts},
    source::CancellationToken,
};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
};

/// Summary of a completed project synchronisation.
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub struct SyncSummary {
    /// Number of desired files copied into the project.
    pub written: usize,
    /// Number of unchanged desired files left untouched.
    pub unchanged: usize,
    /// Number of prior owned files safely removed.
    pub removed: usize,
}

/// Reconciles a desired map into a project through a rollback transaction.
///
/// # Errors
///
/// Returns a diagnostic without leaving a partially valid installed state.
pub fn sync_project(
    project_root: &Path,
    groups: BTreeSet<DependencyGroup>,
    packages: impl IntoIterator<Item = InstalledPackage>,
    desired: &DesiredFileMap,
) -> Result<SyncSummary, Box<Diagnostic>> {
    let cancellation = CancellationToken::new();
    sync_project_with_cancellation(project_root, groups, packages, desired, &cancellation)
}

/// Reconciles a desired map while observing cancellation at transaction-safe boundaries.
///
/// # Errors
///
/// Returns a diagnostic without leaving a partially valid installed state.
pub fn sync_project_with_cancellation(
    project_root: &Path,
    groups: BTreeSet<DependencyGroup>,
    packages: impl IntoIterator<Item = InstalledPackage>,
    desired: &DesiredFileMap,
    cancellation: &CancellationToken,
) -> Result<SyncSummary, Box<Diagnostic>> {
    sync_project_with_preference_and_cancellation(
        project_root,
        groups,
        packages,
        desired,
        MaterializationPreference::Auto,
        cancellation,
    )
}

/// Reconciles a desired map with an explicit materialisation preference.
///
/// # Errors
///
/// Returns a diagnostic when the requested strategy cannot be used safely.
pub fn sync_project_with_preference(
    project_root: &Path,
    groups: BTreeSet<DependencyGroup>,
    packages: impl IntoIterator<Item = InstalledPackage>,
    desired: &DesiredFileMap,
    preference: MaterializationPreference,
) -> Result<SyncSummary, Box<Diagnostic>> {
    let cancellation = CancellationToken::new();
    sync_project_with_preference_and_cancellation(
        project_root,
        groups,
        packages,
        desired,
        preference,
        &cancellation,
    )
}

fn sync_project_with_preference_and_cancellation(
    project_root: &Path,
    groups: BTreeSet<DependencyGroup>,
    packages: impl IntoIterator<Item = InstalledPackage>,
    desired: &DesiredFileMap,
    preference: MaterializationPreference,
    cancellation: &CancellationToken,
) -> Result<SyncSummary, Box<Diagnostic>> {
    let _lock = acquire_project_lock(project_root)?;
    recover_transaction(project_root)?;
    cancellation.check()?;
    let packages = packages.into_iter().collect::<Vec<_>>();
    let previous = read_state(project_root)?;
    let prior_paths = previous.files().keys().cloned().collect::<BTreeSet<_>>();
    validate_project_file_conflicts(project_root, desired, &prior_paths)?;
    let plan = plan(project_root, &previous, desired)?;
    if plan.writes.is_empty() {
        let next = next_state(
            groups.clone(),
            packages.clone(),
            desired,
            &previous,
            &BTreeMap::new(),
        )?;
        if plan.removals.is_empty() && previous == next {
            return Ok(SyncSummary {
                unchanged: desired.files().len(),
                ..SyncSummary::default()
            });
        }
    }
    let state_directory = create_state_directory(project_root)?;
    let staging = state_directory.join(".transaction");
    fs::create_dir(&staging)
        .map_err(|error| internal("could not create project transaction staging", error))?;
    let strategies = match stage_files(&staging, &plan, preference, cancellation) {
        Ok(strategies) => strategies,
        Err(error) => {
            let _ = fs::remove_dir_all(&staging);
            return Err(error);
        }
    };
    let next = next_state(groups, packages, desired, &previous, &strategies)?;
    if let Err(error) = stage_state(&staging, &next, cancellation) {
        let _ = fs::remove_dir_all(&staging);
        return Err(error);
    }
    if let Err(error) = cancellation.check() {
        let _ = fs::remove_dir_all(&staging);
        return Err(error);
    }
    if let Err(error) = commit(project_root, &staging, &plan) {
        let _ = recover_transaction(project_root);
        return Err(Box::new(
            (*error).with_modification(Modification::Staged(staging)),
        ));
    }
    fs::remove_dir_all(&staging)
        .map_err(|error| internal("could not clean completed transaction", error))?;
    if cancellation.is_cancelled() {
        return Err(Box::new(
            Diagnostic::new(
                ErrorCode::SourceAccess,
                "operation was cancelled after its transactional commit completed",
            )
            .with_modification(Modification::Applied(project_root.to_path_buf()))
            .with_recovery("the project was fully synchronised; rerun the command to inspect it"),
        ));
    }
    Ok(SyncSummary {
        written: plan.writes.len(),
        unchanged: desired.files().len() - plan.writes.len(),
        removed: plan.removals.len(),
    })
}

fn acquire_project_lock(project_root: &Path) -> Result<AdvisoryLock, Box<Diagnostic>> {
    let state_directory = create_state_directory(project_root)?;
    AdvisoryLock::try_acquire(&state_directory.join("mutation.lock"), "this project")
}

#[derive(Default)]
struct SyncPlan {
    writes: BTreeMap<PathBuf, DesiredFile>,
    removals: BTreeSet<PathBuf>,
}

fn read_state(project_root: &Path) -> Result<InstalledState, Box<Diagnostic>> {
    let path = state_path(project_root);
    match fs::read_to_string(&path) {
        Ok(input) => InstalledState::parse(&path, &input),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            InstalledState::new(BTreeSet::new(), [], [])
        }
        Err(error) => Err(internal("could not read installed state", error)),
    }
}

fn next_state(
    groups: BTreeSet<DependencyGroup>,
    packages: Vec<InstalledPackage>,
    desired: &DesiredFileMap,
    previous: &InstalledState,
    strategies: &BTreeMap<PathBuf, MaterializationStrategy>,
) -> Result<InstalledState, Box<Diagnostic>> {
    let files = desired
        .files()
        .values()
        .map(|file| {
            let strategy = strategies
                .get(file.path())
                .copied()
                .or_else(|| {
                    previous
                        .files()
                        .get(file.path())
                        .map(OwnedFile::materialization)
                })
                .unwrap_or(MaterializationStrategy::Copy);
            OwnedFile::new(
                file.path(),
                file.owners().clone(),
                file.sha256().to_owned(),
                strategy,
            )
        })
        .collect::<Result<Vec<_>, _>>()?;
    InstalledState::new(groups, packages, files)
}

fn plan(
    project_root: &Path,
    previous: &InstalledState,
    desired: &DesiredFileMap,
) -> Result<SyncPlan, Box<Diagnostic>> {
    let mut plan = SyncPlan::default();
    for (path, desired_file) in desired.files() {
        let destination = project_root.join(path);
        let current = file_hash(&destination).ok();
        if current.as_deref() != Some(desired_file.sha256()) {
            if previous.files().get(path).is_some_and(|previous_file| {
                current
                    .as_deref()
                    .is_some_and(|hash| hash != previous_file.sha256())
            }) {
                return Err(Box::new(
                    Diagnostic::new(
                        ErrorCode::UserInput,
                        format!(
                            "previously package-owned file was modified: {}",
                            path.display()
                        ),
                    )
                    .with_recovery(
                        "restore the recorded package file or move the edit before synchronising",
                    ),
                ));
            }
            plan.writes.insert(path.clone(), desired_file.clone());
        }
    }
    for (path, file) in previous.files() {
        if desired.files().contains_key(path) {
            continue;
        }
        if file_hash(&project_root.join(path)).ok().as_deref() == Some(file.sha256()) {
            plan.removals.insert(path.clone());
        }
    }
    Ok(plan)
}

fn stage_files(
    staging: &Path,
    plan: &SyncPlan,
    preference: MaterializationPreference,
    cancellation: &CancellationToken,
) -> Result<BTreeMap<PathBuf, MaterializationStrategy>, Box<Diagnostic>> {
    cancellation.check()?;
    Journal::create(staging)?;
    let mut strategies = BTreeMap::new();
    for (path, file) in &plan.writes {
        cancellation.check()?;
        #[cfg(test)]
        interrupt_if_requested(InterruptionPoint::FileStaging)?;
        let staged = staging.join("files").join(path);
        let parent = staged
            .parent()
            .ok_or_else(|| internal("staged file has no parent", "invalid path"))?;
        fs::create_dir_all(parent)
            .map_err(|error| internal("could not create staged directory", error))?;
        let strategy = materialize_file(file.source_path(), &staged, preference)?;
        #[cfg(unix)]
        set_executable(&staged, file.executable())?;
        strategies.insert(path.clone(), strategy);
    }
    Ok(strategies)
}

fn stage_state(
    staging: &Path,
    next: &InstalledState,
    cancellation: &CancellationToken,
) -> Result<(), Box<Diagnostic>> {
    cancellation.check()?;
    #[cfg(test)]
    interrupt_if_requested(InterruptionPoint::StateFileWrite)?;
    let state = staging.join(STATE_FILE_NAME);
    fs::File::create(&state)
        .and_then(|mut file| {
            file.write_all(next.to_toml().as_bytes())
                .and_then(|()| file.sync_all())
        })
        .map_err(|error| internal("could not stage installed state", error))?;
    Ok(())
}

fn commit(project_root: &Path, staging: &Path, plan: &SyncPlan) -> Result<(), Box<Diagnostic>> {
    let rollback = staging.join("rollback");
    let journal = Journal::open(staging)?;
    for path in plan.writes.keys().chain(plan.removals.iter()) {
        let destination = project_root.join(path);
        if fs::symlink_metadata(&destination).is_ok() {
            journal.record_moved(path)?;
            move_to_rollback(project_root, &rollback, path)?;
        }
    }
    for (path, file) in &plan.writes {
        let destination = project_root.join(path);
        let parent = destination
            .parent()
            .ok_or_else(|| internal("destination has no parent", "invalid path"))?;
        fs::create_dir_all(parent)
            .map_err(|error| internal("could not create project directory", error))?;
        journal.record_written(path, file.sha256())?;
        fs::rename(staging.join("files").join(path), &destination)
            .map_err(|error| internal("could not publish staged project file", error))?;
    }
    #[cfg(test)]
    interrupt_if_requested(InterruptionPoint::ProjectCommit)?;
    let state = Path::new(".wukong").join(STATE_FILE_NAME);
    if fs::symlink_metadata(state_path(project_root)).is_ok() {
        journal.record_moved(&state)?;
        move_to_rollback(project_root, &rollback, &state)?;
    }
    let state_sha256 = file_hash(&staging.join(STATE_FILE_NAME))
        .map_err(|error| internal("could not hash staged installed state", error))?;
    journal.record_written(&state, &state_sha256)?;
    fs::rename(staging.join(STATE_FILE_NAME), state_path(project_root))
        .map_err(|error| internal("could not publish installed state", error))?;
    journal.complete()?;
    Ok(())
}

fn move_to_rollback(
    project_root: &Path,
    rollback: &Path,
    path: &Path,
) -> Result<(), Box<Diagnostic>> {
    let target = rollback.join(path);
    fs::create_dir_all(
        target
            .parent()
            .ok_or_else(|| internal("rollback path has no parent", "invalid path"))?,
    )
    .map_err(|error| internal("could not create rollback directory", error))?;
    fs::rename(project_root.join(path), target)
        .map_err(|error| internal("could not back up project file", error))?;
    #[cfg(test)]
    interrupt_if_requested(InterruptionPoint::StaleFileRemoval)?;
    Ok(())
}

fn recover_transaction(project_root: &Path) -> Result<(), Box<Diagnostic>> {
    let transaction = state_directory(project_root).join(".transaction");
    let journal_path = transaction.join("journal");
    let journal = match fs::read_to_string(&journal_path) {
        Ok(input) => Journal::parse(&input)?,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            if fs::symlink_metadata(&transaction).is_ok() {
                fs::remove_dir_all(&transaction)
                    .map_err(|error| internal("could not clean unstarted transaction", error))?;
            }
            return Ok(());
        }
        Err(error) => return Err(internal("could not read transaction journal", error)),
    };
    if journal.complete {
        fs::remove_dir_all(&transaction)
            .map_err(|error| internal("could not clean completed transaction", error))?;
        return Ok(());
    }
    for written in journal.written.iter().rev() {
        remove_written_output(project_root, written)?;
    }
    for path in journal.moved.iter().rev() {
        let source = transaction.join("rollback").join(path);
        if fs::symlink_metadata(&source).is_ok() {
            let destination = project_root.join(path);
            if let Some(parent) = destination.parent() {
                fs::create_dir_all(parent)
                    .map_err(|error| internal("could not restore rollback directory", error))?;
            }
            fs::rename(source, destination)
                .map_err(|error| internal("could not restore project file", error))?;
        }
    }
    fs::remove_dir_all(&transaction)
        .map_err(|error| internal("could not clean recovered transaction", error))
}

fn remove_written_output(
    project_root: &Path,
    written: &WrittenPath,
) -> Result<(), Box<Diagnostic>> {
    let destination = project_root.join(&written.path);
    let metadata = match fs::symlink_metadata(&destination) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(internal("could not inspect transaction file", error)),
    };
    if !metadata.file_type().is_file() {
        return Err(recovery_refusal(
            &written.path,
            "the transaction output is no longer a regular file",
        ));
    }
    let expected = written.expected_sha256.as_deref().ok_or_else(|| {
        recovery_refusal(
            &written.path,
            "the interrupted transaction uses a legacy journal without output hashes",
        )
    })?;
    let current = file_hash(&destination)
        .map_err(|error| internal("could not verify transaction output", error))?;
    if current != expected {
        return Err(recovery_refusal(
            &written.path,
            "the transaction output changed after the interrupted operation",
        ));
    }
    fs::remove_file(&destination)
        .map_err(|error| internal("could not remove verified transaction output", error))
}

fn recovery_refusal(path: &Path, reason: &str) -> Box<Diagnostic> {
    Box::new(
        Diagnostic::new(
            ErrorCode::UserInput,
            format!("refusing transaction recovery for {}: {reason}", path.display()),
        )
        .with_recovery(
            "preserve the current file, inspect .wukong/.transaction, then restore or remove it manually",
        ),
    )
}

#[derive(Default)]
struct Journal {
    moved: Vec<PathBuf>,
    written: Vec<WrittenPath>,
    complete: bool,
    path: PathBuf,
}

struct WrittenPath {
    path: PathBuf,
    expected_sha256: Option<String>,
}

impl Journal {
    fn create(staging: &Path) -> Result<(), Box<Diagnostic>> {
        let path = staging.join("journal");
        fs::File::create(&path)
            .and_then(|mut file| file.write_all(b"v2\n").and_then(|()| file.sync_all()))
            .map_err(|error| internal("could not create transaction journal", error))
    }
    fn open(staging: &Path) -> Result<Self, Box<Diagnostic>> {
        let mut journal = Self::parse(
            &fs::read_to_string(staging.join("journal"))
                .map_err(|error| internal("could not read transaction journal", error))?,
        )?;
        journal.path = staging.join("journal");
        Ok(journal)
    }
    fn parse(input: &str) -> Result<Self, Box<Diagnostic>> {
        let mut lines = input.lines();
        let version = lines.next();
        if !matches!(version, Some("v1" | "v2")) {
            return Err(Box::new(
                Diagnostic::new(ErrorCode::InternalFailure, "transaction journal is invalid")
                    .with_recovery("restore the project from backup before retrying"),
            ));
        }
        let mut journal = Self::default();
        for line in lines {
            let Some((kind, value)) = line.split_once(' ') else {
                continue;
            };
            let path = safe_journal_path(value)?;
            match kind {
                "moved" => journal.moved.push(path),
                "written" => {
                    let written = match version {
                        Some("v1") => WrittenPath {
                            path,
                            expected_sha256: None,
                        },
                        Some("v2") => {
                            let (sha256, path) = value.split_once(' ').ok_or_else(|| {
                                Box::new(
                                    Diagnostic::new(
                                        ErrorCode::InternalFailure,
                                        "transaction journal is invalid",
                                    )
                                    .with_recovery(
                                        "restore the project from backup before retrying",
                                    ),
                                )
                            })?;
                            if !valid_sha256(sha256) {
                                return Err(Box::new(
                                    Diagnostic::new(
                                        ErrorCode::InternalFailure,
                                        "transaction journal is invalid",
                                    )
                                    .with_recovery(
                                        "restore the project from backup before retrying",
                                    ),
                                ));
                            }
                            WrittenPath {
                                path: safe_journal_path(path)?,
                                expected_sha256: Some(sha256.to_owned()),
                            }
                        }
                        _ => unreachable!("transaction version was validated"),
                    };
                    journal.written.push(written);
                }
                "complete" if value.is_empty() => journal.complete = true,
                _ => {
                    return Err(Box::new(
                        Diagnostic::new(
                            ErrorCode::InternalFailure,
                            "transaction journal is invalid",
                        )
                        .with_recovery("restore the project from backup before retrying"),
                    ));
                }
            }
        }
        Ok(journal)
    }
    fn record_moved(&self, path: &Path) -> Result<(), Box<Diagnostic>> {
        self.append("moved", path)
    }
    fn record_written(&self, path: &Path, sha256: &str) -> Result<(), Box<Diagnostic>> {
        let path = path.to_string_lossy().replace('\\', "/");
        self.append_line(&format!("written {sha256} {path}\n"))
    }
    fn complete(&self) -> Result<(), Box<Diagnostic>> {
        self.append("complete", Path::new(""))
    }
    fn append(&self, kind: &str, path: &Path) -> Result<(), Box<Diagnostic>> {
        let value = path.to_string_lossy().replace('\\', "/");
        let line = if kind == "complete" {
            "complete \n".to_owned()
        } else {
            format!("{kind} {value}\n")
        };
        self.append_line(&line)
    }

    fn append_line(&self, line: &str) -> Result<(), Box<Diagnostic>> {
        fs::OpenOptions::new()
            .append(true)
            .open(&self.path)
            .and_then(|mut file| {
                file.write_all(line.as_bytes())
                    .and_then(|()| file.sync_all())
            })
            .map_err(|error| internal("could not update transaction journal", error))
    }
}

fn safe_journal_path(value: &str) -> Result<PathBuf, Box<Diagnostic>> {
    let path = Path::new(value);
    if value.is_empty() {
        return Ok(PathBuf::new());
    }
    if path.is_absolute()
        || path
            .components()
            .any(|part| !matches!(part, std::path::Component::Normal(_)))
    {
        return Err(Box::new(
            Diagnostic::new(
                ErrorCode::InternalFailure,
                "transaction journal contains an unsafe path",
            )
            .with_recovery("restore the project from backup before retrying"),
        ));
    }
    Ok(path.to_path_buf())
}

fn valid_sha256(value: &str) -> bool {
    value.len() == 64 && value.bytes().all(|byte| byte.is_ascii_hexdigit())
}

fn file_hash(path: &Path) -> Result<String, std::io::Error> {
    let mut input = fs::File::open(path)?;
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 8192];
    loop {
        let read = input.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

#[cfg(unix)]
fn set_executable(path: &Path, executable: bool) -> Result<(), Box<Diagnostic>> {
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(
        path,
        fs::Permissions::from_mode(if executable { 0o755 } else { 0o644 }),
    )
    .map_err(|error| internal("could not set staged package permissions", error))
}
fn internal(message: &str, error: impl std::fmt::Display) -> Box<Diagnostic> {
    Box::new(
        Diagnostic::new(ErrorCode::InternalFailure, message)
            .with_cause(error)
            .with_recovery("check project permissions and retry"),
    )
}

#[cfg(test)]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum InterruptionPoint {
    FileStaging,
    ProjectCommit,
    StateFileWrite,
    StaleFileRemoval,
}

#[cfg(test)]
thread_local! {
    static INTERRUPTION_POINT: std::cell::Cell<Option<InterruptionPoint>> = const { std::cell::Cell::new(None) };
}

#[cfg(test)]
fn interrupt_if_requested(point: InterruptionPoint) -> Result<(), Box<Diagnostic>> {
    let interrupted = INTERRUPTION_POINT.with(|requested| {
        if requested.get() == Some(point) {
            requested.set(None);
            true
        } else {
            false
        }
    });
    if interrupted {
        Err(Box::new(
            Diagnostic::new(
                ErrorCode::InternalFailure,
                format!("simulated interruption during {point:?}"),
            )
            .with_recovery("retry; the interrupted transaction was rolled back"),
        ))
    } else {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::{
        INTERRUPTION_POINT, InterruptionPoint, file_hash, recover_transaction, sync_project,
    };
    use crate::{
        identity::PackageName,
        installed_state::{DependencyGroup, InstalledPackage, state_path},
        ownership::{PackageMaterialization, build_desired_file_map},
        package_tree::{PreparedPackageTree, prepare_package_tree},
        source::ImmutableSourceId,
    };
    use std::{collections::BTreeSet, fs, path::Path};
    use tempfile::TempDir;

    #[test]
    fn invariant_hashed_interrupted_transaction_recovers_the_previous_file() {
        let fixture = TempDir::new().expect("fixture should exist");
        let project = fixture.path().join("project");
        let transaction = project.join(".wukong/.transaction");
        write(&project.join("addons/alpha/plugin.gd"), "new");
        let hash = file_hash(&project.join("addons/alpha/plugin.gd"))
            .expect("transaction output should hash");
        write(&transaction.join("rollback/addons/alpha/plugin.gd"), "old");
        write(
            &transaction.join("journal"),
            &format!("v2\nmoved addons/alpha/plugin.gd\nwritten {hash} addons/alpha/plugin.gd\n"),
        );

        recover_transaction(&project).expect("recovery should work");

        assert_eq!(
            fs::read_to_string(project.join("addons/alpha/plugin.gd"))
                .expect("file should restore"),
            "old"
        );
        assert!(!transaction.exists());
    }

    #[test]
    fn invariant_recovery_preserves_a_file_changed_after_interruption() {
        let fixture = TempDir::new().expect("fixture should exist");
        let project = fixture.path().join("project");
        let transaction = project.join(".wukong/.transaction");
        write(&project.join("addons/alpha/plugin.gd"), "user edit");
        write(&transaction.join("rollback/addons/alpha/plugin.gd"), "old");
        let expected = "new";
        let expected_path = fixture.path().join("expected");
        write(&expected_path, expected);
        let hash = file_hash(&expected_path).expect("expected content should hash");
        write(
            &transaction.join("journal"),
            &format!("v2\nmoved addons/alpha/plugin.gd\nwritten {hash} addons/alpha/plugin.gd\n"),
        );

        let error = recover_transaction(&project)
            .expect_err("recovery must not remove a concurrent user edit");

        assert_eq!(error.code(), crate::diagnostic::ErrorCode::UserInput);
        assert_eq!(
            fs::read_to_string(project.join("addons/alpha/plugin.gd"))
                .expect("user file should remain"),
            "user edit"
        );
        assert!(transaction.exists());
        assert_eq!(
            fs::read_to_string(transaction.join("rollback/addons/alpha/plugin.gd"))
                .expect("rollback file should remain"),
            "old"
        );
    }

    #[test]
    fn invariant_legacy_transaction_recovery_refuses_unverified_removal() {
        let fixture = TempDir::new().expect("fixture should exist");
        let project = fixture.path().join("project");
        let transaction = project.join(".wukong/.transaction");
        write(&project.join("addons/alpha/plugin.gd"), "new");
        write(&transaction.join("rollback/addons/alpha/plugin.gd"), "old");
        write(
            &transaction.join("journal"),
            "v1\nmoved addons/alpha/plugin.gd\nwritten addons/alpha/plugin.gd\n",
        );

        let error = recover_transaction(&project)
            .expect_err("legacy recovery must not remove an unverified file");

        assert!(error.message().contains("legacy journal"));
        assert_eq!(
            fs::read_to_string(project.join("addons/alpha/plugin.gd"))
                .expect("current file should remain"),
            "new"
        );
        assert!(transaction.exists());
    }

    #[test]
    fn invariant_completed_transaction_keeps_the_new_state() {
        let fixture = TempDir::new().expect("fixture should exist");
        let project = fixture.path().join("project");
        let transaction = project.join(".wukong/.transaction");
        write(&project.join("addons/alpha/plugin.gd"), "new");
        write(&transaction.join("journal"), "v1\ncomplete \n");

        recover_transaction(&project).expect("cleanup should work");

        assert_eq!(
            fs::read_to_string(project.join("addons/alpha/plugin.gd"))
                .expect("new file should remain"),
            "new"
        );
        assert!(!transaction.exists());
    }

    #[test]
    fn invariant_interruption_during_file_staging_leaves_project_unchanged() {
        let fixture = SyncFixture::new();
        let package = fixture.package("first");
        let interruption = Interruption::at(InterruptionPoint::FileStaging);

        assert!(
            sync_project(
                fixture.project(),
                groups(),
                [package.installed.clone()],
                &package.desired(),
            )
            .is_err()
        );

        drop(interruption);
        assert!(!fixture.project().join("addons/alpha/plugin.gd").exists());
        assert!(!fixture.project().join(".wukong/.transaction").exists());
    }

    #[test]
    fn invariant_interruption_during_project_commit_recovers_prior_files_and_state() {
        let fixture = SyncFixture::new();
        let first = fixture.package("first");
        sync_project(
            fixture.project(),
            groups(),
            [first.installed.clone()],
            &first.desired(),
        )
        .expect("initial sync should work");
        let state = fs::read(state_path(fixture.project())).expect("state should read");
        let second = fixture.package("second");
        let interruption = Interruption::at(InterruptionPoint::ProjectCommit);

        assert!(
            sync_project(
                fixture.project(),
                groups(),
                [second.installed.clone()],
                &second.desired(),
            )
            .is_err()
        );

        drop(interruption);
        assert_eq!(
            fs::read_to_string(fixture.project().join("addons/alpha/plugin.gd"))
                .expect("prior file should restore"),
            "first"
        );
        assert_eq!(
            fs::read(state_path(fixture.project())).expect("state should restore"),
            state
        );
        assert!(!fixture.project().join(".wukong/.transaction").exists());
    }

    #[test]
    fn invariant_interruption_during_state_write_leaves_prior_files_and_state_unchanged() {
        let fixture = SyncFixture::new();
        let first = fixture.package("first");
        sync_project(
            fixture.project(),
            groups(),
            [first.installed.clone()],
            &first.desired(),
        )
        .expect("initial sync should work");
        let state = fs::read(state_path(fixture.project())).expect("state should read");
        let second = fixture.package("second");
        let interruption = Interruption::at(InterruptionPoint::StateFileWrite);

        assert!(
            sync_project(
                fixture.project(),
                groups(),
                [second.installed.clone()],
                &second.desired(),
            )
            .is_err()
        );

        drop(interruption);
        assert_eq!(
            fs::read_to_string(fixture.project().join("addons/alpha/plugin.gd"))
                .expect("prior file should remain"),
            "first"
        );
        assert_eq!(
            fs::read(state_path(fixture.project())).expect("state should remain"),
            state
        );
        assert!(!fixture.project().join(".wukong/.transaction").exists());
    }

    #[test]
    fn invariant_interruption_during_stale_removal_restores_the_owned_file() {
        let fixture = SyncFixture::new();
        let first = fixture.package("first");
        sync_project(
            fixture.project(),
            groups(),
            [first.installed.clone()],
            &first.desired(),
        )
        .expect("initial sync should work");
        let state = fs::read(state_path(fixture.project())).expect("state should read");
        let interruption = Interruption::at(InterruptionPoint::StaleFileRemoval);

        assert!(
            sync_project(
                fixture.project(),
                groups(),
                [],
                &crate::ownership::DesiredFileMap::default(),
            )
            .is_err()
        );

        drop(interruption);
        assert_eq!(
            fs::read_to_string(fixture.project().join("addons/alpha/plugin.gd"))
                .expect("owned file should restore"),
            "first"
        );
        assert_eq!(
            fs::read(state_path(fixture.project())).expect("state should remain"),
            state
        );
        assert!(!fixture.project().join(".wukong/.transaction").exists());
    }

    fn groups() -> BTreeSet<DependencyGroup> {
        BTreeSet::from([DependencyGroup::Dependencies])
    }

    struct Interruption;
    impl Interruption {
        fn at(point: InterruptionPoint) -> Self {
            INTERRUPTION_POINT.with(|requested| requested.set(Some(point)));
            Self
        }
    }
    impl Drop for Interruption {
        fn drop(&mut self) {
            INTERRUPTION_POINT.with(|requested| requested.set(None));
        }
    }

    struct SyncFixture {
        directory: TempDir,
        project: std::path::PathBuf,
    }
    impl SyncFixture {
        fn new() -> Self {
            let directory = TempDir::new().expect("fixture should exist");
            let project = directory.path().join("project");
            fs::create_dir(&project).expect("project should create");
            Self { directory, project }
        }
        fn project(&self) -> &Path {
            &self.project
        }
        fn package(&self, content: &str) -> PackageFixture {
            let source = self.directory.path().join(format!("source-{content}"));
            fs::create_dir_all(&source).expect("source should create");
            fs::write(source.join("plugin.gd"), content).expect("source should write");
            let tree = prepare_package_tree(
                &source,
                &self.directory.path().join(format!("prepared-{content}")),
            )
            .expect("tree should prepare");
            let name = PackageName::parse("alpha").expect("name should parse");
            let installed = InstalledPackage::new(
                name.clone(),
                ImmutableSourceId::new(format!("sha256:{}", tree.sha256()))
                    .expect("source should parse"),
                tree.sha256().to_owned(),
            )
            .expect("package should parse");
            PackageFixture {
                name,
                tree,
                installed,
            }
        }
    }

    struct PackageFixture {
        name: PackageName,
        tree: PreparedPackageTree,
        installed: InstalledPackage,
    }
    impl PackageFixture {
        fn desired(&self) -> crate::ownership::DesiredFileMap {
            build_desired_file_map([PackageMaterialization::new(
                &self.name,
                &self.tree,
                Path::new("addons/alpha"),
            )])
            .expect("desired map should build")
        }
    }

    fn write(path: &std::path::Path, content: &str) {
        fs::create_dir_all(path.parent().expect("parent should exist"))
            .expect("parent should create");
        fs::write(path, content).expect("file should write");
    }
}
