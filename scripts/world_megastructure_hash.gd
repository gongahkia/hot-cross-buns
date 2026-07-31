class_name WorldMegastructureHash
extends RefCounted

const HASH_ALGORITHM := "sha256"

static func canonical_json(value: Variant) -> String:
	match typeof(value):
		TYPE_NIL:
			return "null"
		TYPE_BOOL:
			return "true" if value else "false"
		TYPE_INT:
			return str(value)
		TYPE_STRING:
			return JSON.stringify(value)
		TYPE_ARRAY:
			var items: Array[String] = []
			for item in value:
				var encoded := canonical_json(item)
				if encoded.is_empty():
					return ""
				items.append(encoded)
			return "[" + ",".join(items) + "]"
		TYPE_DICTIONARY:
			var keys: Array = value.keys()
			for key in keys:
				if typeof(key) != TYPE_STRING:
					return ""
			keys.sort()
			var entries: Array[String] = []
			for key in keys:
				var encoded := canonical_json(value.get(key))
				if encoded.is_empty():
					return ""
				entries.append(JSON.stringify(key) + ":" + encoded)
			return "{" + ",".join(entries) + "}"
		_:
			return ""

static func canonical_hash(value: Variant) -> String:
	var encoded := canonical_json(value)
	if encoded.is_empty():
		return ""
	var context := HashingContext.new()
	if context.start(HashingContext.HASH_SHA256) != OK:
		return ""
	if context.update(encoded.to_utf8_buffer()) != OK:
		return ""
	return context.finish().hex_encode()
