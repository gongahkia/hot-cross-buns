use wukong_core::{
    diagnostic::ErrorCode,
    identity::SourceIdentity,
    source::{
        CancellationToken, OfflineAvailability, ResolvedSource, SourceAdapter, VersionAvailability,
    },
};

pub trait SourceAdapterFixture {
    type Adapter: SourceAdapter;

    fn adapter(&self) -> &Self::Adapter;
    fn request(&self) -> &<Self::Adapter as SourceAdapter>::Request;
    fn assert_identity(&self, identity: &SourceIdentity);
    fn assert_versions(&self, versions: &VersionAvailability);
    fn assert_integrity(&self, integrity: &<Self::Adapter as SourceAdapter>::IntegrityMetadata);
    fn assert_layout(&self, layout: &<Self::Adapter as SourceAdapter>::LayoutMetadata);
    fn assert_offline_availability(&self, availability: OfflineAvailability);
    fn assert_cancelled_cleanup(&self);
}

pub fn assert_source_adapter_contract<F: SourceAdapterFixture>(fixture: &F) {
    let adapter = fixture.adapter();
    let request = fixture.request();
    let first_identity = adapter
        .canonical_identity(request)
        .expect("source identity should resolve");
    let second_identity = adapter
        .canonical_identity(request)
        .expect("source identity should resolve deterministically");
    assert_eq!(first_identity, second_identity);
    fixture.assert_identity(&first_identity);

    let versions = adapter
        .available_versions(request)
        .expect("version availability should resolve");
    let repeated_versions = adapter
        .available_versions(request)
        .expect("version availability should resolve deterministically");
    assert_eq!(versions, repeated_versions);
    fixture.assert_versions(&versions);

    let cancellation = CancellationToken::new();
    let first_resolution = adapter
        .resolve(request, &cancellation)
        .expect("source should resolve immutably");
    let second_resolution = adapter
        .resolve(request, &cancellation)
        .expect("source should resolve deterministically");
    assert_eq!(
        first_resolution.immutable_id(),
        second_resolution.immutable_id()
    );

    let fetched = adapter
        .fetch(&first_resolution, &cancellation)
        .expect("resolved source should fetch");
    let integrity = adapter
        .integrity_metadata(&fetched)
        .expect("fetched source should expose integrity metadata");
    let layout = adapter
        .layout_metadata(&fetched)
        .expect("fetched source should expose layout metadata");
    fixture.assert_integrity(&integrity);
    fixture.assert_layout(&layout);
    let offline = adapter
        .offline_availability(&first_resolution)
        .expect("offline availability should resolve");
    let repeated_offline = adapter
        .offline_availability(&first_resolution)
        .expect("offline availability should resolve deterministically");
    assert_eq!(offline, repeated_offline);
    fixture.assert_offline_availability(offline);

    let cancelled = CancellationToken::new();
    cancelled.cancel();
    let error = match adapter.resolve(request, &cancelled) {
        Ok(_) => panic!("cancelled resolution should fail"),
        Err(error) => error,
    };
    assert_eq!(error.code(), ErrorCode::SourceAccess);
    fixture.assert_cancelled_cleanup();

    let cancelled = CancellationToken::new();
    cancelled.cancel();
    let error = match adapter.fetch(&first_resolution, &cancelled) {
        Ok(_) => panic!("cancelled fetch should fail"),
        Err(error) => error,
    };
    assert_eq!(error.code(), ErrorCode::SourceAccess);
    fixture.assert_cancelled_cleanup();
}
