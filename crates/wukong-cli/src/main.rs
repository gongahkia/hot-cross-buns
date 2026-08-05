/// CLI-owned diagnostic rendering and exit-code mapping.
pub mod diagnostics;

use indicatif::{ProgressBar, ProgressStyle};
use serde_json::json;
use std::{
    cell::Cell,
    collections::{BTreeMap, BTreeSet},
    env,
    ffi::OsString,
    fmt::Write as _,
    fs,
    io::IsTerminal,
    path::{Path, PathBuf},
    process,
    sync::OnceLock,
    time::Duration,
};
use wukong_core::{
    cache::{
        CacheLayout, audit_cached_packages, check_cache_permissions, clean_cache, inspect_cache,
        verify_cached_packages,
    },
    dependency_graph::{DependencyGroup, LockedDependencyGraph},
    diagnostic::{Diagnostic, ErrorCode},
    direct_lock::{
        lock_direct_dependencies_with_cancellation, update_direct_dependencies_with_cancellation,
    },
    direct_sync::{
        SyncProgress, SyncProgressObserver, SyncProgressStage,
        sync_direct_dependencies_with_cancellation,
        sync_direct_dependencies_with_progress_and_cancellation,
    },
    godot_compatibility::{
        PackageGodotCompatibilityReport, resolve_project_godot_compatibility,
        validate_locked_package_godot_compatibility,
    },
    godot_executable::discover_godot_executable,
    godot_validation::{HeadlessValidationOutcome, run_headless_project_check},
    identity::PackageName,
    init::initialize_manifest,
    installed_state::{InstalledState, create_state_directory, state_path, verify_installed_state},
    lockfile::{LOCKFILE_FILE_NAME, Lockfile},
    manifest::{GitReference, MANIFEST_FILE_NAME, Manifest},
    manifest_edit::{DependencyDeclaration, DependencySection, add_dependency, remove_dependency},
    operation_lock::AdvisoryLock,
    outdated::{OutdatedPackage, OutdatedStatus, report_outdated},
    package_metadata::{PackageMetadata, PackageMetadataInitializationOptions},
    project::ProjectRoot,
    provenance::ProvenanceReport,
    source::CancellationToken,
    source_catalog::{
        CatalogCandidate, SOURCE_CATALOG_FILE_NAME, SOURCE_CATALOG_SCHEMA, SourceCatalog,
        ValidatedCatalogCandidate, ValidatedSourceCatalog,
    },
    source_catalog_edit::{
        CatalogEditEntry, add_entry as add_catalog_entry, remove_entry as remove_catalog_entry,
    },
    transactional_file::{FileSnapshot, write_atomic},
};

use crate::diagnostics::{PROTOCOL_VERSION, ProcessExit, render_human, render_json};

thread_local! { static JSON_MODE: Cell<bool> = const { Cell::new(false) }; }
static CLI_CANCELLATION: OnceLock<CancellationToken> = OnceLock::new();

fn main() {
    process::exit(i32::from(run(env::args_os()).code()));
}

fn run(arguments: impl IntoIterator<Item = OsString>) -> ProcessExit {
    let mut arguments = arguments.into_iter();
    let _program = arguments.next();
    let command = arguments.next();
    let arguments = arguments.collect::<Vec<_>>();
    JSON_MODE.with(|mode| mode.set(arguments.iter().any(|argument| argument == "--json")));
    if matches!(command.as_deref(), Some(command) if command == "--version" || command == "-V") {
        if !arguments.is_empty() {
            return render_error(&user_error(
                "--version does not accept arguments",
                "run wukong --version without additional arguments",
            ));
        }
        println!("wukong {}", env!("CARGO_PKG_VERSION"));
        return ProcessExit::Success;
    }
    let arguments = arguments.into_iter();
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
        Some(command) if command == "package" => match run_package(arguments) {
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
        Some(command) if command == "audit" => match run_audit(arguments) {
            Ok(()) => ProcessExit::Success,
            Err(diagnostic) => render_error(&diagnostic),
        },
        Some(command) if command == "godot" => match run_godot(arguments) {
            Ok(()) => ProcessExit::Success,
            Err(diagnostic) => render_error(&diagnostic),
        },
        Some(command) if command == "validate" => match run_validate(arguments) {
            Ok(()) => ProcessExit::Success,
            Err(diagnostic) => render_error(&diagnostic),
        },
        Some(command) if command == "doctor" => match run_doctor(arguments) {
            Ok(()) => ProcessExit::Success,
            Err(diagnostic) => render_error(&diagnostic),
        },
        Some(command) if command == "status" => match run_status(arguments) {
            Ok(()) => ProcessExit::Success,
            Err(diagnostic) => render_error(&diagnostic),
        },
        Some(command) if command == "source" => match run_source(arguments) {
            Ok(exit) => exit,
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
    let cancellation = cli_cancellation()?;
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
    let lock = match lock_direct_dependencies_with_cancellation(
        &manifest_path,
        &manifest,
        None,
        &cache,
        false,
        &cancellation,
    ) {
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
    let compatibility = match resolve_project_godot_compatibility(&manifest, None) {
        Ok(compatibility) => compatibility,
        Err(error) => {
            return Err(rollback_add(
                error,
                &manifest_snapshot,
                Some(&manifest_bytes),
                None,
            ));
        }
    };
    let godot_report = match validate_locked_package_godot_compatibility(&lock, &compatibility) {
        Ok(report) => report,
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
    let summary = match sync_direct_dependencies_with_cancellation(
        project.path(),
        &manifest_path,
        &manifest,
        &lock,
        options.development,
        &cache,
        false,
        &cancellation,
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
    print_godot_compatibility_report(&godot_report);
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
    let cancellation = cli_cancellation()?;
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
    let lock = match lock_direct_dependencies_with_cancellation(
        &manifest_path,
        &manifest,
        None,
        &cache,
        false,
        &cancellation,
    ) {
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
    let compatibility = match resolve_project_godot_compatibility(&manifest, None) {
        Ok(compatibility) => compatibility,
        Err(error) => {
            return Err(rollback_add(
                error,
                &manifest_snapshot,
                Some(&manifest_bytes),
                None,
            ));
        }
    };
    let godot_report = match validate_locked_package_godot_compatibility(&lock, &compatibility) {
        Ok(report) => report,
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
    let summary = match sync_direct_dependencies_with_cancellation(
        project.path(),
        &manifest_path,
        &manifest,
        &lock,
        true,
        &cache,
        false,
        &cancellation,
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
    print_godot_compatibility_report(&godot_report);
    Ok(())
}

#[allow(clippy::too_many_lines)] // coordinates lock publication and project sync
fn run_update(arguments: impl Iterator<Item = OsString>) -> Result<(), Box<Diagnostic>> {
    let options = parse_update_arguments(arguments)?;
    let cancellation = cli_cancellation()?;
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
    let updated = update_direct_dependencies_with_cancellation(
        &manifest_path,
        &manifest,
        &existing,
        selected.as_ref(),
        &cache,
        options.offline,
        &cancellation,
    )?;
    let compatibility = resolve_project_godot_compatibility(&manifest, None)?;
    let godot_report = validate_locked_package_godot_compatibility(&updated, &compatibility)?;
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
    let summary = match sync_direct_dependencies_with_cancellation(
        project.path(),
        &manifest_path,
        &manifest,
        &updated,
        true,
        &cache,
        options.offline,
        &cancellation,
    ) {
        Ok(summary) => summary,
        Err(error) => return Err(rollback_update(error, &lock_snapshot, &output)),
    };
    print_update_changes("updated", &changes);
    println!(
        "sync: {} written, {} unchanged, {} removed",
        summary.written, summary.unchanged, summary.removed
    );
    print_godot_compatibility_report(&godot_report);
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

fn print_godot_compatibility_report(report: &PackageGodotCompatibilityReport) {
    if !report.unknown().is_empty() {
        println!(
            "godot compatibility: unknown for {}",
            report
                .unknown()
                .iter()
                .map(PackageName::as_str)
                .collect::<Vec<_>>()
                .join(", ")
        );
    }
    if !report.indeterminate().is_empty() {
        println!(
            "godot compatibility: exact engine version required for {}",
            report
                .indeterminate()
                .iter()
                .map(PackageName::as_str)
                .collect::<Vec<_>>()
                .join(", ")
        );
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
    if options.json {
        emit_json_started("outdated");
    }
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
    if options.json {
        emit_json_progress("outdated", "reading-lockfile");
    }
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
        emit_json_progress("outdated", "report-ready");
        emit_json_result(&render_outdated_json(&report));
    } else {
        println!("{}", render_outdated(&report));
    }
    Ok(())
}

fn run_audit(arguments: impl Iterator<Item = OsString>) -> Result<(), Box<Diagnostic>> {
    let options = parse_audit_arguments(arguments)?;
    if options.json {
        emit_json_started("audit");
    }
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
    if options.json {
        emit_json_progress("audit", "reading-lockfile");
    }
    let lock_path = project.path().join(LOCKFILE_FILE_NAME);
    let lock = read_lockfile(&lock_path)?.ok_or_else(|| {
        user_error(
            "wukong.lock is required to audit dependency provenance",
            "run wukong lock before wukong audit",
        )
    })?;
    let report = ProvenanceReport::from_lockfile(&lock);
    if options.json {
        emit_json_progress("audit", "report-ready");
        emit_json_result(&render_audit_json(&report));
    } else {
        println!("{}", render_audit(&report));
    }
    Ok(())
}

fn run_godot(mut arguments: impl Iterator<Item = OsString>) -> Result<(), Box<Diagnostic>> {
    let command = arguments.next().ok_or_else(|| {
        user_error(
            "godot requires a subcommand",
            "run wukong godot path [--godot-executable <path>] [--verbose]",
        )
    })?;
    if command != "path" {
        return Err(user_error(
            format!("unsupported godot subcommand {}", command.to_string_lossy()),
            "run wukong godot path",
        ));
    }
    let options = parse_godot_path_arguments(arguments)?;
    let executable =
        discover_godot_executable(options.executable.as_deref())?.ok_or_else(|| {
            user_error(
                "could not locate a Godot executable",
                "set WUKONG_GODOT_EXECUTABLE or pass --godot-executable <path>",
            )
        })?;
    if options.verbose {
        println!("selected from {}", executable.source().as_str());
    }
    println!("{}", executable.path().display());
    Ok(())
}

const DEFAULT_GODOT_VALIDATION_TIMEOUT: Duration = Duration::from_secs(60);
const MAX_GODOT_VALIDATION_TIMEOUT: Duration = Duration::from_secs(600);

fn run_validate(arguments: impl Iterator<Item = OsString>) -> Result<(), Box<Diagnostic>> {
    let options = parse_validate_arguments(arguments)?;
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
    let executable =
        discover_godot_executable(options.executable.as_deref())?.ok_or_else(|| {
            user_error(
                "could not locate a Godot executable",
                "set WUKONG_GODOT_EXECUTABLE or pass --godot-executable <path>",
            )
        })?;
    if options.verbose {
        println!("selected from {}", executable.source().as_str());
    }
    let report = run_headless_project_check(&executable, project.path(), options.timeout)?;
    match report.outcome() {
        HeadlessValidationOutcome::Passed => {
            println!("validation: passed in {} ms", report.elapsed().as_millis());
            Ok(())
        }
        HeadlessValidationOutcome::Failed { exit_code, output } => {
            if options.verbose && !output.is_empty() {
                eprintln!("{output}");
            }
            let status = exit_code.map_or_else(
                || "without an exit code".to_owned(),
                |code| format!("with exit code {code}"),
            );
            Err(boxed(
                Diagnostic::new(
                    ErrorCode::SourceAccess,
                    format!("Godot headless validation failed {status}"),
                )
                .with_cause(validation_output_cause(output))
                .with_recovery(
                    "inspect the redacted validation output and correct the project error",
                ),
            ))
        }
        HeadlessValidationOutcome::TimedOut { output } => {
            if options.verbose && !output.is_empty() {
                eprintln!("{output}");
            }
            Err(boxed(
                Diagnostic::new(ErrorCode::SourceAccess, "Godot headless validation timed out")
                    .with_cause(validation_output_cause(output))
                    .with_recovery(
                        "fix the stalled project check or raise --timeout-seconds within its 600-second limit",
                    ),
            ))
        }
    }
}

fn validation_output_cause(output: &str) -> &str {
    if output.is_empty() {
        "Godot produced no diagnostic output"
    } else {
        output
    }
}

#[derive(Debug)]
struct ValidateOptions {
    project: Option<PathBuf>,
    executable: Option<PathBuf>,
    timeout: Duration,
    verbose: bool,
}

fn parse_validate_arguments(
    mut arguments: impl Iterator<Item = OsString>,
) -> Result<ValidateOptions, Box<Diagnostic>> {
    let mut options = ValidateOptions {
        project: None,
        executable: None,
        timeout: DEFAULT_GODOT_VALIDATION_TIMEOUT,
        verbose: false,
    };
    let mut timeout_set = false;
    while let Some(argument) = arguments.next() {
        if argument == "--project" {
            let project = PathBuf::from(required_add_value(&mut arguments, "--project")?);
            if options.project.replace(project).is_some() {
                return Err(user_error(
                    "--project may be supplied only once",
                    "provide one project directory or project.godot file",
                ));
            }
            continue;
        }
        if argument == "--godot-executable" {
            let executable =
                PathBuf::from(required_add_value(&mut arguments, "--godot-executable")?);
            if options.executable.replace(executable).is_some() {
                return Err(user_error(
                    "--godot-executable may be supplied only once",
                    "provide one executable path",
                ));
            }
            continue;
        }
        if argument == "--timeout-seconds" {
            if timeout_set {
                return Err(user_error(
                    "--timeout-seconds may be supplied only once",
                    "provide one timeout from 1 to 600 seconds",
                ));
            }
            let seconds = required_add_value(&mut arguments, "--timeout-seconds")?
                .parse::<u64>()
                .map_err(|_| {
                    user_error(
                        "--timeout-seconds must be an integer",
                        "provide a timeout from 1 to 600 seconds",
                    )
                })?;
            if seconds == 0 || seconds > MAX_GODOT_VALIDATION_TIMEOUT.as_secs() {
                return Err(user_error(
                    "--timeout-seconds must be from 1 to 600",
                    "provide a timeout from 1 to 600 seconds",
                ));
            }
            options.timeout = Duration::from_secs(seconds);
            timeout_set = true;
            continue;
        }
        if argument == "--verbose" {
            if std::mem::replace(&mut options.verbose, true) {
                return Err(user_error(
                    "--verbose may be supplied only once",
                    "run wukong validate --verbose",
                ));
            }
            continue;
        }
        return Err(user_error(
            format!(
                "unsupported validate argument {}",
                argument.to_string_lossy()
            ),
            "use --project <path>, --godot-executable <path>, --timeout-seconds <1-600>, or --verbose",
        ));
    }
    Ok(options)
}

struct DoctorOptions {
    project: Option<PathBuf>,
    executable: Option<PathBuf>,
    offline: bool,
}

struct DoctorCheck {
    name: &'static str,
    detail: String,
    passed: bool,
}

#[allow(clippy::too_many_lines)] // aggregates independent diagnostic checks
fn run_doctor(arguments: impl Iterator<Item = OsString>) -> Result<(), Box<Diagnostic>> {
    let options = parse_doctor_arguments(arguments)?;
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
    let mut checks = Vec::new();
    let mut failure = None;
    record_doctor_check(
        &mut checks,
        &mut failure,
        "project discovery",
        Ok("project.godot found".to_owned()),
    );
    let manifest_path = project.path().join(MANIFEST_FILE_NAME);
    record_doctor_check(
        &mut checks,
        &mut failure,
        "manifest validity",
        read_manifest(&manifest_path).map(|_| "wukong.toml parsed".to_owned()),
    );
    let lock_path = project.path().join(LOCKFILE_FILE_NAME);
    record_doctor_check(
        &mut checks,
        &mut failure,
        "lockfile validity",
        match read_lockfile(&lock_path) {
            Ok(Some(_)) => Ok("wukong.lock parsed".to_owned()),
            Ok(None) => Err(user_error(
                "wukong.lock is missing",
                "run wukong lock to create it",
            )),
            Err(error) => Err(error),
        },
    );
    record_doctor_check(
        &mut checks,
        &mut failure,
        "state-file consistency",
        doctor_state_check(project.path()),
    );
    match CacheLayout::from_environment() {
        Ok(cache) => {
            record_doctor_check(
                &mut checks,
                &mut failure,
                "cache permissions",
                check_cache_permissions(&cache)
                    .map(|()| "temporary cache probe succeeded".to_owned()),
            );
            record_doctor_check(
                &mut checks,
                &mut failure,
                "cache corruption",
                doctor_cache_check(&cache),
            );
        }
        Err(error) => {
            let detail = error.message().to_owned();
            record_doctor_check(&mut checks, &mut failure, "cache permissions", Err(error));
            record_doctor_check(
                &mut checks,
                &mut failure,
                "cache corruption",
                Err(user_error(
                    format!("cache audit skipped: {detail}"),
                    "configure a usable cache directory and rerun wukong doctor",
                )),
            );
        }
    }
    record_doctor_check(
        &mut checks,
        &mut failure,
        "filesystem capability",
        fs::read_dir(project.path())
            .map(|_| "project root is readable".to_owned())
            .map_err(|error| {
                boxed(
                    Diagnostic::new(
                        ErrorCode::InternalFailure,
                        "could not read the project filesystem",
                    )
                    .with_cause(error)
                    .with_recovery("check project permissions and retry"),
                )
            }),
    );
    record_doctor_check(
        &mut checks,
        &mut failure,
        "Godot executable availability",
        match discover_godot_executable(options.executable.as_deref()) {
            Ok(Some(executable)) => Ok(format!("found from {}", executable.source().as_str())),
            Ok(None) => Err(user_error(
                "could not locate a Godot executable",
                "set WUKONG_GODOT_EXECUTABLE or pass --godot-executable <path>",
            )),
            Err(error) => Err(error),
        },
    );
    record_doctor_check(
        &mut checks,
        &mut failure,
        "network configuration",
        doctor_network_check(options.offline),
    );
    record_doctor_check(
        &mut checks,
        &mut failure,
        "concurrent operation locks",
        doctor_lock_check(project.path()),
    );
    println!("doctor:");
    for check in checks {
        let status = if check.passed { "ok" } else { "fail" };
        println!("{status} {}: {}", check.name, check.detail);
    }
    failure.map_or(Ok(()), Err)
}

struct StatusOptions {
    project: Option<PathBuf>,
    json: bool,
}

fn run_status(arguments: impl Iterator<Item = OsString>) -> Result<(), Box<Diagnostic>> {
    let options = parse_status_arguments(arguments)?;
    if options.json {
        emit_json_started("status");
    }
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
    if options.json {
        emit_json_progress("status", "reading-installed-state");
    }
    let packages = read_installed_packages(project.path())?;
    if options.json {
        emit_json_result(&render_status_json(&packages));
    } else if packages.is_empty() {
        println!("installed packages: none");
    } else {
        println!("installed packages:");
        for package in packages.values() {
            println!(
                "{} {} sha256:{}",
                package.name(),
                package.source_immutable_id(),
                package.package_sha256()
            );
        }
    }
    Ok(())
}

fn parse_status_arguments(
    mut arguments: impl Iterator<Item = OsString>,
) -> Result<StatusOptions, Box<Diagnostic>> {
    let mut options = StatusOptions {
        project: None,
        json: false,
    };
    while let Some(argument) = arguments.next() {
        if argument == "--json" {
            if std::mem::replace(&mut options.json, true) {
                return Err(user_error(
                    "--json may be supplied only once",
                    "run wukong status --json",
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
            format!("unsupported status argument {}", argument.to_string_lossy()),
            "use --json or --project <path>",
        ));
    }
    Ok(options)
}

fn read_installed_packages(
    project_root: &std::path::Path,
) -> Result<BTreeMap<PackageName, wukong_core::installed_state::InstalledPackage>, Box<Diagnostic>>
{
    let path = state_path(project_root);
    match fs::read_to_string(&path) {
        Ok(input) => Ok(InstalledState::parse(&path, &input)?.packages().clone()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(BTreeMap::new()),
        Err(error) => Err(boxed(
            Diagnostic::new(ErrorCode::InternalFailure, "could not read installed state")
                .with_cause(error)
                .with_recovery("check .wukong/state.toml permissions and retry"),
        )),
    }
}

fn render_status_json(
    packages: &BTreeMap<PackageName, wukong_core::installed_state::InstalledPackage>,
) -> String {
    json!({
        "schema": 1,
        "packages": packages.values().map(|package| json!({
            "name": package.name().as_str(),
            "immutable_id": package.source_immutable_id().as_str(),
            "package_checksum": package.package_sha256(),
        })).collect::<Vec<_>>(),
    })
    .to_string()
}

fn run_source(
    mut arguments: impl Iterator<Item = OsString>,
) -> Result<ProcessExit, Box<Diagnostic>> {
    match arguments.next().as_deref() {
        Some(command) if command == "list" => {
            run_source_list(arguments).map(|()| ProcessExit::Success)
        }
        Some(command) if command == "validate" => run_source_validate(arguments),
        Some(command) if command == "add" => {
            run_source_add(arguments).map(|()| ProcessExit::Success)
        }
        Some(command) if command == "remove" => {
            run_source_catalog_remove(arguments).map(|()| ProcessExit::Success)
        }
        Some(command) => Err(user_error(
            format!("unsupported source command {}", command.to_string_lossy()),
            "run wukong source <add|list|remove|validate> [options]",
        )),
        None => Err(user_error(
            "source requires a subcommand",
            "run wukong source <add|list|remove|validate> [options]",
        )),
    }
}

struct SourceReadOptions {
    project: Option<PathBuf>,
    json: bool,
}

fn run_source_list(arguments: impl Iterator<Item = OsString>) -> Result<(), Box<Diagnostic>> {
    let options = parse_source_read_arguments(arguments, "list")?;
    if options.json {
        emit_json_started("source-list");
    }
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
    let path = project.path().join(SOURCE_CATALOG_FILE_NAME);
    if options.json {
        emit_json_progress("source-list", "reading-catalog");
    }
    let catalog = SourceCatalog::load(&path)?.validate(&path)?;
    if options.json {
        emit_json_result(&render_source_list_json(&catalog));
    } else {
        render_source_list_human(&catalog);
    }
    Ok(())
}

fn run_source_validate(
    arguments: impl Iterator<Item = OsString>,
) -> Result<ProcessExit, Box<Diagnostic>> {
    let options = parse_source_read_arguments(arguments, "validate")?;
    if options.json {
        emit_json_started("source-validate");
    }
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
    let path = project.path().join(SOURCE_CATALOG_FILE_NAME);
    if options.json {
        emit_json_progress("source-validate", "validating-catalog");
    }
    let catalog = SourceCatalog::load(&path)?;
    match catalog.validate_all(&path) {
        Ok(_) => {
            if options.json {
                emit_json_result(
                    &json!({"schema": SOURCE_CATALOG_SCHEMA, "valid": true}).to_string(),
                );
            } else {
                println!("source catalog: valid");
            }
            Ok(ProcessExit::Success)
        }
        Err(errors) => {
            for error in errors {
                if options.json {
                    eprintln!("{}", render_json(&error));
                } else {
                    eprintln!("{}", render_human(&error, false));
                }
            }
            Ok(ProcessExit::User)
        }
    }
}

struct SourceAddOptions {
    name: String,
    entry: CatalogEditEntry,
    project: Option<PathBuf>,
}

fn run_source_add(arguments: impl Iterator<Item = OsString>) -> Result<(), Box<Diagnostic>> {
    let options = parse_source_add_arguments(arguments)?;
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
    let path = project.path().join(SOURCE_CATALOG_FILE_NAME);
    add_catalog_entry(&path, &options.entry)?;
    println!("added source candidate {}", options.name);
    Ok(())
}

fn parse_source_add_arguments(
    mut arguments: impl Iterator<Item = OsString>,
) -> Result<SourceAddOptions, Box<Diagnostic>> {
    let name = arguments.next().ok_or_else(|| {
        user_error(
            "source add requires a package name",
            "run wukong source add <name> --git <url> --root <path> or --url <url> --version <version> --sha256 <hash> --root <path>",
        )
    })?;
    let name = name.to_string_lossy().into_owned();
    let mut git = None;
    let mut url = None;
    let mut root = None;
    let mut version = None;
    let mut sha256 = None;
    let mut tag_prefix = None;
    let mut project = None;
    while let Some(argument) = arguments.next() {
        if argument == "--git" {
            set_source_add_value(&mut git, &mut arguments, "--git")?;
            continue;
        }
        if argument == "--url" {
            set_source_add_value(&mut url, &mut arguments, "--url")?;
            continue;
        }
        if argument == "--root" {
            set_source_add_value(&mut root, &mut arguments, "--root")?;
            continue;
        }
        if argument == "--version" {
            set_source_add_value(&mut version, &mut arguments, "--version")?;
            continue;
        }
        if argument == "--sha256" {
            set_source_add_value(&mut sha256, &mut arguments, "--sha256")?;
            continue;
        }
        if argument == "--tag-prefix" {
            set_source_add_value(&mut tag_prefix, &mut arguments, "--tag-prefix")?;
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
            format!(
                "unsupported source add argument {}",
                argument.to_string_lossy()
            ),
            "use --git --root [--tag-prefix] or --url --version --sha256 --root",
        ));
    }
    let root = root.ok_or_else(|| {
        user_error(
            "source add requires --root",
            "provide a safe source-relative package root",
        )
    })?;
    let entry = match (git, url) {
        (Some(url), None) if version.is_none() && sha256.is_none() => CatalogEditEntry::Git {
            name: name.clone(),
            url,
            root: PathBuf::from(root),
            tag_prefix,
        },
        (None, Some(url)) if tag_prefix.is_none() => CatalogEditEntry::Http {
            name: name.clone(),
            version: version.ok_or_else(|| {
                user_error(
                    "--url requires --version",
                    "provide the complete archive semantic version",
                )
            })?,
            url,
            sha256: sha256.ok_or_else(|| {
                user_error(
                    "--url requires --sha256",
                    "provide the expected 64-character SHA-256 checksum",
                )
            })?,
            root: PathBuf::from(root),
        },
        _ => {
            return Err(user_error(
                "source add requires exactly one complete source declaration",
                "use --git --root [--tag-prefix] or --url --version --sha256 --root",
            ));
        }
    };
    Ok(SourceAddOptions {
        name,
        entry,
        project,
    })
}

fn set_source_add_value(
    destination: &mut Option<String>,
    arguments: &mut impl Iterator<Item = OsString>,
    option: &str,
) -> Result<(), Box<Diagnostic>> {
    let value = required_add_value(arguments, option)?;
    if destination.replace(value).is_some() {
        return Err(user_error(
            format!("{option} may be supplied only once"),
            "remove the repeated option",
        ));
    }
    Ok(())
}

struct SourceRemoveOptions {
    name: String,
    entry: Option<CatalogEditEntry>,
    project: Option<PathBuf>,
}

struct SourceRemoveFields {
    git: Option<String>,
    url: Option<String>,
    root: Option<String>,
    version: Option<String>,
    sha256: Option<String>,
    tag_prefix: Option<String>,
    project: Option<PathBuf>,
}

fn run_source_catalog_remove(
    arguments: impl Iterator<Item = OsString>,
) -> Result<(), Box<Diagnostic>> {
    let options = parse_source_remove_arguments(arguments)?;
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
    let path = project.path().join(SOURCE_CATALOG_FILE_NAME);
    let entry = match options.entry {
        Some(entry) => entry,
        None => select_single_catalog_entry(&path, &options.name)?,
    };
    remove_catalog_entry(&path, &entry)?;
    println!("removed source candidate {}", options.name);
    Ok(())
}

fn parse_source_remove_arguments(
    mut arguments: impl Iterator<Item = OsString>,
) -> Result<SourceRemoveOptions, Box<Diagnostic>> {
    let name = arguments.next().ok_or_else(|| {
        user_error(
            "source remove requires a package name",
            "run wukong source remove <name> [--git <url> --root <path> | --url <url> --version <version> --sha256 <hash> --root <path>]",
        )
    })?;
    let name = name.to_string_lossy().into_owned();
    let SourceRemoveFields {
        git,
        url,
        root,
        version,
        sha256,
        tag_prefix,
        project,
    } = parse_source_remove_fields(&mut arguments)?;
    if git.is_none()
        && url.is_none()
        && root.is_none()
        && version.is_none()
        && sha256.is_none()
        && tag_prefix.is_none()
    {
        return Ok(SourceRemoveOptions {
            name,
            entry: None,
            project,
        });
    }
    let root = root.ok_or_else(|| {
        user_error(
            "source remove requires --root for an exact candidate selection",
            "provide every source candidate field or remove an unambiguous package name",
        )
    })?;
    let entry = match (git, url) {
        (Some(url), None) if version.is_none() && sha256.is_none() => CatalogEditEntry::Git {
            name: name.clone(),
            url,
            root: PathBuf::from(root),
            tag_prefix,
        },
        (None, Some(url)) if tag_prefix.is_none() => CatalogEditEntry::Http {
            name: name.clone(),
            version: version.ok_or_else(|| {
                user_error(
                    "--url requires --version",
                    "provide the complete archive semantic version",
                )
            })?,
            url,
            sha256: sha256.ok_or_else(|| {
                user_error(
                    "--url requires --sha256",
                    "provide the expected 64-character SHA-256 checksum",
                )
            })?,
            root: PathBuf::from(root),
        },
        _ => {
            return Err(user_error(
                "source remove requires exactly one complete source declaration",
                "use --git --root [--tag-prefix] or --url --version --sha256 --root",
            ));
        }
    };
    Ok(SourceRemoveOptions {
        name,
        entry: Some(entry),
        project,
    })
}

fn parse_source_remove_fields(
    arguments: &mut impl Iterator<Item = OsString>,
) -> Result<SourceRemoveFields, Box<Diagnostic>> {
    let mut git = None;
    let mut url = None;
    let mut root = None;
    let mut version = None;
    let mut sha256 = None;
    let mut tag_prefix = None;
    let mut project = None;
    while let Some(argument) = arguments.next() {
        if argument == "--git" {
            set_source_add_value(&mut git, arguments, "--git")?;
            continue;
        }
        if argument == "--url" {
            set_source_add_value(&mut url, arguments, "--url")?;
            continue;
        }
        if argument == "--root" {
            set_source_add_value(&mut root, arguments, "--root")?;
            continue;
        }
        if argument == "--version" {
            set_source_add_value(&mut version, arguments, "--version")?;
            continue;
        }
        if argument == "--sha256" {
            set_source_add_value(&mut sha256, arguments, "--sha256")?;
            continue;
        }
        if argument == "--tag-prefix" {
            set_source_add_value(&mut tag_prefix, arguments, "--tag-prefix")?;
            continue;
        }
        if argument == "--project" {
            let path = PathBuf::from(required_add_value(arguments, "--project")?);
            if project.replace(path).is_some() {
                return Err(user_error(
                    "--project may be supplied only once",
                    "provide one project directory or project.godot file",
                ));
            }
            continue;
        }
        return Err(user_error(
            format!(
                "unsupported source remove argument {}",
                argument.to_string_lossy()
            ),
            "use --git --root [--tag-prefix] or --url --version --sha256 --root",
        ));
    }
    Ok(SourceRemoveFields {
        git,
        url,
        root,
        version,
        sha256,
        tag_prefix,
        project,
    })
}

fn select_single_catalog_entry(
    path: &Path,
    name: &str,
) -> Result<CatalogEditEntry, Box<Diagnostic>> {
    let catalog = SourceCatalog::load(path)?;
    catalog.validate(path)?;
    let candidates = catalog.packages().get(name).ok_or_else(|| {
        user_error(
            format!("source catalog has no candidate for {name}"),
            "run wukong source list to select an existing candidate",
        )
    })?;
    match candidates.as_slice() {
        [candidate] => Ok(catalog_entry_from_candidate(name, candidate)),
        [] => Err(user_error(
            format!("source catalog has no candidate for {name}"),
            "run wukong source list to select an existing candidate",
        )),
        _ => Err(user_error(
            format!("source catalog candidate selection for {name} is ambiguous"),
            "specify one candidate with --git or --url and its complete fields",
        )),
    }
}

fn catalog_entry_from_candidate(name: &str, candidate: &CatalogCandidate) -> CatalogEditEntry {
    match candidate {
        CatalogCandidate::Git(candidate) => CatalogEditEntry::Git {
            name: name.to_owned(),
            url: candidate.url().to_owned(),
            root: candidate.root().to_path_buf(),
            tag_prefix: candidate.tag_prefix().map(str::to_owned),
        },
        CatalogCandidate::Http(candidate) => CatalogEditEntry::Http {
            name: name.to_owned(),
            version: candidate.version().to_owned(),
            url: candidate.url().to_owned(),
            sha256: candidate.sha256().to_owned(),
            root: candidate.root().to_path_buf(),
        },
    }
}

fn parse_source_read_arguments(
    mut arguments: impl Iterator<Item = OsString>,
    command: &str,
) -> Result<SourceReadOptions, Box<Diagnostic>> {
    let mut options = SourceReadOptions {
        project: None,
        json: false,
    };
    while let Some(argument) = arguments.next() {
        if argument == "--json" {
            if std::mem::replace(&mut options.json, true) {
                return Err(user_error(
                    "--json may be supplied only once",
                    format!("run wukong source {command} --json"),
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
                "unsupported source {command} argument {}",
                argument.to_string_lossy()
            ),
            "use --json or --project <path>",
        ));
    }
    Ok(options)
}

fn render_source_list_human(catalog: &ValidatedSourceCatalog) {
    if catalog.packages().is_empty() {
        println!("source catalog: no candidates");
        return;
    }
    for (name, candidates) in catalog.packages() {
        println!("{name}:");
        for candidate in candidates {
            match candidate {
                ValidatedCatalogCandidate::Git(candidate) => {
                    print!(
                        "  git url={} root={}",
                        candidate.source().as_str(),
                        candidate.root().display()
                    );
                    if let Some(prefix) = candidate.tag_prefix() {
                        print!(" tag-prefix={}", prefix.as_str());
                    }
                    println!();
                }
                ValidatedCatalogCandidate::Http(candidate) => println!(
                    "  http version={} url={} sha256={} root={}",
                    candidate.version(),
                    candidate.url(),
                    candidate.sha256(),
                    candidate.root().display(),
                ),
            }
        }
    }
}

fn render_source_list_json(catalog: &ValidatedSourceCatalog) -> String {
    json!({
        "schema": SOURCE_CATALOG_SCHEMA,
        "packages": catalog.packages().iter().map(|(name, candidates)| json!({
            "name": name.as_str(),
            "candidates": candidates.iter().map(|candidate| match candidate {
                ValidatedCatalogCandidate::Git(candidate) => json!({
                    "kind": "git",
                    "url": candidate.source().as_str(),
                    "root": candidate.root().to_string_lossy(),
                    "tag_prefix": candidate.tag_prefix().map(wukong_core::git_fetch::GitTagPrefix::as_str),
                }),
                ValidatedCatalogCandidate::Http(candidate) => json!({
                    "kind": "http",
                    "version": candidate.version().to_string(),
                    "url": candidate.url(),
                    "sha256": candidate.sha256(),
                    "root": candidate.root().to_string_lossy(),
                }),
            }).collect::<Vec<_>>(),
        })).collect::<Vec<_>>(),
    })
    .to_string()
}

fn parse_doctor_arguments(
    mut arguments: impl Iterator<Item = OsString>,
) -> Result<DoctorOptions, Box<Diagnostic>> {
    let mut options = DoctorOptions {
        project: None,
        executable: None,
        offline: false,
    };
    while let Some(argument) = arguments.next() {
        if argument == "--project" {
            let project = PathBuf::from(required_add_value(&mut arguments, "--project")?);
            if options.project.replace(project).is_some() {
                return Err(user_error(
                    "--project may be supplied only once",
                    "provide one project directory or project.godot file",
                ));
            }
            continue;
        }
        if argument == "--godot-executable" {
            let executable =
                PathBuf::from(required_add_value(&mut arguments, "--godot-executable")?);
            if options.executable.replace(executable).is_some() {
                return Err(user_error(
                    "--godot-executable may be supplied only once",
                    "provide one executable path",
                ));
            }
            continue;
        }
        if argument == "--offline" {
            if std::mem::replace(&mut options.offline, true) {
                return Err(user_error(
                    "--offline may be supplied only once",
                    "run wukong doctor --offline",
                ));
            }
            continue;
        }
        return Err(user_error(
            format!("unsupported doctor argument {}", argument.to_string_lossy()),
            "use --project <path>, --godot-executable <path>, or --offline",
        ));
    }
    Ok(options)
}

fn record_doctor_check(
    checks: &mut Vec<DoctorCheck>,
    failure: &mut Option<Box<Diagnostic>>,
    name: &'static str,
    result: Result<String, Box<Diagnostic>>,
) {
    match result {
        Ok(detail) => checks.push(DoctorCheck {
            name,
            detail,
            passed: true,
        }),
        Err(error) => {
            checks.push(DoctorCheck {
                name,
                detail: error.message().to_owned(),
                passed: false,
            });
            if failure.is_none() {
                *failure = Some(error);
            }
        }
    }
}

fn doctor_state_check(project_root: &std::path::Path) -> Result<String, Box<Diagnostic>> {
    let path = state_path(project_root);
    let input = match fs::read_to_string(&path) {
        Ok(input) => input,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok("no installed state".to_owned());
        }
        Err(error) => {
            return Err(boxed(
                Diagnostic::new(ErrorCode::InternalFailure, "could not read installed state")
                    .with_cause(error)
                    .with_recovery("check .wukong/state.toml permissions and retry"),
            ));
        }
    };
    let state = InstalledState::parse(&path, &input)?;
    let verification = verify_installed_state(project_root, &state)?;
    if verification.missing_files() == 0 && verification.modified_files() == 0 {
        return Ok(format!(
            "{} owned file(s) verified",
            verification.verified_files()
        ));
    }
    Err(boxed(
        Diagnostic::new(
            ErrorCode::IntegrityFailure,
            format!(
                "installed state has {} missing and {} modified file(s)",
                verification.missing_files(),
                verification.modified_files()
            ),
        )
        .with_recovery("run wukong sync after restoring or preserving intended project edits"),
    ))
}

fn doctor_cache_check(cache: &CacheLayout) -> Result<String, Box<Diagnostic>> {
    let audit = audit_cached_packages(cache)?;
    if audit.corrupt_packages() == 0 && audit.unrecognized_entries() == 0 {
        return Ok(format!(
            "{} prepared package object(s) verified",
            audit.verified_packages()
        ));
    }
    Err(boxed(
        Diagnostic::new(
            ErrorCode::IntegrityFailure,
            format!(
                "cache has {} corrupt and {} unrecognized package entry(s)",
                audit.corrupt_packages(),
                audit.unrecognized_entries()
            ),
        )
        .with_recovery("run wukong cache verify and inspect any unrecognized cache entries"),
    ))
}

fn doctor_network_check(offline: bool) -> Result<String, Box<Diagnostic>> {
    if offline {
        return Ok("skipped (--offline)".to_owned());
    }
    let configured = ["HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy"]
        .iter()
        .filter_map(env::var_os)
        .collect::<Vec<_>>();
    if configured.is_empty() {
        return Ok("no proxy configured".to_owned());
    }
    if configured.iter().all(|value| valid_proxy_url(value)) {
        Ok("proxy configuration is URL-like".to_owned())
    } else {
        Err(user_error(
            "proxy configuration is not an HTTP(S) URL-like value",
            "set HTTP_PROXY or HTTPS_PROXY to an HTTP(S) value without whitespace",
        ))
    }
}

fn valid_proxy_url(value: &std::ffi::OsStr) -> bool {
    let Some(value) = value.to_str() else {
        return false;
    };
    let Some(authority) = value
        .strip_prefix("http://")
        .or_else(|| value.strip_prefix("https://"))
    else {
        return false;
    };
    !authority.is_empty() && !authority.chars().any(char::is_whitespace)
}

fn doctor_lock_check(project_root: &std::path::Path) -> Result<String, Box<Diagnostic>> {
    let state = create_state_directory(project_root)?;
    let lock = AdvisoryLock::try_acquire(&state.join("mutation.lock"), "this project")?;
    drop(lock);
    Ok("project mutation lock acquired".to_owned())
}

struct GodotPathOptions {
    executable: Option<PathBuf>,
    verbose: bool,
}

fn parse_godot_path_arguments(
    mut arguments: impl Iterator<Item = OsString>,
) -> Result<GodotPathOptions, Box<Diagnostic>> {
    let mut options = GodotPathOptions {
        executable: None,
        verbose: false,
    };
    while let Some(argument) = arguments.next() {
        if argument == "--godot-executable" {
            let path = PathBuf::from(required_add_value(&mut arguments, "--godot-executable")?);
            if options.executable.replace(path).is_some() {
                return Err(user_error(
                    "--godot-executable may be supplied only once",
                    "provide one executable path",
                ));
            }
            continue;
        }
        if argument == "--verbose" {
            if std::mem::replace(&mut options.verbose, true) {
                return Err(user_error(
                    "--verbose may be supplied only once",
                    "run wukong godot path --verbose",
                ));
            }
            continue;
        }
        return Err(user_error(
            format!(
                "unsupported godot path argument {}",
                argument.to_string_lossy()
            ),
            "use --godot-executable <path> or --verbose",
        ));
    }
    Ok(options)
}

struct OutdatedOptions {
    json: bool,
    offline: bool,
    project: Option<PathBuf>,
}

struct AuditOptions {
    json: bool,
    project: Option<PathBuf>,
}

fn parse_audit_arguments(
    mut arguments: impl Iterator<Item = OsString>,
) -> Result<AuditOptions, Box<Diagnostic>> {
    let mut options = AuditOptions {
        json: false,
        project: None,
    };
    while let Some(argument) = arguments.next() {
        if argument == "--json" {
            if std::mem::replace(&mut options.json, true) {
                return Err(user_error(
                    "--json may be supplied only once",
                    "run wukong audit --json",
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
            format!("unsupported audit argument {}", argument.to_string_lossy()),
            "use --json or --project <path>",
        ));
    }
    Ok(options)
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

fn render_audit(report: &ProvenanceReport) -> String {
    let mut lines = vec![
        "audit format: 1".to_owned(),
        "signature verification: not implemented".to_owned(),
    ];
    for package in report.packages() {
        lines.push(String::new());
        lines.push(package.name().to_string());
        lines.push(format!("  source kind: {}", package.source_kind().as_str()));
        lines.push(format!(
            "  canonical source: {}",
            package.canonical_source()
        ));
        lines.push(format!("  immutable identity: {}", package.immutable_id()));
        lines.push(format!(
            "  immutable revision: {}",
            package.immutable_revision().unwrap_or("unavailable")
        ));
        lines.push(format!(
            "  source checksum: {}",
            package.source_sha256().unwrap_or("unavailable")
        ));
        lines.push(format!("  package checksum: {}", package.package_sha256()));
    }
    lines.join("\n")
}

fn render_audit_json(report: &ProvenanceReport) -> String {
    let packages = report
        .packages()
        .iter()
        .map(|package| {
            let revision = package
                .immutable_revision()
                .map_or_else(|| "null".to_owned(), json_string);
            let source_checksum = package
                .source_sha256()
                .map_or_else(|| "null".to_owned(), json_string);
            format!(
                "{{\"name\":{},\"source_kind\":{},\"canonical_source\":{},\"immutable_id\":{},\"immutable_revision\":{revision},\"source_checksum\":{source_checksum},\"package_checksum\":{}}}",
                json_string(&package.name().to_string()),
                json_string(package.source_kind().as_str()),
                json_string(package.canonical_source()),
                json_string(package.immutable_id().as_str()),
                json_string(package.package_sha256()),
            )
        })
        .collect::<Vec<_>>()
        .join(",");
    format!(
        "{{\"schema\":1,\"signature_verification\":\"not_implemented\",\"packages\":[{packages}]}}"
    )
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
    if options.json {
        emit_json_started("tree");
        emit_json_progress("tree", "reading-lockfile");
    }
    let graph = load_dependency_graph(options.project.as_deref())?;
    if options.json {
        emit_json_progress("tree", "graph-ready");
        emit_json_result(&render_tree_json(&graph));
    } else {
        println!("{}", render_tree(&graph));
    }
    Ok(())
}

fn run_why(arguments: impl Iterator<Item = OsString>) -> Result<(), Box<Diagnostic>> {
    let options = parse_view_arguments(arguments, true)?;
    if options.json {
        emit_json_started("why");
    }
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
    if options.json {
        emit_json_progress("why", "reading-lockfile");
    }
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
        emit_json_progress("why", "paths-ready");
        emit_json_result(&render_why_json(&target, &paths));
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

fn render_sync_json(
    summary: &wukong_core::project_sync::SyncSummary,
    godot: &PackageGodotCompatibilityReport,
) -> String {
    json!({
        "schema": 1,
        "written": summary.written,
        "unchanged": summary.unchanged,
        "removed": summary.removed,
        "godot": {
            "unknown": godot.unknown().iter().map(PackageName::as_str).collect::<Vec<_>>(),
            "indeterminate": godot.indeterminate().iter().map(PackageName::as_str).collect::<Vec<_>>(),
        },
    })
    .to_string()
}

fn emit_json_started(command: &str) {
    println!(
        "{}",
        json!({"protocol": PROTOCOL_VERSION, "type": "started", "command": command})
    );
}

fn emit_json_progress(command: &str, phase: &str) {
    println!(
        "{}",
        json!({"protocol": PROTOCOL_VERSION, "type": "progress", "command": command, "phase": phase})
    );
}

fn emit_json_sync_package_progress(progress: &SyncProgress) {
    let phase = match progress.stage() {
        SyncProgressStage::ValidatingSource => "validating-source",
        SyncProgressStage::PreparingPackage => "preparing-package",
        SyncProgressStage::Prepared => "package-ready",
    };
    println!(
        "{}",
        json!({
            "protocol": PROTOCOL_VERSION,
            "type": "progress",
            "command": "sync",
            "phase": phase,
            "package": progress.package().as_str(),
            "completed": progress.completed(),
            "total": progress.total(),
        })
    );
}

fn emit_json_result(result: &str) {
    println!("{{\"protocol\":{PROTOCOL_VERSION},\"type\":\"result\",\"result\":{result}}}");
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
                let _ = write!(output, "\\u{:04x}", u32::from(character));
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
            "run wukong cache <dir|status|clean|verify>",
        )
    })?;
    let layout = CacheLayout::from_environment()?;
    match command.to_str() {
        Some("dir") => {
            cache_arguments_empty(&mut arguments, "dir")?;
            println!("{}", layout.schema_root().display());
            Ok(())
        }
        Some("status") => {
            cache_arguments_empty(&mut arguments, "status")?;
            let status = inspect_cache(&layout)?;
            let recognized = status
                .prepared_package_bytes()
                .saturating_add(status.archive_bytes());
            println!(
                "cache status: {}\nprepared packages: {} ({})\narchives: {} ({})\nother cache data: {}\ntotal: {}",
                layout.schema_root().display(),
                status.prepared_packages(),
                human_bytes(status.prepared_package_bytes()),
                status.archives(),
                human_bytes(status.archive_bytes()),
                human_bytes(status.total_bytes().saturating_sub(recognized)),
                human_bytes(status.total_bytes()),
            );
            Ok(())
        }
        Some("clean") => {
            let dry_run = parse_cache_clean_arguments(&mut arguments)?;
            let report = clean_cache(&layout, dry_run)?;
            let action = if report.dry_run() {
                "cache clean dry-run"
            } else {
                "cache clean"
            };
            println!(
                "{action}: {} prepared package(s), {} archive(s), {}",
                report.prepared_packages(),
                report.archives(),
                human_bytes(report.reclaimed_bytes()),
            );
            Ok(())
        }
        Some("verify") => run_cache_verify(&layout, &mut arguments),
        _ => Err(user_error(
            format!("unsupported cache command {}", command.to_string_lossy()),
            "run wukong cache <dir|status|clean|verify>",
        )),
    }
}

fn cache_arguments_empty(
    arguments: &mut impl Iterator<Item = OsString>,
    command: &str,
) -> Result<(), Box<Diagnostic>> {
    if let Some(argument) = arguments.next() {
        return Err(user_error(
            format!(
                "unsupported cache {command} argument {}",
                argument.to_string_lossy()
            ),
            format!("run wukong cache {command} without additional arguments"),
        ));
    }
    Ok(())
}

fn parse_cache_clean_arguments(
    arguments: &mut impl Iterator<Item = OsString>,
) -> Result<bool, Box<Diagnostic>> {
    let mut dry_run = false;
    for argument in arguments.by_ref() {
        if argument == "--dry-run" && !dry_run {
            dry_run = true;
            continue;
        }
        return Err(user_error(
            format!(
                "unsupported cache clean argument {}",
                argument.to_string_lossy()
            ),
            "run wukong cache clean [--dry-run]",
        ));
    }
    Ok(dry_run)
}

fn run_cache_verify(
    layout: &CacheLayout,
    arguments: &mut impl Iterator<Item = OsString>,
) -> Result<(), Box<Diagnostic>> {
    cache_arguments_empty(arguments, "verify")?;
    let report = verify_cached_packages(layout)?;
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

fn human_bytes(bytes: u64) -> String {
    const UNITS: [&str; 6] = ["B", "KiB", "MiB", "GiB", "TiB", "PiB"];
    if bytes < 1024 {
        return format!("{bytes} B");
    }
    let mut unit = 0_usize;
    let mut divisor = 1_u64;
    while unit + 1 < UNITS.len() && bytes / divisor >= 1024 {
        divisor *= 1024;
        unit += 1;
    }
    let whole = bytes / divisor;
    let tenth = bytes % divisor * 10 / divisor;
    format!("{whole}.{tenth} {}", UNITS[unit])
}

fn run_lock(arguments: impl Iterator<Item = OsString>) -> Result<(), Box<Diagnostic>> {
    let options = parse_lock_arguments(arguments)?;
    let cancellation = cli_cancellation()?;
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
    let compatibility =
        resolve_project_godot_compatibility(&manifest, options.godot_version.as_deref())?;
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
    let reusable = options.offline.then_some(existing.as_ref()).flatten();
    let locked = lock_direct_dependencies_with_cancellation(
        &manifest_path,
        &manifest,
        reusable,
        &cache,
        options.offline,
        &cancellation,
    )?;
    let godot_report = validate_locked_package_godot_compatibility(&locked, &compatibility)?;
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
        print_godot_compatibility_report(&godot_report);
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
    print_godot_compatibility_report(&godot_report);
    println!("locked {}", lock_path.display());
    Ok(())
}

fn run_sync(arguments: impl Iterator<Item = OsString>) -> Result<(), Box<Diagnostic>> {
    let options = parse_sync_arguments(arguments)?;
    if matches!(options.output, OutputFormat::Json) {
        emit_json_started("sync");
    }
    let cancellation = cli_cancellation()?;
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
    if matches!(options.output, OutputFormat::Json) {
        emit_json_progress("sync", "reading-manifest");
    }
    let manifest_path = project.path().join(MANIFEST_FILE_NAME);
    let manifest = read_manifest(&manifest_path)?;
    let compatibility =
        resolve_project_godot_compatibility(&manifest, options.godot_version.as_deref())?;
    let lock_path = project.path().join(LOCKFILE_FILE_NAME);
    let lock = read_lockfile(&lock_path)?.ok_or_else(|| {
        user_error(
            "wukong.lock is required before synchronising",
            "run wukong lock to resolve the current manifest",
        )
    })?;
    if matches!(options.output, OutputFormat::Json) {
        emit_json_progress("sync", "validating-lockfile");
    }
    let godot_report = validate_locked_package_godot_compatibility(&lock, &compatibility)?;
    let cache = CacheLayout::from_environment()?;
    if options.locked {
        let expected = lock_direct_dependencies_with_cancellation(
            &manifest_path,
            &manifest,
            None,
            &cache,
            options.offline,
            &cancellation,
        )?;
        if expected.to_toml() != lock.to_toml() {
            return Err(user_error(
                "manifest and lockfile differ while --locked was supplied",
                "run wukong lock without --locked to update wukong.lock",
            ));
        }
    }
    if matches!(options.output, OutputFormat::Json) {
        emit_json_progress("sync", "materialising-packages");
    }
    let progress = CliSyncProgress::new(options.output, options.no_progress);
    let summary = sync_direct_dependencies_with_progress_and_cancellation(
        project.path(),
        &manifest_path,
        &manifest,
        &lock,
        options.include_dev,
        &cache,
        options.offline,
        &cancellation,
        &progress,
    );
    progress.finish();
    let summary = summary?;
    if matches!(options.output, OutputFormat::Json) {
        emit_json_progress("sync", "state-written");
        emit_json_result(&render_sync_json(&summary, &godot_report));
    } else {
        println!(
            "sync: {} written, {} unchanged, {} removed",
            summary.written, summary.unchanged, summary.removed
        );
        print_godot_compatibility_report(&godot_report);
    }
    Ok(())
}

struct LockOptions {
    project: Option<PathBuf>,
    locked: bool,
    offline: bool,
    godot_version: Option<String>,
}
fn parse_lock_arguments(
    mut arguments: impl Iterator<Item = OsString>,
) -> Result<LockOptions, Box<Diagnostic>> {
    let mut options = LockOptions {
        project: None,
        locked: false,
        offline: false,
        godot_version: None,
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
        if argument == "--godot" {
            let version = required_add_value(&mut arguments, "--godot")?;
            if options.godot_version.replace(version).is_some() {
                return Err(user_error(
                    "--godot may be supplied only once",
                    "provide one complete Godot version",
                ));
            }
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
            "use --locked, --offline, --godot <x.y.z>, or --project <path>",
        ));
    }
    Ok(options)
}

#[allow(clippy::struct_excessive_bools)] // independent command flags map directly to CLI options
struct SyncOptions {
    project: Option<PathBuf>,
    include_dev: bool,
    locked: bool,
    offline: bool,
    godot_version: Option<String>,
    output: OutputFormat,
    no_progress: bool,
}

#[derive(Clone, Copy)]
enum OutputFormat {
    Human,
    Json,
}

enum SyncProgressOutput {
    Json,
    Terminal(ProgressBar),
    Silent,
}

struct CliSyncProgress {
    output: SyncProgressOutput,
}
impl CliSyncProgress {
    fn new(output: OutputFormat, no_progress: bool) -> Self {
        let output = match output {
            OutputFormat::Json => SyncProgressOutput::Json,
            OutputFormat::Human
                if !no_progress
                    && !progress_disabled_by_environment()
                    && std::io::stderr().is_terminal() =>
            {
                let bar = ProgressBar::new(0);
                let style = ProgressStyle::with_template(
                    "{spinner:.cyan} {wide_msg} [{bar:24.cyan/dim}] {pos}/{len}",
                )
                .unwrap_or_else(|_| ProgressStyle::default_spinner());
                bar.set_style(style);
                bar.enable_steady_tick(Duration::from_millis(80));
                SyncProgressOutput::Terminal(bar)
            }
            OutputFormat::Human => SyncProgressOutput::Silent,
        };
        Self { output }
    }

    fn finish(&self) {
        if let SyncProgressOutput::Terminal(bar) = &self.output {
            bar.finish_and_clear();
        }
    }
}
impl SyncProgressObserver for CliSyncProgress {
    fn report(&self, progress: &SyncProgress) {
        match &self.output {
            SyncProgressOutput::Json => emit_json_sync_package_progress(progress),
            SyncProgressOutput::Terminal(bar) => {
                bar.set_length(progress.total() as u64);
                bar.set_position(progress.completed() as u64);
                let action = match progress.stage() {
                    SyncProgressStage::ValidatingSource => "checking",
                    SyncProgressStage::PreparingPackage => "preparing",
                    SyncProgressStage::Prepared => "ready",
                };
                bar.set_message(format!("{action} {}", progress.package()));
            }
            SyncProgressOutput::Silent => {}
        }
    }
}

fn progress_disabled_by_environment() -> bool {
    env::var_os("WUKONG_NO_PROGRESS").is_some_and(|value| value != "0")
}

fn parse_sync_arguments(
    mut arguments: impl Iterator<Item = OsString>,
) -> Result<SyncOptions, Box<Diagnostic>> {
    let mut options = SyncOptions {
        project: None,
        include_dev: false,
        locked: false,
        offline: false,
        godot_version: None,
        output: OutputFormat::Human,
        no_progress: false,
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
        if argument == "--json" {
            if matches!(options.output, OutputFormat::Json) {
                return Err(user_error(
                    "--json may be supplied only once",
                    "run wukong sync --json",
                ));
            }
            options.output = OutputFormat::Json;
            continue;
        }
        if argument == "--no-progress" {
            if std::mem::replace(&mut options.no_progress, true) {
                return Err(user_error(
                    "--no-progress may be supplied only once",
                    "run wukong sync --no-progress",
                ));
            }
            continue;
        }
        if argument == "--godot" {
            let version = required_add_value(&mut arguments, "--godot")?;
            if options.godot_version.replace(version).is_some() {
                return Err(user_error(
                    "--godot may be supplied only once",
                    "provide one complete Godot version",
                ));
            }
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
            "use --dev, --locked, --frozen, --offline, --json, --no-progress, --godot <x.y.z>, or --project <path>",
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

fn run_package(mut arguments: impl Iterator<Item = OsString>) -> Result<(), Box<Diagnostic>> {
    let command = arguments.next().ok_or_else(|| {
        user_error(
            "package requires a subcommand",
            "run wukong package init [--path <directory>]",
        )
    })?;
    match command.to_str() {
        Some("init") => run_package_init(arguments),
        Some("validate") => run_package_validate(arguments),
        _ => Err(user_error(
            format!("unsupported package command {}", command.to_string_lossy()),
            "run wukong package <init|validate> [--path <directory>]",
        )),
    }
}

fn run_package_init(arguments: impl Iterator<Item = OsString>) -> Result<(), Box<Diagnostic>> {
    let options = parse_package_init_arguments(arguments)?;
    let current_directory = env::current_dir().map_err(|error| {
        boxed(
            Diagnostic::new(
                ErrorCode::InternalFailure,
                "could not determine current directory",
            )
            .with_cause(error)
            .with_recovery("run wukong from an accessible package directory"),
        )
    })?;
    let package_root = options.path.as_deref().unwrap_or(&current_directory);
    let initialized = PackageMetadata::initialize(package_root, &options.metadata_options())?;
    println!("created {}", initialized.path().display());
    Ok(())
}

#[derive(Default)]
struct PackageInitOptions {
    path: Option<PathBuf>,
    name: Option<String>,
    version: Option<String>,
    godot: Option<String>,
    root: Option<String>,
    target: Option<String>,
}

impl PackageInitOptions {
    fn metadata_options(&self) -> PackageMetadataInitializationOptions {
        let mut options = PackageMetadataInitializationOptions::default();
        if let Some(name) = &self.name {
            options = options.with_name(name.clone());
        }
        if let Some(version) = &self.version {
            options = options.with_version(version.clone());
        }
        if let Some(godot) = &self.godot {
            options = options.with_godot(godot.clone());
        }
        if let Some(root) = &self.root {
            options = options.with_root(root.clone());
        }
        if let Some(target) = &self.target {
            options = options.with_target(target.clone());
        }
        options
    }
}

fn parse_package_init_arguments(
    mut arguments: impl Iterator<Item = OsString>,
) -> Result<PackageInitOptions, Box<Diagnostic>> {
    let mut options = PackageInitOptions::default();
    while let Some(argument) = arguments.next() {
        if argument == "--path" {
            let path = arguments.next().ok_or_else(|| {
                user_error(
                    "--path requires a package directory",
                    "provide one existing package directory",
                )
            })?;
            if options.path.replace(PathBuf::from(path)).is_some() {
                return Err(user_error(
                    "--path may be supplied only once",
                    "provide one package directory",
                ));
            }
            continue;
        }
        let Some(field) = package_init_field(&argument) else {
            return Err(user_error(
                format!(
                    "unsupported package init argument {}",
                    argument.to_string_lossy()
                ),
                "use --path, --name, --version, --godot, --root, or --target",
            ));
        };
        let value = arguments.next().ok_or_else(|| {
            user_error(
                format!("{field} requires a value"),
                format!("provide a value for {field}"),
            )
        })?;
        let value = value.to_str().ok_or_else(|| {
            user_error(
                format!("{field} must be valid UTF-8"),
                format!("provide a UTF-8 value for {field}"),
            )
        })?;
        let slot = match field {
            "--name" => &mut options.name,
            "--version" => &mut options.version,
            "--godot" => &mut options.godot,
            "--root" => &mut options.root,
            "--target" => &mut options.target,
            _ => unreachable!("package_init_field returns supported options"),
        };
        if slot.replace(value.to_owned()).is_some() {
            return Err(user_error(
                format!("{field} may be supplied only once"),
                format!("provide one value for {field}"),
            ));
        }
    }
    Ok(options)
}

fn package_init_field(argument: &OsString) -> Option<&'static str> {
    match argument.to_str() {
        Some("--name") => Some("--name"),
        Some("--version") => Some("--version"),
        Some("--godot") => Some("--godot"),
        Some("--root") => Some("--root"),
        Some("--target") => Some("--target"),
        _ => None,
    }
}

fn run_package_validate(arguments: impl Iterator<Item = OsString>) -> Result<(), Box<Diagnostic>> {
    let options = parse_package_validate_arguments(arguments)?;
    let current_directory = env::current_dir().map_err(|error| {
        boxed(
            Diagnostic::new(
                ErrorCode::InternalFailure,
                "could not determine current directory",
            )
            .with_cause(error)
            .with_recovery("run wukong from an accessible package directory"),
        )
    })?;
    let package_root = options.path.as_deref().unwrap_or(&current_directory);
    let metadata = PackageMetadata::load_required(package_root)?;
    let path = package_root.join(wukong_core::package_metadata::PACKAGE_METADATA_FILE_NAME);
    if options.json {
        emit_json_result(
            &json!({
                "path": path.display().to_string(),
                "name": metadata.name().as_str(),
                "version": metadata.version().to_string(),
                "godot": metadata.godot().as_semver().to_string(),
            })
            .to_string(),
        );
    } else {
        println!("validated {}", path.display());
    }
    Ok(())
}

#[derive(Default)]
struct PackageValidateOptions {
    path: Option<PathBuf>,
    json: bool,
}

fn parse_package_validate_arguments(
    mut arguments: impl Iterator<Item = OsString>,
) -> Result<PackageValidateOptions, Box<Diagnostic>> {
    let mut options = PackageValidateOptions::default();
    while let Some(argument) = arguments.next() {
        if argument == "--path" {
            let path = arguments.next().ok_or_else(|| {
                user_error(
                    "--path requires a package directory",
                    "provide one existing package directory",
                )
            })?;
            if options.path.replace(PathBuf::from(path)).is_some() {
                return Err(user_error(
                    "--path may be supplied only once",
                    "provide one package directory",
                ));
            }
            continue;
        }
        if argument == "--json" {
            if options.json {
                return Err(user_error(
                    "--json may be supplied only once",
                    "run wukong package validate --json",
                ));
            }
            options.json = true;
            continue;
        }
        return Err(user_error(
            format!(
                "unsupported package validate argument {}",
                argument.to_string_lossy()
            ),
            "use --path <directory> or --json",
        ));
    }
    Ok(options)
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
    JSON_MODE.with(|mode| {
        if mode.get() {
            eprintln!("{}", render_json(diagnostic));
        } else {
            eprintln!("{}", render_human(diagnostic, false));
        }
    });
    ProcessExit::from_diagnostic(diagnostic)
}

fn print_usage() {
    println!(
        "usage: wukong [--version] <init|package <init|validate>|add|remove|update|outdated|audit|godot path|validate|lock|install|sync|status|source <add|list|remove|validate>|tree|why|cache> [options]; cache <dir|status|clean|verify>"
    );
}

fn boxed(diagnostic: Diagnostic) -> Box<Diagnostic> {
    Box::new(diagnostic)
}

fn cli_cancellation() -> Result<CancellationToken, Box<Diagnostic>> {
    if let Some(cancellation) = CLI_CANCELLATION.get() {
        return Ok(cancellation.clone());
    }
    let cancellation = CancellationToken::new();
    let handler_cancellation = cancellation.clone();
    ctrlc::set_handler(move || handler_cancellation.cancel()).map_err(|error| {
        boxed(
            Diagnostic::new(
                ErrorCode::InternalFailure,
                "could not install the cancellation handler",
            )
            .with_cause(error)
            .with_recovery("retry in a terminal that permits Ctrl-C handling"),
        )
    })?;
    if CLI_CANCELLATION.set(cancellation.clone()).is_ok() {
        return Ok(cancellation);
    }
    CLI_CANCELLATION.get().cloned().ok_or_else(|| {
        boxed(
            Diagnostic::new(
                ErrorCode::InternalFailure,
                "cancellation handler initialization did not retain a token",
            )
            .with_recovery("retry the command"),
        )
    })
}

#[cfg(test)]
mod tests {
    use super::{
        AddOptions, parse_add_arguments, parse_godot_path_arguments, parse_outdated_arguments,
        parse_sync_arguments, parse_update_arguments, parse_validate_arguments,
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

    #[test]
    fn sync_parser_accepts_json_and_an_explicit_godot_version() {
        let options = parse_sync_arguments(
            ["--json", "--godot", "4.4.1"]
                .into_iter()
                .map(OsString::from),
        )
        .expect("sync specification should parse");

        assert!(matches!(options.output, super::OutputFormat::Json));
        assert_eq!(options.godot_version.as_deref(), Some("4.4.1"));
    }

    #[test]
    fn sync_parser_accepts_no_progress_once() {
        let options = parse_sync_arguments(["--no-progress"].into_iter().map(OsString::from))
            .expect("sync progress option should parse");

        assert!(options.no_progress);
        assert!(
            parse_sync_arguments(
                ["--no-progress", "--no-progress"]
                    .into_iter()
                    .map(OsString::from),
            )
            .is_err()
        );
    }

    #[test]
    fn godot_path_parser_accepts_explicit_executable_and_verbose_output() {
        let options = parse_godot_path_arguments(
            ["--godot-executable", "godot", "--verbose"]
                .into_iter()
                .map(OsString::from),
        )
        .expect("Godot path specification should parse");

        assert_eq!(options.executable, Some(PathBuf::from("godot")));
        assert!(options.verbose);
    }

    #[test]
    fn validation_parser_accepts_bounded_execution_options() {
        let options = parse_validate_arguments(
            [
                "--project",
                "game",
                "--godot-executable",
                "godot4",
                "--timeout-seconds",
                "120",
                "--verbose",
            ]
            .into_iter()
            .map(OsString::from),
        )
        .expect("validation options should parse");

        assert_eq!(options.project, Some(PathBuf::from("game")));
        assert_eq!(options.executable, Some(PathBuf::from("godot4")));
        assert_eq!(options.timeout, std::time::Duration::from_secs(120));
        assert!(options.verbose);
    }

    #[test]
    fn validation_parser_rejects_an_unbounded_timeout() {
        let error =
            parse_validate_arguments(["--timeout-seconds", "601"].into_iter().map(OsString::from))
                .expect_err("unbounded timeout should fail");

        assert!(error.message().contains("1 to 600"));
    }
}
