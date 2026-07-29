class_name WorldRng
extends RefCounted

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
