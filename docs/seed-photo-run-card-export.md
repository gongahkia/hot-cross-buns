# Seed, photo, and run-card export

Resolved runs automatically export a portable seed manifest and run-card data manifest to `user://exports`; the Run records screen can export any archived card again. Every capture copies its PNG and metadata sidecar to `user://exports/photos` and writes a companion photo manifest. Names never overwrite an existing export.

All manifests use `a-slow-walk.export.v1` and carry the documented world-identity tuple: decimal seed, generator schema version, and generation options. Export happens only at capture/resolution/button activation. Run-card JSON is accompanied by a local SVG render; exports do not import, sync, or disclose their filesystem locations externally.
