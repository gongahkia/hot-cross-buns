extends SceneTree

const GENERATOR := preload("res://scripts/world_megastructure_generator.gd")
const PROTOTYPE := preload("res://scripts/world_megastructure_prototype.gd")

var failed := false

func _initialize() -> void:
	var descriptor := GENERATOR.new(20260730).generate(Vector3i.ZERO)
	var root := PROTOTYPE.compile(descriptor, func(_position: Vector3) -> float: return 0.0)
	_expect(root.name == "MegastructurePrototype" and str(root.get_meta("descriptor_hash", "")).length() == 64, "prototype descriptor ownership drifted")
	for expected in ["SpineWallLeft", "SpineWallRight", "ThresholdLintel", "CompressionWallLeft", "CompressionWallRight", "OpeningRoute", "TransitDeck", "SignalSpire", "MegastructureGrappleAnchor", "MegastructureDebug"]:
		_expect(root.get_node_or_null(expected) != null, "prototype mass missing: " + expected)
	_expect((root.get_node_or_null("SpineWallLeft") as Node).get_child_count() == 2 and (root.get_node_or_null("OpeningRoute") as Node).get_child_count() == 2, "prototype collision ownership drifted")
	var debug := root.get_node_or_null("MegastructureDebug") as Node3D
	var ownership: Node3D = debug.get_node_or_null("BoundaryOwnership") as Node3D if debug else null
	_expect(debug != null and not debug.visible and ownership != null and ownership.get_child_count() == 4, "debug overlay contract drifted")
	for expected in ["OwnerStructuralPorts", "NeighborStructuralPorts", "OwnerTraversalPorts", "NeighborTraversalPorts"]:
		_expect(ownership.get_node_or_null(expected) != null, "boundary ownership debug missing: " + expected)
	PROTOTYPE.set_debug_visible(root, true)
	_expect(debug.visible, "debug overlay did not activate")
	PROTOTYPE.set_origin(root, Vector2i(3, -2))
	_expect(root.position == Vector3(-192.0, 0.0, 128.0), "prototype origin conversion drifted")
	var spawn := PROTOTYPE.entry_spawn(descriptor, func(_position: Vector3) -> float: return 7.5)
	_expect(is_equal_approx(spawn.y, 49.55), "prototype entry spawn height drifted")
	root.queue_free()
	quit(1 if failed else 0)

func _expect(condition: bool, message: String) -> void:
	if condition:
		return
	failed = true
	push_error(message)
