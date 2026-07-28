#![no_main]

use libfuzzer_sys::fuzz_target;
use std::path::Path;
use wukong_core::manifest::Manifest;

fuzz_target!(|input: &[u8]| {
    if let Ok(input) = std::str::from_utf8(input) {
        let _ = Manifest::parse(Path::new("wukong.toml"), input);
    }
});
