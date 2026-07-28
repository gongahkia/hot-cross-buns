use wukong_core::lockfile::LockedHttpSource;

pub fn assert_checksum_locked_http_contract(source: &LockedHttpSource) {
    assert!(source.url().starts_with("https://"));
    assert_eq!(source.sha256().len(), 64);
}
