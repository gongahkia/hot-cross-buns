/// CLI-owned diagnostic rendering and exit-code mapping.
pub mod diagnostics;

use std::{collections::BTreeSet, env, ffi::OsString, fs, io::IsTerminal, path::PathBuf, process};
use wukong_core::{
    cache::{CacheLayout, verify_cached_packages},
    dependency_graph::{DependencyGroup, LockedDependencyGraph},
    diagnostic::{Diagnostic, ErrorCode},
    direct_lock::{lock_direct_dependencies, update_direct_dependencies},
    direct_sync::sync_direct_dependencies,
    identity::PackageName,
    init::initialize_manifest,
    lockfile::{LOCKFILE_FILE_NAME, Lockfile},
    manifest::{GitReference, MANIFEST_FILE_NAME, Manifest},
    manifest_edit::{DependencyDeclaration, DependencySection, add_dependency, remove_dependency},
    outdated::{OutdatedPackage, OutdatedStatus, report_outdated},
    project::ProjectRoot,
    transactional_file::{FileSnapshot, write_atomic},
};

use crate::diagnostics::{ProcessExit, render_human};

fn main() {
    process::exit(i32::from(run(env::args_os()).code()));
}

fn run(arguments: impl IntoIterator<Item = OsString>) -> ProcessExit {
    let mut arguments = arguments.into_iter();
    let _program = arguments.next();
    let command = arguments.next();
    if command.is_none()
        || matches!(command.as_deref(), Some(command) if command == "--help" || command == "-h")
    {
        print_usage();
        return ProcessExit::Success;
    }
    match command {
        Some(command) if command == "init" => match run_init(arguments) {
            Ok(()) => ProcessExit::Success,
            Err(diagnostic) => render_error(&diagnostic),
        },
        Some(command) if command == "add" => match run_add(arguments) {
            Ok(()) => ProcessExit::Success,
            Err(diagnostic) => render_error(&diagnostic),
        },
        Some(command) if command == "remove" => match run_remove(arguments) {
            Ok(()) => ProcessExit::Success,
            Err(diagnostic) => render_error(&diagnostic),
        },
        Some(command) if command == "update" => match run_update(arguments) {
            Ok(()) => ProcessExit::Success,
            Err(diagnostic) => render_error(&diagnostic),
        },
        Some(command) if command == "outdated" => match run_outdated(arguments) {
            Ok(()) => ProcessExit::Success,
            Err(diagnostic) => render_error(&diagnostic),
        },
        Some(command) if command == "lock" => match run_lock(arguments) {
            Ok(()) => ProcessExit::Success,
            Err(diagnostic) => render_error(&diagnostic),
        },
        Some(command) if command == "install" || command == "sync" => match run_sync(arguments) {
            Ok(()) => ProcessExit::Success,
            Err(diagnostic) => render_error(&diagnostic),
        },
        Some(command) if command == "cache" => match run_cache(arguments) {
            Ok(()) => ProcessExit::Success,
            Err(diagnostic) => render_error(&diagnostic),
        },
        Some(command) if command == "tree" => match run_tree(arguments) {
            Ok(()) => ProcessExit::Success,
            Err(diagnostic) => render_error(&diagnostic),
        },
        Some(command) if command == "why" => match run_why(arguments) {
            Ok(()) => ProcessExit::Success,
            Err(diagnostic) => render_error(&diagnostic),
        },
        Some(command) => render_error(&user_error(
            format!("unsupported command {}", command.to_string_lossy()),
            "run wukong --help for supported commands",
        )),
        None => ProcessExit::Success,
    }
}

#[allow(clippy::too_many_lines)] // coordinates one cross-file transaction
fn run_add(arguments: impl Iterator<Item = OsString>) -> Result<(), Box<Diagnostic>> {
    let options = parse_add_arguments(arguments)?;
    let current_directory = env::current_dir().map_err(|error| {
        boxed(
            Diagnostic::new(
                ErrorCode::InternalFailure,
                "could not determine current directory",
            )
            .with_cause(error)
            .with_recovery("run wukong from an accessible directory"),
        )
    })?;
    let project = ProjectRoot::discover(&current_directory, options.project.as_deref())?;
    let manifest_path = project.path().join(MANIFEST_FILE_NAME);
    let lock_path = project.path().join(LOCKFILE_FILE_NAME);
    let manifest_snapshot = FileSnapshot::capture(&manifest_path)?;
    let lock_snapshot = FileSnapshot::capture(&lock_path)?;
    let section = if options.development {
        DependencySection::Development
    } else {
        DependencySection::Runtime
    };
    add_dependency(
        &manifest_path,
        section,
        &options.alias,
        &options.declaration,
    )?;
    let manifest_bytes = match fs::read(&manifest_path) {
        Ok(content) => content,
        Err(error) => {
            return Err(rollback_add(
                boxed(
                    Diagnostic::new(
                        ErrorCode::InternalFailure,
                        format!(
                            "could not read updated manifest {}",
                            manifest_path.display()
                        ),
                    )
                    .with_cause(error)
                    .with_recovery("check filesystem permissions and retry"),
                ),
                &manifest_snapshot,
                None,
                None,
            ));
        }
    };
    let manifest_input = match std::str::from_utf8(&manifest_bytes) {
        Ok(input) => input,
        Err(error) => {
            return Err(rollback_add(
                boxed(
                    Diagnostic::new(ErrorCode::InternalFailure, "updated manifest is not UTF-8")
                        .with_cause(error)
                        .with_recovery("restore a valid wukong.toml and retry"),
                ),
                &manifest_snapshot,
                Some(&manifest_bytes),
                None,
            ));
        }
    };
    let manifest = match Manifest::parse(&manifest_path, manifest_input) {
        Ok(manifest) => manifest,
        Err(error) => {
            return Err(rollback_add(
                error,
                &manifest_snapshot,
                Some(&manifest_bytes),
                None,
            ));
        }
    };
    let cache = match CacheLayout::from_environment() {
        Ok(cache) => cache,
        Err(error) => {
            return Err(rollback_add(
                error,
                &manifest_snapshot,
                Some(&manifest_bytes),
                None,
            ));
        }
    };
    let lock = match lock_direct_dependencies(&manifest_path, &manifest, None, &cache, false) {
        Ok(lock) => lock,
        Err(error) => {
            return Err(rollback_add(
                error,
                &manifest_snapshot,
                Some(&manifest_bytes),
                None,
            ));
        }
    };
    let lock_output = lock.to_toml().into_bytes();
    if let Err(error) = write_atomic(&lock_path, &lock_output) {
        return Err(rollback_add(
            error,
            &manifest_snapshot,
            Some(&manifest_bytes),
            None,
        ));
    }
    let summary = match sync_direct_dependencies(
        project.path(),
        &manifest_path,
        &manifest,
        &lock,
        options.development,
        &cache,
        false,
    ) {
        Ok(summary) => summary,
        Err(error) => {
            return Err(rollback_add(
                error,
                &manifest_snapshot,
                Some(&manifest_bytes),
                Some((&lock_snapshot, lock_output.as_slice())),
            ));
        }
    };
    println!(
        "added {}; sync: {} written, {} unchanged, {} removed",
        options.alias, summary.written, summary.unchanged, summary.removed
    );
    Ok(())
}

fn rollback_add(
    original: Box<Diagnostic>,
    manifest_snapshot: &FileSnapshot,
    manifest_expected: Option<&[u8]>,
    lock: Option<(&FileSnapshot, &[u8])>,
) -> Box<Diagnostic> {
    let mut failures = Vec::new();
    if let Some((lock_snapshot, expected)) = lock {
        if let Err(error) = lock_snapshot.restore_if_current(Some(expected)) {
            failures.push(format!("lockfile: {error}"));
        }
    }
    if let Some(expected) = manifest_expected {
        if let Err(error) = manifest_snapshot.restore_if_current(Some(expected)) {
            failures.push(format!("manifest: {error}"));
        }
    }
    if failures.is_empty() {
        original
    } else {
        boxed(
            Diagnostic::new(
                ErrorCode::InternalFailure,
                "dependency add failed and rollback was incomplete",
            )
            .with_cause(format!("operation: {original}; {}", failures.join("; ")))
            .with_recovery("inspect manifest and lockfile state before retrying"),
        )
    }
}

#[allow(clippy::too_many_lines)] // coordinates one cross-file transaction
fn run_remove(arguments: impl Iterator<Item = OsString>) -> Result<(), Box<Diagnostic>> {
    let options = parse_remove_arguments(arguments)?;
    let current_directory = env::current_dir().map_err(|error| {
        boxed(
            Diagnostic::new(
                ErrorCode::InternalFailure,
                "could not determine current directory",
            )
            .with_cause(error)
            .with_recovery("run wukong from an accessible directory"),
        )
    })?;
    let project = ProjectRoot::discover(&current_directory, options.project.as_deref())?;
    let manifest_path = project.path().join(MANIFEST_FILE_NAME);
    let lock_path = project.path().join(LOCKFILE_FILE_NAME);
    let current_manifest = read_manifest(&manifest_path)?;
    let section = options.section.unwrap_or_else(|| {
        if current_manifest
            .dependencies()
            .contains_key(options.alias.as_str())
        {
            DependencySection::Runtime
        } else {
            DependencySection::Development
        }
    });
    let manifest_snapshot = FileSnapshot::capture(&manifest_path)?;
    let lock_snapshot = FileSnapshot::capture(&lock_path)?;
    remove_dependency(&manifest_path, section, &options.alias)?;
    let manifest_bytes = match fs::read(&manifest_path) {
        Ok(content) => content,
        Err(error) => {
            return Err(rollback_add(
                boxed(
                    Diagnostic::new(
                        ErrorCode::InternalFailure,
                        format!(
                            "could not read updated manifest {}",
                            manifest_path.display()
                        ),
                    )
                    .with_cause(error)
                    .with_recovery("check filesystem permissions and retry"),
                ),
                &manifest_snapshot,
                None,
                None,
            ));
        }
    };
    let manifest_input = match std::str::from_utf8(&manifest_bytes) {
        Ok(input) => input,
        Err(error) => {
            return Err(rollback_add(
                boxed(
                    Diagnostic::new(ErrorCode::InternalFailure, "updated manifest is not UTF-8")
                        .with_cause(error)
                        .with_recovery("restore a valid wukong.toml and retry"),
                ),
                &manifest_snapshot,
                Some(&manifest_bytes),
                None,
            ));
        }
    };
    let manifest = match Manifest::parse(&manifest_path, manifest_input) {
        Ok(manifest) => manifest,
        Err(error) => {
            return Err(rollback_add(
                error,
                &manifest_snapshot,
                Some(&manifest_bytes),
                None,
            ));
        }
    };
    let cache = match CacheLayout::from_environment() {
        Ok(cache) => cache,
        Err(error) => {
            return Err(rollback_add(
                error,
                &manifest_snapshot,
                Some(&manifest_bytes),
                None,
            ));
        }
    };
    let lock = match lock_direct_dependencies(&manifest_path, &manifest, None, &cache, false) {
        Ok(lock) => lock,
        Err(error) => {
            return Err(rollback_add(
                error,
                &manifest_snapshot,
                Some(&manifest_bytes),
                None,
            ));
        }
    };
    let lock_output = lock.to_toml().into_bytes();
    if let Err(error) = write_atomic(&lock_path, &lock_output) {
        return Err(rollback_add(
            error,
            &manifest_snapshot,
            Some(&manifest_bytes),
            None,
        ));
    }
    let summary = match sync_direct_dependencies(
        project.path(),
        &manifest_path,
        &manifest,
        &lock,
        true,
        &cache,
        false,
    ) {
        Ok(summary) => summary,
        Err(error) => {
            return Err(rollback_add(
                error,
                &manifest_snapshot,
                Some(&manifest_bytes),
                Some((&lock_snapshot, lock_output.as_slice())),
            ));
        }
    };
    println!(
        "removed {}; sync: {} written, {} unchanged, {} removed",
        options.alias, summary.written, summary.unchanged, summary.removed
    );
    Ok(())
}

#[allow(clippy::too_many_lines)] // coordinates lock publication and project sync
fn run_update(arguments: impl Iterator<Item = OsString>) -> Result<(), Box<Diagnostic>> {
    let options = parse_update_arguments(arguments)?;
    let current_directory = env::current_dir().map_err(|error| {
        boxed(
            Diagnostic::new(
                ErrorCode::InternalFailure,
                "could not determine current directory",
            )
            .with_cause(error)
            .with_recovery("run wukong from an accessible directory"),
        )
    })?;
    let project = ProjectRoot::discover(&current_directory, options.project.as_deref())?;
    let manifest_path = project.path().join(MANIFEST_FILE_NAME);
    let manifest = read_manifest(&manifest_path)?;
    let lock_path = project.path().join(LOCKFILE_FILE_NAME);
    let existing = read_lockfile(&lock_path)?.ok_or_else(|| {
        user_error(
            "wukong.lock is required before updating",
            "run wukong lock before updating dependencies",
        )
    })?;
    let selected = options
        .package
        .as_deref()
        .map(PackageName::parse)
        .transpose()
        .map_err(|error| {
            boxed(
                Diagnostic::new(
                    ErrorCode::UserInput,
                    format!("invalid package name: {error}"),
                )
                .with_recovery("use a lowercase package name"),
            )
        })?;
    let cache = CacheLayout::from_environment()?;
    let updated = update_direct_dependencies(
        &manifest_path,
        &manifest,
        &existing,
        selected.as_ref(),
        &cache,
        options.offline,
    )?;
    let changes = update_changes(&existing, &updated);
    if options.dry_run {
        print_update_changes("would update", &changes);
        return Ok(());
    }
    if changes.is_empty() {
        println!("update: no changes");
        return Ok(());
    }
    if std::io::stdout().is_terminal() {
        print_update_changes("updating", &changes);
    }
    let output = updated.to_toml().into_bytes();
    let lock_snapshot = FileSnapshot::capture(&lock_path)?;
    write_atomic(&lock_path, &output)?;
    let summary = match sync_direct_dependencies(
        project.path(),
        &manifest_path,
        &manifest,
        &updated,
        true,
        &cache,
        options.offline,
    ) {
        Ok(summary) => summary,
        Err(error) => return Err(rollback_update(error, &lock_snapshot, &output)),
    };
    print_update_changes("updated", &changes);
    println!(
        "sync: {} written, {} unchanged, {} removed",
        summary.written, summary.unchanged, summary.removed
    );
    Ok(())
}

fn rollback_update(
    original: Box<Diagnostic>,
    lock_snapshot: &FileSnapshot,
    expected_lock: &[u8],
) -> Box<Diagnostic> {
    match lock_snapshot.restore_if_current(Some(expected_lock)) {
        Ok(()) => original,
        Err(error) => boxed(
            Diagnostic::new(
                ErrorCode::InternalFailure,
                "dependency update failed and lockfile rollback was incomplete",
            )
            .with_cause(format!("operation: {original}; lockfile: {error}"))
            .with_recovery("inspect wukong.lock and project files before retrying"),
        ),
    }
}

fn update_changes(existing: &Lockfile, updated: &Lockfile) -> Vec<String> {
    let names = existing
        .packages()
        .keys()
        .chain(updated.packages().keys())
        .collect::<BTreeSet<_>>();
    names
        .into_iter()
        .filter_map(
            |name| match (existing.packages().get(name), updated.packages().get(name)) {
                (Some(old), Some(new)) if old != new => Some(format!(
                    "{}: {} -> {}",
                    name.as_str(),
                    update_value(old, new),
                    update_value(new, old),
                )),
                (None, Some(new)) => Some(format!(
                    "{}: added {}",
                    name.as_str(),
                    update_value(new, new)
                )),
                (Some(old), None) => Some(format!(
                    "{}: removed {}",
                    name.as_str(),
                    update_value(old, old)
                )),
                _ => None,
            },
        )
        .collect()
}

fn update_value(
    package: &wukong_core::lockfile::LockedPackage,
    other: &wukong_core::lockfile::LockedPackage,
) -> String {
    if package.version() != other.version() {
        return package
            .version()
            .map_or_else(|| "no version".to_owned(), ToString::to_string);
    }
    package.source().immutable_id().as_str().to_owned()
}

fn print_update_changes(prefix: &str, changes: &[String]) {
    if changes.is_empty() {
        println!("{prefix}: no changes");
        return;
    }
    for change in changes {
        println!("{prefix} {change}");
    }
}

struct UpdateOptions {
    package: Option<String>,
    dry_run: bool,
    offline: bool,
    project: Option<PathBuf>,
}

fn parse_update_arguments(
    mut arguments: impl Iterator<Item = OsString>,
) -> Result<UpdateOptions, Box<Diagnostic>> {
    let mut options = UpdateOptions {
        package: None,
        dry_run: false,
        offline: false,
        project: None,
    };
    while let Some(argument) = arguments.next() {
        if argument == "--dry-run" {
            if std::mem::replace(&mut options.dry_run, true) {
                return Err(user_error(
                    "--dry-run may be supplied only once",
                    "run wukong update [package] --dry-run",
                ));
            }
            continue;
        }
        if argument == "--offline" {
            if std::mem::replace(&mut options.offline, true) {
                return Err(user_error(
                    "--offline may be supplied only once",
                    "run wukong update [package] --offline",
                ));
            }
            continue;
        }
        if argument == "--project" {
            let path = PathBuf::from(required_add_value(&mut arguments, "--project")?);
            if options.project.replace(path).is_some() {
                return Err(user_error(
                    "--project may be supplied only once",
                    "provide one project directory or project.godot file",
                ));
            }
            continue;
        }
        if argument.to_string_lossy().starts_with('-') {
            return Err(user_error(
                format!("unsupported update argument {}", argument.to_string_lossy()),
                "use --dry-run, --offline, or --project <path>",
            ));
        }
        if options
            .package
            .replace(argument.to_string_lossy().into_owned())
            .is_some()
        {
            return Err(user_error(
                "update accepts at most one package alias",
                "run wukong update [package]",
            ));
        }
    }
    Ok(options)
}

fn run_outdated(arguments: impl Iterator<Item = OsString>) -> Result<(), Box<Diagnostic>> {
    let options = parse_outdated_arguments(arguments)?;
    let current_directory = env::current_dir().map_err(|error| {
        boxed(
            Diagnostic::new(
                ErrorCode::InternalFailure,
                "could not determine current directory",
            )
            .with_cause(error)
            .with_recovery("run wukong from an accessible directory"),
        )
    })?;
    let project = ProjectRoot::discover(&current_directory, options.project.as_deref())?;
    let lock_path = project.path().join(LOCKFILE_FILE_NAME);
    let lock = read_lockfile(&lock_path)?.ok_or_else(|| {
        user_error(
            "wukong.lock is required to inspect outdated dependencies",
            "run wukong lock before wukong outdated",
        )
    })?;
    let cache = CacheLayout::from_environment()?;
    let report = report_outdated(&lock, &cache, options.offline);
    if options.json {
        println!("{}", render_outdated_json(&report));
    } else {
        println!("{}", render_outdated(&report));
    }
    Ok(())
}

struct OutdatedOptions {
    json: bool,
    offline: bool,
    project: Option<PathBuf>,
}

fn parse_outdated_arguments(
    mut arguments: impl Iterator<Item = OsString>,
) -> Result<OutdatedOptions, Box<Diagnostic>> {
    let mut options = OutdatedOptions {
        json: false,
        offline: false,
        project: None,
    };
    while let Some(argument) = arguments.next() {
        if argument == "--json" {
            if std::mem::replace(&mut options.json, true) {
                return Err(user_error(
                    "--json may be supplied only once",
                    "run wukong outdated --json",
                ));
            }
            continue;
        }
        if argument == "--offline" {
            if std::mem::replace(&mut options.offline, true) {
                return Err(user_error(
                    "--offline may be supplied only once",
                    "run wukong outdated --offline",
                ));
            }
            continue;
        }
        if argument == "--project" {
            let path = PathBuf::from(required_add_value(&mut arguments, "--project")?);
            if options.project.replace(path).is_some() {
                return Err(user_error(
                    "--project may be supplied only once",
                    "provide one project directory or project.godot file",
                ));
            }
            continue;
        }
        return Err(user_error(
            format!(
                "unsupported outdated argument {}",
                argument.to_string_lossy()
            ),
            "use --json, --offline, or --project <path>",
        ));
    }
    Ok(options)
}

fn render_outdated(report: &[OutdatedPackage]) -> String {
    if report.is_empty() {
        return "outdated: no locked packages".to_owned();
    }
    report
        .iter()
        .map(|package| match package.status() {
            OutdatedStatus::UpToDate { current } => {
                format!("{} {current}: up to date", package.name())
            }
            OutdatedStatus::Updates {
                current,
                compatible,
                breaking,
            } => {
                let compatible = compatible
                    .as_ref()
                    .map_or_else(|| "none".to_owned(), ToString::to_string);
                let breaking = breaking
                    .as_ref()
                    .map_or_else(|| "none".to_owned(), ToString::to_string);
                format!(
                    "{} {current}: compatible {compatible}; breaking {breaking}",
                    package.name()
                )
            }
            OutdatedStatus::Unavailable { reason } => {
                format!("{}: unavailable ({reason})", package.name())
            }
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn render_outdated_json(report: &[OutdatedPackage]) -> String {
    let packages = report
        .iter()
        .map(|package| {
            let (status, current, compatible, breaking, reason) = match package.status() {
                OutdatedStatus::UpToDate { current } => (
                    "up_to_date",
                    Some(current),
                    None,
                    None,
                    None,
                ),
                OutdatedStatus::Updates {
                    current,
                    compatible,
                    breaking,
                } => (
                    "outdated",
                    Some(current),
                    compatible.as_ref(),
                    breaking.as_ref(),
                    None,
                ),
                OutdatedStatus::Unavailable { reason } => {
                    ("unavailable", None, None, None, Some(reason.as_str()))
                }
            };
            let version = |value: Option<&wukong_core::semantic_version::SemanticVersion>| {
                value.map_or_else(|| "null".to_owned(), |value| json_string(&value.to_string()))
            };
            let reason = reason.map_or_else(|| "null".to_owned(), json_string);
            format!(
                "{{\"name\":{},\"status\":{},\"current\":{},\"compatible\":{},\"breaking\":{},\"reason\":{reason}}}",
                json_string(&package.name().to_string()),
                json_string(status),
                version(current),
                version(compatible),
                version(breaking),
            )
        })
        .collect::<Vec<_>>()
        .join(",");
    format!("{{\"schema\":1,\"packages\":[{packages}]}}")
}

struct RemoveOptions {
    alias: String,
    section: Option<DependencySection>,
    project: Option<PathBuf>,
}

fn parse_remove_arguments(
    mut arguments: impl Iterator<Item = OsString>,
) -> Result<RemoveOptions, Box<Diagnostic>> {
    let alias = arguments.next().ok_or_else(|| {
        user_error(
            "remove requires a package alias",
            "run wukong remove <alias> [--dev] [--project <path>]",
        )
    })?;
    let mut section = None;
    let mut project = None;
    while let Some(argument) = arguments.next() {
        if argument == "--dev" {
            if section.replace(DependencySection::Development).is_some() {
                return Err(user_error(
                    "--dev may be supplied only once",
                    "remove --dev once",
                ));
            }
            continue;
        }
        if argument == "--project" {
            let path = PathBuf::from(required_add_value(&mut arguments, "--project")?);
            if project.replace(path).is_some() {
                return Err(user_error(
                    "--project may be supplied only once",
                    "provide one project directory or project.godot file",
                ));
            }
            continue;
        }
        return Err(user_error(
            format!("unsupported remove argument {}", argument.to_string_lossy()),
            "use --dev or --project <path>",
        ));
    }
    Ok(RemoveOptions {
        alias: alias.to_string_lossy().into_owned(),
        section,
        project,
    })
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct AddOptions {
    alias: String,
    declaration: DependencyDeclaration,
    development: bool,
    project: Option<PathBuf>,
}

fn parse_add_arguments(
    mut arguments: impl Iterator<Item = OsString>,
) -> Result<AddOptions, Box<Diagnostic>> {
    let alias = arguments.next().ok_or_else(|| {
        user_error(
            "add requires a package alias",
            "run wukong add <alias> --path <directory>, --git <url>, or --url <url> --sha256 <hash>",
        )
    })?;
    let alias = alias.to_string_lossy().into_owned();
    let mut path = None;
    let mut git = None;
    let mut git_revision = None;
    let mut url = None;
    let mut sha256 = None;
    let mut development = false;
    let mut project = None;
    while let Some(argument) = arguments.next() {
        if argument == "--dev" {
            development = true;
            continue;
        }
        if argument == "--path" {
            path = Some(PathBuf::from(required_add_value(&mut arguments, "--path")?));
            continue;
        }
        if argument == "--git" {
            git = Some(required_add_value(&mut arguments, "--git")?);
            continue;
        }
        if argument == "--rev" {
            git_revision = Some(required_add_value(&mut arguments, "--rev")?);
            continue;
        }
        if argument == "--url" {
            url = Some(required_add_value(&mut arguments, "--url")?);
            continue;
        }
        if argument == "--sha256" {
            sha256 = Some(required_add_value(&mut arguments, "--sha256")?);
            continue;
        }
        if argument == "--project" {
            let path = PathBuf::from(required_add_value(&mut arguments, "--project")?);
            if project.replace(path).is_some() {
                return Err(user_error(
                    "--project may be supplied only once",
                    "provide one project directory or project.godot file",
                ));
            }
            continue;
        }
        return Err(user_error(
            format!("unsupported add argument {}", argument.to_string_lossy()),
            "use --path, --git [--rev], or --url --sha256",
        ));
    }
    let declaration = match (path, git, url) {
        (Some(path), None, None) if git_revision.is_none() && sha256.is_none() => {
            DependencyDeclaration::Path(path)
        }
        (None, Some(url), None) if sha256.is_none() => DependencyDeclaration::Git {
            url,
            reference: git_revision.map(GitReference::Rev),
        },
        (None, None, Some(url)) if git_revision.is_none() => {
            let sha256 = sha256.ok_or_else(|| {
                user_error(
                    "--url requires --sha256",
                    "provide the expected 64-character SHA-256 checksum",
                )
            })?;
            DependencyDeclaration::Url { url, sha256 }
        }
        _ => {
            return Err(user_error(
                "add requires exactly one source declaration",
                "use --path, --git [--rev], or --url --sha256",
            ));
        }
    };
    Ok(AddOptions {
        alias,
        declaration,
        development,
        project,
    })
}

fn required_add_value(
    arguments: &mut impl Iterator<Item = OsString>,
    option: &str,
) -> Result<String, Box<Diagnostic>> {
    arguments
        .next()
        .map(|value| value.to_string_lossy().into_owned())
        .ok_or_else(|| {
            user_error(
                format!("{option} requires a value"),
                "provide the required option value",
            )
        })
}

fn run_tree(arguments: impl Iterator<Item = OsString>) -> Result<(), Box<Diagnostic>> {
    let options = parse_view_arguments(arguments, false)?;
    let graph = load_dependency_graph(options.project.as_deref())?;
    if options.json {
        println!("{}", render_tree_json(&graph));
    } else {
        println!("{}", render_tree(&graph));
    }
    Ok(())
}

fn run_why(arguments: impl Iterator<Item = OsString>) -> Result<(), Box<Diagnostic>> {
    let options = parse_view_arguments(arguments, true)?;
    let target = options.target.ok_or_else(|| {
        user_error(
            "why requires a package name",
            "run wukong why <package> [--json] [--project <path>]",
        )
    })?;
    let target = wukong_core::identity::PackageName::parse(&target).map_err(|error| {
        boxed(
            Diagnostic::new(
                ErrorCode::UserInput,
                format!("invalid package name {target}: {error}"),
            )
            .with_recovery("use a lowercase package name"),
        )
    })?;
    let graph = load_dependency_graph(options.project.as_deref())?;
    if !graph.packages().contains_key(&target) {
        return Err(user_error(
            format!("package {target} is not in wukong.lock"),
            "run wukong tree to inspect selected packages or update wukong.lock",
        ));
    }
    let paths = graph.paths_to(&target);
    if paths.is_empty() {
        return Err(user_error(
            format!("package {target} is not reachable from a root dependency"),
            "regenerate wukong.lock to repair the dependency graph",
        ));
    }
    if options.json {
        println!("{}", render_why_json(&target, &paths));
    } else {
        println!("{}", render_why(&target, &paths));
    }
    Ok(())
}

struct ViewOptions {
    project: Option<PathBuf>,
    json: bool,
    target: Option<String>,
}

fn parse_view_arguments(
    mut arguments: impl Iterator<Item = OsString>,
    target_required: bool,
) -> Result<ViewOptions, Box<Diagnostic>> {
    let mut options = ViewOptions {
        project: None,
        json: false,
        target: None,
    };
    while let Some(argument) = arguments.next() {
        if argument == "--json" {
            options.json = true;
            continue;
        }
        if argument == "--project" {
            let path = arguments.next().ok_or_else(|| {
                user_error(
                    "--project requires a path",
                    "provide a project directory or project.godot file",
                )
            })?;
            if options.project.replace(PathBuf::from(path)).is_some() {
                return Err(user_error(
                    "--project may be supplied only once",
                    "provide one project directory or project.godot file",
                ));
            }
            continue;
        }
        if target_required && options.target.is_none() {
            options.target = Some(argument.to_string_lossy().into_owned());
            continue;
        }
        let command = if target_required { "why" } else { "tree" };
        return Err(user_error(
            format!(
                "unsupported {command} argument {}",
                argument.to_string_lossy()
            ),
            format!("run wukong {command} --help for supported options"),
        ));
    }
    if target_required && options.target.is_none() {
        return Err(user_error(
            "why requires a package name",
            "run wukong why <package> [--json] [--project <path>]",
        ));
    }
    Ok(options)
}

fn load_dependency_graph(
    project_path: Option<&std::path::Path>,
) -> Result<LockedDependencyGraph, Box<Diagnostic>> {
    let current_directory = env::current_dir().map_err(|error| {
        boxed(
            Diagnostic::new(
                ErrorCode::InternalFailure,
                "could not determine current directory",
            )
            .with_cause(error)
            .with_recovery("run wukong from an accessible directory"),
        )
    })?;
    let project = ProjectRoot::discover(&current_directory, project_path)?;
    let manifest = read_manifest(&project.path().join(MANIFEST_FILE_NAME))?;
    let lock_path = project.path().join(LOCKFILE_FILE_NAME);
    let lock = read_lockfile(&lock_path)?.ok_or_else(|| {
        user_error(
            "wukong.lock is required to inspect dependencies",
            "run wukong lock before wukong tree or wukong why",
        )
    })?;
    let runtime = manifest_dependency_names(manifest.dependencies())?;
    let development = manifest_dependency_names(manifest.dev_dependencies())?;
    LockedDependencyGraph::new(&lock, &runtime, &development)
}

fn manifest_dependency_names(
    dependencies: &std::collections::BTreeMap<
        wukong_core::manifest::DependencyAlias,
        wukong_core::manifest::Dependency,
    >,
) -> Result<BTreeSet<wukong_core::identity::PackageName>, Box<Diagnostic>> {
    dependencies
        .keys()
        .map(|alias| {
            wukong_core::identity::PackageName::parse(alias.as_str()).map_err(|error| {
                boxed(
                    Diagnostic::new(ErrorCode::InternalFailure, "manifest alias was invalid")
                        .with_cause(error),
                )
            })
        })
        .collect()
}

fn render_tree(graph: &LockedDependencyGraph) -> String {
    let mut lines = Vec::new();
    let mut rendered = BTreeSet::new();
    for (index, group) in [DependencyGroup::Runtime, DependencyGroup::Development]
        .into_iter()
        .enumerate()
    {
        let roots = graph.roots(group);
        if roots.is_empty() {
            continue;
        }
        if !lines.is_empty() && index > 0 {
            lines.push(String::new());
        }
        let title = match group {
            DependencyGroup::Runtime => "runtime dependencies:",
            DependencyGroup::Development => "development dependencies:",
        };
        lines.push(title.to_owned());
        for (root_index, root) in roots.iter().enumerate() {
            let mut active = BTreeSet::new();
            render_tree_node(
                graph,
                root,
                "",
                root_index + 1 == roots.len(),
                &mut rendered,
                &mut active,
                &mut lines,
            );
        }
    }
    if lines.is_empty() {
        "resolved dependencies: (none)".to_owned()
    } else {
        lines.join("\n")
    }
}

#[allow(clippy::too_many_arguments)]
fn render_tree_node(
    graph: &LockedDependencyGraph,
    name: &wukong_core::identity::PackageName,
    prefix: &str,
    last: bool,
    rendered: &mut BTreeSet<wukong_core::identity::PackageName>,
    active: &mut BTreeSet<wukong_core::identity::PackageName>,
    lines: &mut Vec<String>,
) {
    let branch = if last { "└── " } else { "├── " };
    let Some(package) = graph.packages().get(name) else {
        return;
    };
    if active.contains(name) {
        lines.push(format!(
            "{prefix}{branch}{} [cycle]",
            package_label(package)
        ));
        return;
    }
    if !rendered.insert(name.clone()) {
        lines.push(format!(
            "{prefix}{branch}{} [repeated]",
            package_label(package)
        ));
        return;
    }
    lines.push(format!("{prefix}{branch}{}", package_label(package)));
    active.insert(name.clone());
    let child_prefix = format!("{prefix}{}", if last { "    " } else { "│   " });
    for (index, dependency) in package.dependencies().iter().enumerate() {
        render_tree_node(
            graph,
            dependency,
            &child_prefix,
            index + 1 == package.dependencies().len(),
            rendered,
            active,
            lines,
        );
    }
    active.remove(name);
}

fn package_label(package: &wukong_core::dependency_graph::GraphPackage) -> String {
    let mut label = package.name().to_string();
    if let Some(version) = package.version() {
        label.push('@');
        label.push_str(&version.to_string());
    }
    let kind = if package.is_direct() {
        "direct"
    } else {
        "transitive"
    };
    if package.is_development() || package.is_direct_development() {
        format!("{label} [{kind}, development]")
    } else {
        format!("{label} [{kind}]")
    }
}

fn render_why(
    target: &wukong_core::identity::PackageName,
    paths: &[Vec<wukong_core::identity::PackageName>],
) -> String {
    let mut lines = vec![format!("why {target}:")];
    lines.extend(paths.iter().map(|path| {
        path.iter()
            .map(ToString::to_string)
            .collect::<Vec<_>>()
            .join(" -> ")
    }));
    lines.join("\n")
}

fn render_tree_json(graph: &LockedDependencyGraph) -> String {
    let packages = graph
        .packages()
        .values()
        .map(|package| {
            let version = package.version().map_or_else(
                || "null".to_owned(),
                |version| json_string(&version.to_string()),
            );
            let dependencies = package
                .dependencies()
                .iter()
                .map(|dependency| json_string(&dependency.to_string()))
                .collect::<Vec<_>>()
                .join(",");
            format!(
                "{{\"name\":{},\"version\":{version},\"direct\":{},\"development\":{},\"dependencies\":[{dependencies}]}}",
                json_string(&package.name().to_string()),
                package.is_direct(),
                package.is_development() || package.is_direct_development(),
            )
        })
        .collect::<Vec<_>>()
        .join(",");
    let roots = |group| {
        graph
            .roots(group)
            .iter()
            .map(|name| json_string(&name.to_string()))
            .collect::<Vec<_>>()
            .join(",")
    };
    format!(
        "{{\"schema\":1,\"roots\":{{\"runtime\":[{}],\"development\":[{}]}},\"packages\":[{packages}]}}",
        roots(DependencyGroup::Runtime),
        roots(DependencyGroup::Development),
    )
}

fn render_why_json(
    target: &wukong_core::identity::PackageName,
    paths: &[Vec<wukong_core::identity::PackageName>],
) -> String {
    let paths = paths
        .iter()
        .map(|path| {
            format!(
                "[{}]",
                path.iter()
                    .map(|name| json_string(&name.to_string()))
                    .collect::<Vec<_>>()
                    .join(",")
            )
        })
        .collect::<Vec<_>>()
        .join(",");
    format!(
        "{{\"schema\":1,\"package\":{},\"paths\":[{paths}]}}",
        json_string(&target.to_string())
    )
}

fn json_string(value: &str) -> String {
    let mut output = String::from('"');
    for character in value.chars() {
        match character {
            '"' => output.push_str("\\\""),
            '\\' => output.push_str("\\\\"),
            '\n' => output.push_str("\\n"),
            '\r' => output.push_str("\\r"),
            '\t' => output.push_str("\\t"),
            character if character.is_control() => {
                output.push_str(&format!("\\u{:04x}", u32::from(character)));
            }
            character => output.push(character),
        }
    }
    output.push('"');
    output
}

fn run_cache(mut arguments: impl Iterator<Item = OsString>) -> Result<(), Box<Diagnostic>> {
    let command = arguments.next().ok_or_else(|| {
        user_error(
            "cache requires a subcommand",
            "run wukong cache verify to check prepared package objects",
        )
    })?;
    if command != "verify" {
        return Err(user_error(
            format!("unsupported cache command {}", command.to_string_lossy()),
            "run wukong cache verify to check prepared package objects",
        ));
    }
    if let Some(argument) = arguments.next() {
        return Err(user_error(
            format!(
                "unsupported cache verify argument {}",
                argument.to_string_lossy()
            ),
            "run wukong cache verify without additional arguments",
        ));
    }
    let layout = CacheLayout::from_environment()?;
    let report = verify_cached_packages(&layout)?;
    println!(
        "cache verification: {} verified, {} corrupt removed",
        report.verified_packages(),
        report.removed_corrupt_packages()
    );
    if report.removed_corrupt_packages() == 0 {
        Ok(())
    } else {
        Err(boxed(
            Diagnostic::new(
                ErrorCode::IntegrityFailure,
                format!(
                    "cache verification removed {} corrupt object(s)",
                    report.removed_corrupt_packages()
                ),
            )
            .with_recovery("run wukong lock or sync again to restore removed cache objects"),
        ))
    }
}

fn run_lock(arguments: impl Iterator<Item = OsString>) -> Result<(), Box<Diagnostic>> {
    let options = parse_lock_arguments(arguments)?;
    let current_directory = env::current_dir().map_err(|error| {
        boxed(
            Diagnostic::new(
                ErrorCode::InternalFailure,
                "could not determine current directory",
            )
            .with_cause(error)
            .with_recovery("run wukong from an accessible directory"),
        )
    })?;
    let project = ProjectRoot::discover(&current_directory, options.project.as_deref())?;
    let manifest_path = project.path().join(MANIFEST_FILE_NAME);
    let input = fs::read_to_string(&manifest_path).map_err(|error| {
        boxed(
            Diagnostic::new(
                ErrorCode::UserInput,
                format!("could not read manifest {}", manifest_path.display()),
            )
            .with_cause(error)
            .with_recovery("run wukong init or provide a readable wukong.toml"),
        )
    })?;
    let manifest = Manifest::parse(&manifest_path, &input)?;
    let lock_path = project.path().join(LOCKFILE_FILE_NAME);
    let existing = match fs::read_to_string(&lock_path) {
        Ok(input) => Some(Lockfile::parse(&lock_path, &input)?),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
        Err(error) => {
            return Err(boxed(
                Diagnostic::new(
                    ErrorCode::InternalFailure,
                    format!("could not read lockfile {}", lock_path.display()),
                )
                .with_cause(error)
                .with_recovery("check lockfile permissions and retry"),
            ));
        }
    };
    let cache = CacheLayout::from_environment()?;
    let locked = lock_direct_dependencies(
        &manifest_path,
        &manifest,
        existing.as_ref(),
        &cache,
        options.offline,
    )?;
    let output = locked.to_toml();
    if options.locked
        && existing
            .as_ref()
            .is_none_or(|existing| existing.to_toml() != output)
    {
        return Err(user_error(
            "manifest and lockfile differ while --locked was supplied",
            "run wukong lock without --locked to update wukong.lock",
        ));
    }
    if existing
        .as_ref()
        .is_some_and(|existing| existing.to_toml() == output)
    {
        println!("lockfile unchanged");
        return Ok(());
    }
    fs::write(&lock_path, output).map_err(|error| {
        boxed(
            Diagnostic::new(
                ErrorCode::InternalFailure,
                format!("could not write lockfile {}", lock_path.display()),
            )
            .with_cause(error)
            .with_recovery("check project permissions and retry"),
        )
    })?;
    println!("locked {}", lock_path.display());
    Ok(())
}

fn run_sync(arguments: impl Iterator<Item = OsString>) -> Result<(), Box<Diagnostic>> {
    let options = parse_sync_arguments(arguments)?;
    let current_directory = env::current_dir().map_err(|error| {
        boxed(
            Diagnostic::new(
                ErrorCode::InternalFailure,
                "could not determine current directory",
            )
            .with_cause(error)
            .with_recovery("run wukong from an accessible directory"),
        )
    })?;
    let project = ProjectRoot::discover(&current_directory, options.project.as_deref())?;
    let manifest_path = project.path().join(MANIFEST_FILE_NAME);
    let manifest = read_manifest(&manifest_path)?;
    let lock_path = project.path().join(LOCKFILE_FILE_NAME);
    let lock = read_lockfile(&lock_path)?.ok_or_else(|| {
        user_error(
            "wukong.lock is required before synchronising",
            "run wukong lock to resolve the current manifest",
        )
    })?;
    let cache = CacheLayout::from_environment()?;
    if options.locked {
        let expected =
            lock_direct_dependencies(&manifest_path, &manifest, None, &cache, options.offline)?;
        if expected.to_toml() != lock.to_toml() {
            return Err(user_error(
                "manifest and lockfile differ while --locked was supplied",
                "run wukong lock without --locked to update wukong.lock",
            ));
        }
    }
    let summary = sync_direct_dependencies(
        project.path(),
        &manifest_path,
        &manifest,
        &lock,
        options.include_dev,
        &cache,
        options.offline,
    )?;
    println!(
        "sync: {} written, {} unchanged, {} removed",
        summary.written, summary.unchanged, summary.removed
    );
    Ok(())
}

struct LockOptions {
    project: Option<PathBuf>,
    locked: bool,
    offline: bool,
}
fn parse_lock_arguments(
    mut arguments: impl Iterator<Item = OsString>,
) -> Result<LockOptions, Box<Diagnostic>> {
    let mut options = LockOptions {
        project: None,
        locked: false,
        offline: false,
    };
    while let Some(argument) = arguments.next() {
        if argument == "--locked" {
            options.locked = true;
            continue;
        }
        if argument == "--offline" {
            options.offline = true;
            continue;
        }
        if argument == "--project" {
            let path = arguments.next().ok_or_else(|| {
                user_error(
                    "--project requires a path",
                    "provide a project directory or project.godot file",
                )
            })?;
            if options.project.replace(PathBuf::from(path)).is_some() {
                return Err(user_error(
                    "--project may be supplied only once",
                    "provide one project directory or project.godot file",
                ));
            }
            continue;
        }
        return Err(user_error(
            format!("unsupported lock argument {}", argument.to_string_lossy()),
            "run wukong lock --help for supported options",
        ));
    }
    Ok(options)
}

struct SyncOptions {
    project: Option<PathBuf>,
    include_dev: bool,
    locked: bool,
    offline: bool,
}
fn parse_sync_arguments(
    mut arguments: impl Iterator<Item = OsString>,
) -> Result<SyncOptions, Box<Diagnostic>> {
    let mut options = SyncOptions {
        project: None,
        include_dev: false,
        locked: false,
        offline: false,
    };
    while let Some(argument) = arguments.next() {
        if argument == "--dev" {
            options.include_dev = true;
            continue;
        }
        if argument == "--locked" {
            options.locked = true;
            continue;
        }
        if argument == "--frozen" {
            options.locked = true;
            options.offline = true;
            continue;
        }
        if argument == "--offline" {
            options.offline = true;
            continue;
        }
        if argument == "--project" {
            let path = arguments.next().ok_or_else(|| {
                user_error(
                    "--project requires a path",
                    "provide a project directory or project.godot file",
                )
            })?;
            if options.project.replace(PathBuf::from(path)).is_some() {
                return Err(user_error(
                    "--project may be supplied only once",
                    "provide one project directory or project.godot file",
                ));
            }
            continue;
        }
        return Err(user_error(
            format!("unsupported sync argument {}", argument.to_string_lossy()),
            "run wukong sync --help for supported options",
        ));
    }
    Ok(options)
}

fn read_manifest(path: &std::path::Path) -> Result<Manifest, Box<Diagnostic>> {
    let input = fs::read_to_string(path).map_err(|error| {
        boxed(
            Diagnostic::new(
                ErrorCode::UserInput,
                format!("could not read manifest {}", path.display()),
            )
            .with_cause(error)
            .with_recovery("run wukong init or provide a readable wukong.toml"),
        )
    })?;
    Manifest::parse(path, &input)
}

fn read_lockfile(path: &std::path::Path) -> Result<Option<Lockfile>, Box<Diagnostic>> {
    match fs::read_to_string(path) {
        Ok(input) => Lockfile::parse(path, &input).map(Some),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(boxed(
            Diagnostic::new(
                ErrorCode::InternalFailure,
                format!("could not read lockfile {}", path.display()),
            )
            .with_cause(error)
            .with_recovery("check lockfile permissions and retry"),
        )),
    }
}

fn run_init(arguments: impl Iterator<Item = OsString>) -> Result<(), Box<Diagnostic>> {
    let explicit_project = parse_init_arguments(arguments)?;
    let current_directory = env::current_dir().map_err(|error| {
        boxed(
            Diagnostic::new(
                ErrorCode::InternalFailure,
                "could not determine current directory",
            )
            .with_cause(error)
            .with_recovery("run wukong from an accessible directory"),
        )
    })?;
    let project = ProjectRoot::discover(&current_directory, explicit_project.as_deref())?;
    let manifest = initialize_manifest(&project)?;
    println!("created {}", manifest.path().display());
    Ok(())
}

fn parse_init_arguments(
    mut arguments: impl Iterator<Item = OsString>,
) -> Result<Option<PathBuf>, Box<Diagnostic>> {
    let mut explicit_project = None;
    while let Some(argument) = arguments.next() {
        if argument == "--non-interactive" {
            continue;
        }
        if argument == "--project" {
            let project = arguments.next().ok_or_else(|| {
                user_error(
                    "--project requires a path",
                    "provide a project directory or project.godot file",
                )
            })?;
            if explicit_project.replace(PathBuf::from(project)).is_some() {
                return Err(user_error(
                    "--project may be supplied only once",
                    "provide one project directory or project.godot file",
                ));
            }
            continue;
        }
        return Err(user_error(
            format!("unsupported init argument {}", argument.to_string_lossy()),
            "run wukong init --help for supported options",
        ));
    }
    Ok(explicit_project)
}

fn user_error(message: impl AsRef<str>, recovery: impl AsRef<str>) -> Box<Diagnostic> {
    boxed(Diagnostic::new(ErrorCode::UserInput, message).with_recovery(recovery))
}

fn render_error(diagnostic: &Diagnostic) -> ProcessExit {
    eprintln!("{}", render_human(diagnostic, false));
    ProcessExit::from_diagnostic(diagnostic)
}

fn print_usage() {
    println!(
        "usage: wukong <init|add|remove|update|outdated|lock|install|sync|tree|why|cache verify> [options]"
    );
}

fn boxed(diagnostic: Diagnostic) -> Box<Diagnostic> {
    Box::new(diagnostic)
}

#[cfg(test)]
mod tests {
    use super::{
        AddOptions, parse_add_arguments, parse_outdated_arguments, parse_update_arguments,
    };
    use std::{ffi::OsString, path::PathBuf};
    use wukong_core::{manifest::GitReference, manifest_edit::DependencyDeclaration};

    #[test]
    fn add_parser_accepts_git_url_and_exact_revision() {
        let options = parse_add_arguments(
            [
                "addon",
                "--git",
                "https://example.test/addon.git",
                "--rev",
                "0123456789abcdef0123456789abcdef01234567",
            ]
            .into_iter()
            .map(OsString::from),
        )
        .expect("Git add specification should parse");

        assert_eq!(
            options,
            AddOptions {
                alias: "addon".to_owned(),
                declaration: DependencyDeclaration::Git {
                    url: "https://example.test/addon.git".to_owned(),
                    reference: Some(GitReference::Rev(
                        "0123456789abcdef0123456789abcdef01234567".to_owned()
                    )),
                },
                development: false,
                project: None,
            }
        );
    }

    #[test]
    fn add_parser_accepts_checksummed_url_and_local_development_path() {
        let archive = parse_add_arguments(
            [
                "archive",
                "--url",
                "https://example.test/addon.zip",
                "--sha256",
                "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
            ]
            .into_iter()
            .map(OsString::from),
        )
        .expect("archive add specification should parse");
        let local = parse_add_arguments(
            ["tool", "--path", "../tool", "--dev"]
                .into_iter()
                .map(OsString::from),
        )
        .expect("local development add specification should parse");

        assert!(matches!(
            archive.declaration,
            DependencyDeclaration::Url { .. }
        ));
        assert_eq!(
            local,
            AddOptions {
                alias: "tool".to_owned(),
                declaration: DependencyDeclaration::Path(PathBuf::from("../tool")),
                development: true,
                project: None,
            }
        );
    }

    #[test]
    fn update_parser_accepts_selected_dry_run_offline_update() {
        let options = parse_update_arguments(
            ["addon", "--dry-run", "--offline", "--project", "game"]
                .into_iter()
                .map(OsString::from),
        )
        .expect("update specification should parse");

        assert_eq!(options.package.as_deref(), Some("addon"));
        assert!(options.dry_run);
        assert!(options.offline);
        assert_eq!(options.project, Some(PathBuf::from("game")));
    }

    #[test]
    fn update_parser_rejects_multiple_selected_packages() {
        let result = parse_update_arguments(["alpha", "beta"].into_iter().map(OsString::from));
        assert!(result.is_err());
        let error = result
            .err()
            .expect("multiple selected packages should fail");

        assert!(error.message().contains("at most one package"));
    }

    #[test]
    fn outdated_parser_accepts_json_offline_and_project() {
        let options = parse_outdated_arguments(
            ["--json", "--offline", "--project", "game"]
                .into_iter()
                .map(OsString::from),
        )
        .expect("outdated specification should parse");

        assert!(options.json);
        assert!(options.offline);
        assert_eq!(options.project, Some(PathBuf::from("game")));
    }
}
