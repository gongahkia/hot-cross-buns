mod support;

use std::{collections::BTreeSet, fs, path::PathBuf};
use support::source_adapter_contract::{SourceAdapterFixture, assert_source_adapter_contract};
use tempfile::TempDir;
use wukong_core::{
    identity::{LocalSourceIdentity, SourceIdentity},
    semantic_version::SemanticVersion,
    source::{
        CancellationToken, ImmutableSourceId, OfflineAvailability, ResolvedSource, SourceAdapter,
        SourceResult, VersionAvailability,
    },
};

#[test]
fn invariant_reusable_source_adapter_contract_keeps_source_details_outside_resolution() {
    assert_source_adapter_contract(&Fixture::new());
}

struct Fixture {
    _directory: TempDir,
    adapter: TestAdapter,
    request: TestRequest,
}
impl Fixture {
    fn new() -> Self {
        let directory = TempDir::new().expect("temporary directory should be created");
        let path = directory.path().join("package");
        fs::create_dir(&path).expect("package directory should be created");
        Self {
            _directory: directory,
            adapter: TestAdapter,
            request: TestRequest { path },
        }
    }
}
impl SourceAdapterFixture for Fixture {
    type Adapter = TestAdapter;

    fn adapter(&self) -> &Self::Adapter {
        &self.adapter
    }
    fn request(&self) -> &TestRequest {
        &self.request
    }
    fn assert_identity(&self, identity: &SourceIdentity) {
        assert!(matches!(identity, SourceIdentity::Local(_)));
    }
    fn assert_versions(&self, versions: &VersionAvailability) {
        assert_eq!(
            versions,
            &VersionAvailability::Available(BTreeSet::from([
                SemanticVersion::parse("1.0.0").expect("version should parse")
            ]))
        );
    }
    fn assert_integrity(&self, integrity: &&'static str) {
        assert_eq!(*integrity, "test-integrity");
    }
    fn assert_layout(&self, layout: &&'static str) {
        assert_eq!(*layout, "test-layout");
    }
    fn assert_offline_availability(&self, availability: OfflineAvailability) {
        assert_eq!(availability, OfflineAvailability::Available);
    }
    fn assert_cancelled_cleanup(&self) {
        assert!(!self.request.path.join(".wukong-source-staging").exists());
    }
}

struct TestRequest {
    path: PathBuf,
}
struct TestResolution {
    immutable_id: ImmutableSourceId,
}
impl ResolvedSource for TestResolution {
    fn immutable_id(&self) -> &ImmutableSourceId {
        &self.immutable_id
    }
}
struct TestFetched;
struct TestAdapter;
impl SourceAdapter for TestAdapter {
    type Request = TestRequest;
    type Resolution = TestResolution;
    type Fetched = TestFetched;
    type IntegrityMetadata = &'static str;
    type LayoutMetadata = &'static str;

    fn canonical_identity(&self, request: &Self::Request) -> SourceResult<SourceIdentity> {
        Ok(SourceIdentity::Local(
            LocalSourceIdentity::from_existing_path(&request.path)
                .expect("fixture path should canonicalize"),
        ))
    }
    fn available_versions(&self, _request: &Self::Request) -> SourceResult<VersionAvailability> {
        Ok(VersionAvailability::Available(BTreeSet::from([
            SemanticVersion::parse("1.0.0").expect("version should parse"),
        ])))
    }
    fn resolve(
        &self,
        _request: &Self::Request,
        cancellation: &CancellationToken,
    ) -> SourceResult<Self::Resolution> {
        cancellation.check()?;
        Ok(TestResolution {
            immutable_id: ImmutableSourceId::new("test-revision-1")
                .expect("identifier should be valid"),
        })
    }
    fn fetch(
        &self,
        _resolved: &Self::Resolution,
        cancellation: &CancellationToken,
    ) -> SourceResult<Self::Fetched> {
        cancellation.check()?;
        Ok(TestFetched)
    }
    fn integrity_metadata(
        &self,
        _fetched: &Self::Fetched,
    ) -> SourceResult<Self::IntegrityMetadata> {
        Ok("test-integrity")
    }
    fn layout_metadata(&self, _fetched: &Self::Fetched) -> SourceResult<Self::LayoutMetadata> {
        Ok("test-layout")
    }
    fn offline_availability(
        &self,
        _resolved: &Self::Resolution,
    ) -> SourceResult<OfflineAvailability> {
        Ok(OfflineAvailability::Available)
    }
}
