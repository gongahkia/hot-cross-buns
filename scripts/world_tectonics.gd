class_name WorldTectonics
extends RefCounted

const NOISE = preload("res://scripts/world_noise.gd")
const BATHYMETRY = preload("res://scripts/world_bathymetry.gd")

var seed: int

func _init(next_seed: int) -> void:
	seed = next_seed

func synthesize(base: Dictionary, hotspot: Dictionary = {}) -> Dictionary:
	var plate: Dictionary = base.get("plate", {})
	var factor := float(base.get("scale_factor", 1))
	var ridge := float(base.get("ridge", 0.0))
	var boundary := float(plate.get("boundary", 0.0))
	var convergent := float(plate.get("convergent", 0.0))
	var divergent := float(plate.get("divergent", 0.0))
	var primary_crust := str(plate.get("crust", ""))
	var secondary_crust := str(plate.get("secondary_crust", ""))
	var uplift := boundary * (convergent * 0.52 + ridge * 0.26)
	var continental_rift := boundary * divergent if primary_crust == "continental" and secondary_crust == "continental" else 0.0
	var rift_valley := continental_rift * (0.55 + ridge * 0.45)
	var trench := float(plate.get("oceanic_subduction", 0.0)) * (0.24 + float(plate.get("age", 0.0)) * 0.2) if bool(plate.get("subducting", false)) else 0.0
	var subduction_uplift := float(plate.get("continent_ocean_subduction", 0.0)) * 0.24 if not bool(plate.get("subducting", false)) else 0.0
	var island_arc := 0.0
	if not bool(plate.get("subducting", false)) and float(plate.get("ocean_ocean_subduction", 0.0)) > 0.0:
		var arc_noise := NOISE.value(seed + 606, float(base.get("warped_x", 0.0)) * 0.014 / sqrt(factor), float(base.get("warped_z", 0.0)) * 0.014 / sqrt(factor), 6)
		island_arc = float(plate.get("ocean_ocean_subduction", 0.0)) * _smoothstep(0.42, 0.82, arc_noise)
	var abyssal_noise := 0.0
	if primary_crust == "oceanic":
		abyssal_noise = (NOISE.fbm(seed + 707, float(base.get("warped_x", 0.0)), float(base.get("warped_z", 0.0)), 3, 0.014 / sqrt(factor), 2.0, 0.5, 7) - 0.5) * 0.025 * (1.0 - float(base.get("shelf_proximity", 0.0)))
	var hotspot_contribution := float(hotspot.get("contribution", 0.0))
	var seamount_contribution := BATHYMETRY.seamount_at(seed, float(base.get("warped_x", 0.0)), float(base.get("warped_z", 0.0)), factor, plate, float(base.get("shelf_proximity", 0.0)))
	var elevation := float(base.get("elevation", 0.0)) + uplift + subduction_uplift + island_arc * 0.36 + hotspot_contribution + abyssal_noise + seamount_contribution - rift_valley * 0.26 - trench
	return {"base": base, "elevation": elevation, "uplift": uplift, "continental_rift": continental_rift, "rift_valley": rift_valley, "trench": trench, "subduction_uplift": subduction_uplift, "island_arc": island_arc, "passive_margin": float(base.get("margin_blend", 0.0)), "abyssal_noise": abyssal_noise, "hotspot_contribution": hotspot_contribution, "seamount_contribution": seamount_contribution}

func _smoothstep(minimum: float, maximum: float, value: float) -> float:
	var t := clampf((value - minimum) / (maximum - minimum), 0.0, 1.0)
	return t * t * (3.0 - 2.0 * t)
