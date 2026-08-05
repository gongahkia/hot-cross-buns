class_name PhotoHighResolution
extends RefCounted

const SCALE := 2.0
const MAX_PIXELS := 16_777_216
const BYTES_PER_PIXEL := 4

static func target_size(source: Vector2i) -> Vector2i:
	var width := maxi(2, roundi(float(source.x) * SCALE))
	var height := maxi(2, roundi(float(source.y) * SCALE))
	var pixels := width * height
	if pixels <= MAX_PIXELS: return Vector2i(width, height)
	var reduction := sqrt(float(MAX_PIXELS) / float(pixels))
	return Vector2i(maxi(2, floori(float(width) * reduction)), maxi(2, floori(float(height) * reduction)))

static func readback_bytes(size: Vector2i) -> int:
	return size.x * size.y * BYTES_PER_PIXEL
