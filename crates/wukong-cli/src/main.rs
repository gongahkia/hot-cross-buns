/// CLI-owned diagnostic rendering and exit-code mapping.
pub mod diagnostics;

use std::{env, ffi::OsString, fs, path::PathBuf, process};
use wukong_core::{
    cache::{CacheLayout, verify_cached_packages},
    diagnostic::{Diagnostic, ErrorCode},
    direct_lock::lock_direct_local_dependencies,
    direct_sync::sync_direct_local_dependencies,
    init::initialize_manifest,
    lockfile::{LOCKFILE_FILE_NAME, Lockfile},
    manifest::{MANIFEST_FILE_NAME, Manifest},
    project::ProjectRoot,
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
        Some(command) => render_error(&user_error(
            format!("unsupported command {}", command.to_string_lossy()),
            "run wukong --help for supported commands",
        )),
        None => ProcessExit::Success,
    }
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
    let locked = lock_direct_local_dependencies(&manifest_path, &manifest, existing.as_ref())?;
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
    if options.locked {
        let expected = lock_direct_local_dependencies(&manifest_path, &manifest, None)?;
        if expected.to_toml() != lock.to_toml() {
            return Err(user_error(
                "manifest and lockfile differ while --locked was supplied",
                "run wukong lock without --locked to update wukong.lock",
            ));
        }
    }
    let summary = sync_direct_local_dependencies(
        project.path(),
        &manifest_path,
        &manifest,
        &lock,
        options.include_dev,
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
}
fn parse_lock_arguments(
    mut arguments: impl Iterator<Item = OsString>,
) -> Result<LockOptions, Box<Diagnostic>> {
    let mut options = LockOptions {
        project: None,
        locked: false,
    };
    while let Some(argument) = arguments.next() {
        if argument == "--locked" {
            options.locked = true;
            continue;
        }
        if argument == "--offline" {
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
}
fn parse_sync_arguments(
    mut arguments: impl Iterator<Item = OsString>,
) -> Result<SyncOptions, Box<Diagnostic>> {
    let mut options = SyncOptions {
        project: None,
        include_dev: false,
        locked: false,
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
            continue;
        }
        if argument == "--offline" {
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
    println!("usage: wukong <init|lock|install|sync|cache verify> [options]");
}

fn boxed(diagnostic: Diagnostic) -> Box<Diagnostic> {
    Box::new(diagnostic)
}
