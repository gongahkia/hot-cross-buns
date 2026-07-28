use std::{fs, path::PathBuf};

#[test]
fn invariant_bug_report_requires_reproducibility_context_and_redaction() {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..");
    let form = fs::read_to_string(root.join(".github/ISSUE_TEMPLATE/bug-report.yml"))
        .expect("reproducibility issue form should exist");
    for field in [
        "id: operating-system",
        "id: wukong-version",
        "id: godot-version",
        "id: manifest",
        "id: lockfile",
        "id: diagnostic-output",
        "id: expected-behaviour",
        "id: actual-behaviour",
        "id: redaction",
        "UNSAFE TO SHARE",
        "required: true",
    ] {
        assert!(
            form.contains(field),
            "reproducibility issue form should contain {field:?}"
        );
    }
}

#[test]
fn invariant_issue_configuration_routes_security_reports_away_from_public_issues() {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..");
    let config = fs::read_to_string(root.join(".github/ISSUE_TEMPLATE/config.yml"))
        .expect("issue configuration should exist");
    assert!(config.contains("blank_issues_enabled: false"));
    assert!(config.contains("security/advisories/new"));
}
