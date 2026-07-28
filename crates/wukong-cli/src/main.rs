/// CLI-owned diagnostic rendering and exit-code mapping.
pub mod diagnostics;

use std::{env, ffi::OsString, path::PathBuf, process};
use wukong_core::{
    diagnostic::{Diagnostic, ErrorCode},
    init::initialize_manifest,
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
        Some(command) => render_error(&user_error(
            format!("unsupported command {}", command.to_string_lossy()),
            "run wukong --help for supported commands",
        )),
        None => ProcessExit::Success,
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
    println!("usage: wukong init [--project <path>] [--non-interactive]");
}

fn boxed(diagnostic: Diagnostic) -> Box<Diagnostic> {
    Box::new(diagnostic)
}
