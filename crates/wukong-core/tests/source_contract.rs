use semver::Version;
use std::{collections::BTreeSet, fs, path::PathBuf};
use tempfile::TempDir;
use wukong_core::{
    identity::{LocalSourceIdentity, SourceIdentity},
    source::{
        ImmutableSourceId, OfflineAvailability, ResolvedSource, SourceAdapter, SourceResult,
        VersionAvailability,
    },
};

#[test]
fn invariant_source_adapter_contract_keeps_source_details_outside_shared_resolution() {
    let fixture = TempDir::new().expect("temporary directory should be created");
    let package = fixture.path().join("package");
    fs::create_dir(&package).expect("package directory should be created");
    let adapter = TestAdapter;
    let request = TestRequest { path: package };

    let identity = adapter
        .canonical_identity(&request)
        .expect("identity should canonicalize");
    let versions = adapter
        .available_versions(&request)
        .expect("version availability should resolve");
    let resolved = adapter.resolve(&request).expect("request should resolve");
    let fetched = adapter.fetch(&resolved).expect("source should fetch");
    let integrity = adapter
        .integrity_metadata(&fetched)
        .expect("integrity metadata should resolve");
    let layout = adapter
        .layout_metadata(&fetched)
        .expect("layout metadata should resolve");
    let offline = adapter
        .offline_availability(&resolved)
        .expect("offline availability should resolve");

    assert!(matches!(identity, SourceIdentity::Local(_)));
    assert_eq!(
        versions,
        VersionAvailability::Available(BTreeSet::from([Version::new(1, 0, 0)]))
    );
    assert_eq!(resolved.immutable_id().as_str(), "test-revision-1");
    assert_eq!(integrity, "test-integrity");
    assert_eq!(layout, "test-layout");
    assert_eq!(offline, OfflineAvailability::Available);
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
            Version::new(1, 0, 0),
        ])))
    }

    fn resolve(&self, _request: &Self::Request) -> SourceResult<Self::Resolution> {
        Ok(TestResolution {
            immutable_id: ImmutableSourceId::new("test-revision-1")
                .expect("identifier should be valid"),
        })
    }

    fn fetch(&self, _resolved: &Self::Resolution) -> SourceResult<Self::Fetched> {
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
