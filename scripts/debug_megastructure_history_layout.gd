extends SceneTree

const GENERATOR := preload("res://scripts/world_megastructure_generator.gd")

func _initialize() -> void:
	var descriptor := GENERATOR.new(20260731).generate(Vector3i.ZERO)
	print(descriptor.get("entry", {}))
	for element: Dictionary in descriptor.get("construction_elements", []):
		print(element.get("element_id", ""), " ", element.get("bounds", {}))
	quit()
