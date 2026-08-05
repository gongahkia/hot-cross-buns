class_name WorldRng
extends RefCounted

const LCG_MOD := 2147483647
const U32 := 4294967296
const I32 := 2147483648
const LUA_BITOP_MAGIC := 6755399441055744.0
const HASH_SEED := 374761393
const HASH_A := 73856093
const HASH_B := 19349663
const HASH_C := 83492791
const HASH_D := 26544357

var state: int

func _init(next_seed: int = 1) -> void:
	state = int(posmod(next_seed, LCG_MOD))

func next() -> int:
	state = int((state * 48271 + 1) % LCG_MOD)
	return state

func next_unit() -> float:
	return float(next()) / float(LCG_MOD)

func next_range(min_value: int, max_value: int) -> int:
	assert(max_value >= min_value, "max_value must be at least min_value")
	return min_value + int(posmod(next(), max_value - min_value + 1))

static func thoth_hash(seed: int, a: int = 0, b: int = 0, c: int = 0, d: int = 0) -> int:
	var mixed := _mul_u32(seed, HASH_SEED)
	mixed ^= _mul_u32(a, HASH_A)
	mixed ^= _mul_u32(b, HASH_B)
	mixed ^= _mul_u32(c, HASH_C)
	mixed ^= _mul_u32(d, HASH_D)
	return _i32(mixed ^ (_u32(mixed) >> 16))

static func unit_at(seed: int, a: int = 0, b: int = 0, c: int = 0, d: int = 0) -> float:
	return float(_u32(thoth_hash(seed, a, b, c, d))) / float(U32)

static func thoth_signed(seed: int, a: int = 0, b: int = 0, c: int = 0, d: int = 0) -> float:
	return unit_at(seed, a, b, c, d) * 2.0 - 1.0

static func _u32(value: int) -> int:
	return int(posmod(value, U32))

static func _i32(value: int) -> int:
	var normalized := _u32(value)
	return normalized - U32 if normalized >= I32 else normalized

static func _mul_u32(left: int, right: int) -> int:
	return _u32(_lua_tobit(float(left) * float(right)))

static func _lua_tobit(value: float) -> int:
	var bytes := PackedByteArray()
	bytes.resize(8)
	bytes.encode_double(0, value + LUA_BITOP_MAGIC)
	return bytes.decode_s32(0)

static func hash_int(seed: int, x: int, z: int, salt := 0) -> int:
	var value := seed ^ (x * 374761393) ^ (z * 668265263) ^ (salt * 1442695041)
	value = (value ^ (value >> 13)) * 1274126177
	value ^= value >> 16
	return value & 0x7fffffff

static func unit(seed: int, x: int, z: int, salt := 0) -> float:
	return float(hash_int(seed, x, z, salt)) / 2147483647.0

static func signed(seed: int, x: int, z: int, salt := 0) -> float:
	return unit(seed, x, z, salt) * 2.0 - 1.0

static func value_noise(seed: int, x: float, z: float, salt := 0) -> float:
	var x0 := floori(x)
	var z0 := floori(z)
	var tx := x - float(x0)
	var tz := z - float(z0)
	tx = tx * tx * (3.0 - 2.0 * tx)
	tz = tz * tz * (3.0 - 2.0 * tz)
	var a := signed(seed, x0, z0, salt)
	var b := signed(seed, x0 + 1, z0, salt)
	var c := signed(seed, x0, z0 + 1, salt)
	var d := signed(seed, x0 + 1, z0 + 1, salt)
	return lerpf(lerpf(a, b, tx), lerpf(c, d, tx), tz)

static func fbm(seed: int, x: float, z: float, octaves := 5, salt := 0) -> float:
	var sum := 0.0
	var amplitude := 0.5
	var frequency := 1.0
	var weight := 0.0
	for index in range(octaves):
		sum += value_noise(seed, x * frequency, z * frequency, salt + index * 97) * amplitude
		weight += amplitude
		frequency *= 2.03
		amplitude *= 0.5
	return sum / maxf(weight, 0.0001)
