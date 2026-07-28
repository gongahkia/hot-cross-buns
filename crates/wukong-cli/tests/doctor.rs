use std::{fs, path::Path, process::Command};
use tempfile::TempDir;
use wukong_core::operation_lock::AdvisoryLock;

#[test]
fn invariant_doctor_checks_a_healthy_project_without_network_access() {
    let fixture = Fixture::new();
    fixture.lock();
    let executable = fixture.executable("godot");

    let output = command(&fixture, &executable)
        .output()
        .expect("doctor should run");

    assert!(output.status.success());
    let stdout = String::from_utf8(output.stdout).expect("doctor output should be UTF-8");
    for check in [
        "project discovery",
        "manifest validity",
        "lockfile validity",
        "state-file consistency",
        "cache permissions",
        "cache corruption",
        "filesystem capability",
        "Godot executable availability",
        "network configuration",
        "concurrent operation locks",
    ] {
        assert!(stdout.contains(&format!("ok {check}:")), "missing {check}");
    }
    assert!(stdout.contains("network configuration: skipped (--offline)"));
    assert!(fixture.root().join(".wukong/mutation.lock").is_file());
}

#[test]
fn invariant_doctor_reports_an_active_project_mutation_lock() {
    let fixture = Fixture::new();
    fixture.lock();
    let executable = fixture.executable("godot");
    let lock_path = fixture.root().join(".wukong/mutation.lock");
    let lock = AdvisoryLock::try_acquire(&lock_path, "fixture project")
        .expect("fixture lock should acquire");

    let output = command(&fixture, &executable)
        .output()
        .expect("doctor should run");

    assert_eq!(output.status.code(), Some(3));
    assert!(
        String::from_utf8(output.stdout)
            .expect("doctor output should be UTF-8")
            .contains("fail concurrent operation locks: another wukong operation is active")
    );
    drop(lock);
}

#[test]
fn invariant_doctor_validates_proxy_configuration_without_opening_a_network_connection() {
    let fixture = Fixture::new();
    fixture.lock();
    let executable = fixture.executable("godot");
    let mut command = Command::new(env!("CARGO_BIN_EXE_wukong"));
    command
        .args(["doctor", "--godot-executable"])
        .arg(&executable)
        .current_dir(fixture.root())
        .env("WUKONG_CACHE_DIR", fixture.cache_root())
        .env("HTTPS_PROXY", "http://proxy.fixture.test:8080")
        .env_remove("HTTP_PROXY")
        .env_remove("https_proxy")
        .env_remove("http_proxy");

    let output = command.output().expect("doctor should run");

    assert!(output.status.success());
    assert!(
        String::from_utf8(output.stdout)
            .expect("doctor output should be UTF-8")
            .contains("ok network configuration: proxy configuration is URL-like")
    );
}

fn command(fixture: &Fixture, executable: &Path) -> Command {
    let mut command = Command::new(env!("CARGO_BIN_EXE_wukong"));
    command
        .args(["doctor", "--offline", "--godot-executable"])
        .arg(executable)
        .current_dir(fixture.root())
        .env("WUKONG_CACHE_DIR", fixture.cache_root());
    command
}

struct Fixture {
    directory: TempDir,
    root: std::path::PathBuf,
}
impl Fixture {
    fn new() -> Self {
        let directory = TempDir::new().expect("fixture should exist");
        let root = directory.path().join("project");
        fs::create_dir(&root).expect("project should create");
        fs::write(
            root.join("project.godot"),
            "[application]\nconfig/name=\"fixture\"\n",
        )
        .expect("project marker should write");
        fs::write(
            root.join("wukong.toml"),
            "[project]\nname=\"fixture\"\ngodot=\"4\"\n",
        )
        .expect("manifest should write");
        Self { directory, root }
    }
    fn root(&self) -> &Path {
        &self.root
    }
    fn cache_root(&self) -> std::path::PathBuf {
        self.directory.path().join("cache")
    }
    fn lock(&self) {
        let output = Command::new(env!("CARGO_BIN_EXE_wukong"))
            .arg("lock")
            .current_dir(self.root())
            .env("WUKONG_CACHE_DIR", self.cache_root())
            .output()
            .expect("lock should run");
        assert!(output.status.success());
    }
    fn executable(&self, name: &str) -> std::path::PathBuf {
        #[cfg(windows)]
        let executable = self.directory.path().join(format!("{name}.exe"));
        #[cfg(not(windows))]
        let executable = self.directory.path().join(name);
        fs::write(&executable, "fixture executable").expect("executable should write");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mut permissions = fs::metadata(&executable)
                .expect("executable should stat")
                .permissions();
            permissions.set_mode(0o755);
            fs::set_permissions(&executable, permissions).expect("executable should chmod");
        }
        executable
    }
}
