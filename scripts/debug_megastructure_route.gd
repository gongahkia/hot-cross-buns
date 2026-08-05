extends SceneTree

const GENERATOR := preload("res://scripts/world_megastructure_generator.gd")
const VALIDATOR := preload("res://scripts/world_megastructure_route_validator.gd")

func _initialize() -> void:
	var descriptor := GENERATOR.new(20260731).generate(Vector3i.ZERO)
	print(VALIDATOR.validate_baseline_entry(descriptor))
	quit()
