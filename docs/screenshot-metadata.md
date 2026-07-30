# Screenshot metadata

Each PNG capture stores the complete capture JSON in an uncompressed UTF-8 PNG `iTXt` chunk with the `a-slow-walk` keyword, as well as the existing readable `.json` sidecar. The embedded object carries the `a-slow-walk.photo.v1` schema marker, capture dimensions, timestamp, camera state, run data, and world sample.

Embedding rewrites the just-created PNG once, proportional to PNG byte size; it does not hold capture history in memory. It follows the PNG `iTXt` layout for UTF-8 textual data and intentionally does not add EXIF/XMP, modify existing external PNGs, or encrypt/share metadata.
