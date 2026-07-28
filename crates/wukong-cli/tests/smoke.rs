use std::process::Command;

#[test]
fn invariant_workspace_binary_starts_successfully() {
    let status = Command::new(env!("CARGO_BIN_EXE_wukong"))
        .arg("--help")
        .status()
        .expect("wukong binary should start");

    assert!(status.success());
}
