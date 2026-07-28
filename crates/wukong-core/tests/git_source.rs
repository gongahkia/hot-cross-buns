use wukong_core::{
    git_source::{GitSourceRequest, canonicalize_git_source, canonicalize_git_url},
    manifest::GitReference,
};

#[test]
fn invariant_equivalent_https_git_urls_have_one_canonical_identity() {
    let first = canonicalize_git_url("HTTPS://EXAMPLE.test:443/Org/addon.git")
        .expect("HTTPS URL should canonicalize");
    let second = canonicalize_git_url("https://example.test/Org/addon.git")
        .expect("HTTPS URL should canonicalize");

    assert_eq!(first, second);
    assert_eq!(first.as_str(), "https://example.test/Org/addon.git");
}

#[test]
fn invariant_ssh_sources_preserve_user_git_configuration_meaning() {
    let ssh = canonicalize_git_url("SSH://git@Work-Alias:2222/team/addon.git")
        .expect("SSH URL should canonicalize");
    let scp = canonicalize_git_url("git@Work-Alias:team/addon.git")
        .expect("SCP-style SSH URL should canonicalize");

    assert_eq!(ssh.as_str(), "ssh://git@Work-Alias:2222/team/addon.git");
    assert_eq!(scp.as_str(), "git@Work-Alias:team/addon.git");
}

#[test]
fn invariant_git_selectors_support_tags_branches_and_complete_revisions() {
    for reference in [
        GitReference::Tag("v1.2.3".to_owned()),
        GitReference::Branch("release/1.2".to_owned()),
        GitReference::Rev("0123456789abcdef0123456789abcdef01234567".to_owned()),
    ] {
        let request = GitSourceRequest::new(
            "https://example.test/Org/addon.git".to_owned(),
            Some(reference),
        );

        assert!(canonicalize_git_source(&request).is_ok());
    }
}

#[test]
fn invariant_git_sources_reject_credentials_and_invalid_revisions_without_leaking_secrets() {
    let credential_error = canonicalize_git_url("https://token:secret@example.test/addon.git")
        .expect_err("credentialed HTTPS URL should fail");
    let revision_request = GitSourceRequest::new(
        "https://example.test/Org/addon.git".to_owned(),
        Some(GitReference::Rev("01234567".to_owned())),
    );
    let invalid_branch_request = GitSourceRequest::new(
        "https://example.test/Org/addon.git".to_owned(),
        Some(GitReference::Branch("release.LOCK".to_owned())),
    );

    assert!(canonicalize_git_source(&revision_request).is_err());
    assert!(canonicalize_git_source(&invalid_branch_request).is_err());
    assert!(!credential_error.message().contains("secret"));
    assert!(
        !credential_error
            .source_description()
            .expect("source should be attached")
            .as_str()
            .contains("secret")
    );
}
