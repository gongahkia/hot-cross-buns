/// CLI-owned diagnostic rendering and exit-code mapping.
pub mod diagnostics;

use std::{collections::BTreeSet, env, ffi::OsString, fs, path::PathBuf, process};
use wukong_core::{
    cache::{CacheLayout, verify_cached_packages},
    dependency_graph::{DependencyGroup, LockedDependencyGraph},
    diagnostic::{Diagnostic, ErrorCode},
    direct_lock::{lock_direct_dependencies, lock_direct_local_dependencies},
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
    println!("usage: wukong <init|lock|install|sync|tree|why|cache verify> [options]");
}

fn boxed(diagnostic: Diagnostic) -> Box<Diagnostic> {
    Box::new(diagnostic)
}
