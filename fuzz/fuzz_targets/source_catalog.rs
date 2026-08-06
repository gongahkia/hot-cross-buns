#![no_main]

use libfuzzer_sys::fuzz_target;
use std::path::Path;
use wukong_core::source_catalog::SourceCatalog;

fuzz_target!(|input: &[u8]| {
    if let Ok(input) = std::str::from_utf8(input) {
        if let Ok(catalog) = SourceCatalog::parse(Path::new("wukong.sources.toml"), input) {
            let _ = catalog.validate(Path::new("wukong.sources.toml"));
        }
    }
});
