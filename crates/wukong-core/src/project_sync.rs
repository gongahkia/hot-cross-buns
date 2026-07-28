//! Transactional reconciliation of a desired package-file map into one project.

use crate::{
    diagnostic::{Diagnostic, ErrorCode, Modification},
    installed_state::{
        DependencyGroup, InstalledPackage, InstalledState, MaterializationStrategy, OwnedFile,
        STATE_FILE_NAME, create_state_directory, state_directory, state_path,
    },
    ownership::{DesiredFile, DesiredFileMap, validate_project_file_conflicts},
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
    recover_transaction(project_root)?;
    let packages = packages.into_iter().collect::<Vec<_>>();
    let previous = read_state(project_root)?;
    let prior_paths = previous.files().keys().cloned().collect::<BTreeSet<_>>();
    validate_project_file_conflicts(project_root, desired, &prior_paths)?;
    let next = next_state(groups, packages, desired)?;
    let plan = plan(project_root, &previous, desired)?;
    if plan.writes.is_empty() && plan.removals.is_empty() && previous == next {
        return Ok(SyncSummary {
            unchanged: desired.files().len(),
            ..SyncSummary::default()
        });
    }
    let state_directory = create_state_directory(project_root)?;
    let staging = state_directory.join(".transaction");
    fs::create_dir(&staging)
        .map_err(|error| internal("could not create project transaction staging", error))?;
    if let Err(error) = stage(&staging, desired, &plan, &next) {
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
    Ok(SyncSummary {
        written: plan.writes.len(),
        unchanged: desired.files().len() - plan.writes.len(),
        removed: plan.removals.len(),
    })
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
) -> Result<InstalledState, Box<Diagnostic>> {
    let files = desired
        .files()
        .values()
        .map(|file| {
            OwnedFile::new(
                file.path(),
                file.owners().clone(),
                file.sha256().to_owned(),
                MaterializationStrategy::Copy,
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

fn stage(
    staging: &Path,
    desired: &DesiredFileMap,
    plan: &SyncPlan,
    next: &InstalledState,
) -> Result<(), Box<Diagnostic>> {
    Journal::create(staging)?;
    for (path, file) in &plan.writes {
        let staged = staging.join("files").join(path);
        let parent = staged
            .parent()
            .ok_or_else(|| internal("staged file has no parent", "invalid path"))?;
        fs::create_dir_all(parent)
            .map_err(|error| internal("could not create staged directory", error))?;
        copy_and_sync(file.source_path(), &staged)?;
        #[cfg(unix)]
        set_executable(&staged, file.executable())?;
    }
    let state = staging.join(STATE_FILE_NAME);
    fs::File::create(&state)
        .and_then(|mut file| {
            file.write_all(next.to_toml().as_bytes())
                .and_then(|()| file.sync_all())
        })
        .map_err(|error| internal("could not stage installed state", error))?;
    let _ = desired;
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
    for path in plan.writes.keys() {
        let destination = project_root.join(path);
        let parent = destination
            .parent()
            .ok_or_else(|| internal("destination has no parent", "invalid path"))?;
        fs::create_dir_all(parent)
            .map_err(|error| internal("could not create project directory", error))?;
        journal.record_written(path)?;
        fs::rename(staging.join("files").join(path), &destination)
            .map_err(|error| internal("could not publish staged project file", error))?;
    }
    let state = Path::new(".wukong").join(STATE_FILE_NAME);
    if fs::symlink_metadata(state_path(project_root)).is_ok() {
        journal.record_moved(&state)?;
        move_to_rollback(project_root, &rollback, &state)?;
    }
    journal.record_written(&state)?;
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
        .map_err(|error| internal("could not back up project file", error))
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
    for path in journal.written.iter().rev() {
        let destination = project_root.join(path);
        if fs::symlink_metadata(&destination).is_ok() {
            remove_path(&destination)?;
        }
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

fn remove_path(path: &Path) -> Result<(), Box<Diagnostic>> {
    let metadata = fs::symlink_metadata(path)
        .map_err(|error| internal("could not inspect transaction file", error))?;
    let result = if metadata.file_type().is_dir() {
        fs::remove_dir_all(path)
    } else {
        fs::remove_file(path)
    };
    result.map_err(|error| internal("could not remove transaction file", error))
}

#[derive(Default)]
struct Journal {
    moved: Vec<PathBuf>,
    written: Vec<PathBuf>,
    complete: bool,
    path: PathBuf,
}
impl Journal {
    fn create(staging: &Path) -> Result<(), Box<Diagnostic>> {
        let path = staging.join("journal");
        fs::File::create(&path)
            .and_then(|mut file| file.write_all(b"v1\n").and_then(|()| file.sync_all()))
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
        if lines.next() != Some("v1") {
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
                "written" => journal.written.push(path),
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
    fn record_written(&self, path: &Path) -> Result<(), Box<Diagnostic>> {
        self.append("written", path)
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

fn copy_and_sync(source: &Path, destination: &Path) -> Result<(), Box<Diagnostic>> {
    let mut input =
        fs::File::open(source).map_err(|error| internal("could not read prepared file", error))?;
    let mut output = fs::File::create(destination)
        .map_err(|error| internal("could not stage package file", error))?;
    std::io::copy(&mut input, &mut output)
        .map_err(|error| internal("could not stage package file", error))?;
    output
        .sync_all()
        .map_err(|error| internal("could not flush staged package file", error))
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
mod tests {
    use super::recover_transaction;
    use std::fs;
    use tempfile::TempDir;

    #[test]
    fn invariant_interrupted_transaction_recovers_the_previous_file() {
        let fixture = TempDir::new().expect("fixture should exist");
        let project = fixture.path().join("project");
        let transaction = project.join(".wukong/.transaction");
        write(&project.join("addons/alpha/plugin.gd"), "new");
        write(&transaction.join("rollback/addons/alpha/plugin.gd"), "old");
        write(
            &transaction.join("journal"),
            "v1\nmoved addons/alpha/plugin.gd\nwritten addons/alpha/plugin.gd\n",
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

    fn write(path: &std::path::Path, content: &str) {
        fs::create_dir_all(path.parent().expect("parent should exist"))
            .expect("parent should create");
        fs::write(path, content).expect("file should write");
    }
}
