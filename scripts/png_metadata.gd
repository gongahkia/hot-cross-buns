class_name PngMetadata
extends RefCounted

static func embed(source: PackedByteArray, keyword: String, text: String) -> PackedByteArray:
	var keyword_bytes := keyword.to_ascii_buffer()
	if not _has_signature(source) or keyword_bytes.is_empty() or keyword_bytes.size() > 79 or _contains_zero(keyword_bytes) or _contains_zero(text.to_utf8_buffer()): return PackedByteArray()
	var output := signature()
	var offset := signature().size()
	var first_chunk := true
	while offset < source.size():
		if offset + 12 > source.size(): return PackedByteArray()
		var length := _read_u32(source, offset)
		var end := offset + 12 + length
		if length < 0 or end > source.size(): return PackedByteArray()
		if first_chunk and not _has_type(source, offset + 4, ihdr()): return PackedByteArray()
		_append_range(output, source, offset, end)
		if first_chunk: output.append_array(_itxt_chunk(keyword_bytes, text.to_utf8_buffer()))
		first_chunk = false
		offset = end
	return output if not first_chunk else PackedByteArray()

static func extract(source: PackedByteArray, keyword: String) -> String:
	if not _has_signature(source): return ""
	var offset := signature().size()
	while offset + 12 <= source.size():
		var length := _read_u32(source, offset)
		var data_start := offset + 8
		var end := offset + 12 + length
		if length < 0 or end > source.size(): return ""
		if _has_type(source, offset + 4, itxt()):
			var value := _itxt_value(source, data_start, data_start + length, keyword)
			if not value.is_empty(): return value
		offset = end
	return ""

static func _itxt_chunk(keyword: PackedByteArray, text: PackedByteArray) -> PackedByteArray:
	var data := keyword.duplicate()
	data.append_array(PackedByteArray([0,0,0,0,0]))
	data.append_array(text)
	return _chunk(itxt(), data)

static func _itxt_value(source: PackedByteArray, start: int, end: int, keyword: String) -> String:
	var cursor := start
	var key := PackedByteArray()
	while cursor < end and source[cursor] != 0:
		key.append(source[cursor])
		cursor += 1
	if cursor >= end or key.get_string_from_ascii() != keyword: return ""
	cursor += 1
	if cursor + 2 > end or source[cursor] != 0: return ""
	cursor += 2
	for _separator in 2:
		while cursor < end and source[cursor] != 0: cursor += 1
		if cursor >= end: return ""
		cursor += 1
	var text := PackedByteArray()
	while cursor < end:
		text.append(source[cursor])
		cursor += 1
	return text.get_string_from_utf8()

static func _chunk(type: PackedByteArray, data: PackedByteArray) -> PackedByteArray:
	var output := PackedByteArray()
	_append_u32(output, data.size())
	output.append_array(type)
	output.append_array(data)
	var crc_input := type.duplicate()
	crc_input.append_array(data)
	_append_u32(output, _crc32(crc_input))
	return output

static func _crc32(data: PackedByteArray) -> int:
	var crc := 0xffffffff
	for byte in data:
		crc ^= int(byte)
		for _bit in 8: crc = (crc >> 1) ^ 0xedb88320 if (crc & 1) != 0 else crc >> 1
	return crc ^ 0xffffffff

static func _has_signature(source: PackedByteArray) -> bool:
	var expected := signature()
	if source.size() < expected.size(): return false
	for index in expected.size():
		if source[index] != expected[index]: return false
	return true

static func signature() -> PackedByteArray:
	return PackedByteArray([137,80,78,71,13,10,26,10])

static func ihdr() -> PackedByteArray:
	return PackedByteArray([73,72,68,82])

static func itxt() -> PackedByteArray:
	return PackedByteArray([105,84,88,116])

static func _has_type(source: PackedByteArray, offset: int, type: PackedByteArray) -> bool:
	if offset + type.size() > source.size(): return false
	for index in type.size():
		if source[offset + index] != type[index]: return false
	return true

static func _contains_zero(bytes: PackedByteArray) -> bool:
	for byte in bytes:
		if byte == 0: return true
	return false

static func _read_u32(source: PackedByteArray, offset: int) -> int:
	return (int(source[offset]) << 24) | (int(source[offset + 1]) << 16) | (int(source[offset + 2]) << 8) | int(source[offset + 3])

static func _append_u32(target: PackedByteArray, value: int) -> void:
	target.append((value >> 24) & 0xff)
	target.append((value >> 16) & 0xff)
	target.append((value >> 8) & 0xff)
	target.append(value & 0xff)

static func _append_range(target: PackedByteArray, source: PackedByteArray, start: int, end: int) -> void:
	for index in range(start, end): target.append(source[index])
