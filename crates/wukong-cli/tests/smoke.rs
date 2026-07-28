use std::process::Command;

#[test]
fn invariant_workspace_binary_starts_successfully() {
    let status = Command::new(env!("CARGO_BIN_EXE_wukong"))
        .arg("--help")
        .status()
        .expect("wukong binary should start");

    assert!(status.success());
}

#[test]
fn invariant_version_output_matches_the_packaged_crate_version() {
    let output = Command::new(env!("CARGO_BIN_EXE_wukong"))
        .arg("--version")
        .output()
        .expect("wukong binary should start");

    assert!(output.status.success());
    assert_eq!(
        String::from_utf8(output.stdout).expect("version output should be UTF-8"),
        format!("wukong {}\n", env!("CARGO_PKG_VERSION"))
    );
}
