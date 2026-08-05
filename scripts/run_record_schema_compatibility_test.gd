extends SceneTree

const RUN_DATA := preload("res://scripts/run_data.gd")
const RUN_EXPORT := preload("res://scripts/run_export.gd")
const SCHEMA := preload("res://scripts/run_record_schema.gd")
const EXPECTED_CANONICAL := "{\"replay\":{\"checkpoints\":[{\"state_hash\":\"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\",\"tick\":60}],\"input_spans\":[{\"actions\":1,\"end_tick\":59,\"look_x\":0,\"look_y\":-4,\"start_tick\":0},{\"actions\":0,\"end_tick\":119,\"look_x\":1,\"look_y\":0,\"start_tick\":60}]},\"ruleset_version\":\"1.0.0\",\"run\":{\"outcome\":\"extracted\",\"summary\":{\"coordinates\":{\"chunk_x\":-1,\"chunk_z\":1,\"offset_x\":0,\"offset_z\":0},\"elapsed_ticks\":7200,\"inventory\":{\"food\":1,\"wood\":2}}},\"schema\":\"run-record/v1\",\"simulation\":{\"start_tick\":0,\"tick_hz\":60},\"world\":{\"generation_options\":{\"biome\":\"default\",\"erosion\":{\"passes\":2}},\"generator_schema_version\":\"2.0.0\",\"seed\":\"-9223372036854775808\"}}"
const EXPECTED_HASH := "5df256e849f421b4fd27fcc70cbfb508f240e2e79213102a70c91a24fa179ded"

var failed := false

func _initialize() -> void:
	_assert_legacy_summary()
	_assert_current_v1_record()
	_assert_rejections()
	quit(1 if failed else 0)

func _assert_legacy_summary() -> void:
	var run := RUN_DATA.new()
	run.begin_run("expedition", 20260730)
	run.add_resource("wood", 2)
	var legacy := run.finish("extracted", {"health":88.0})
	var result := SCHEMA.compatibility(legacy)
	_expect(bool(result.compatible) and str(result.status) == SCHEMA.LEGACY_SCHEMA, "legacy run summary compatibility drifted")
	legacy.erase("style")
	_expect(not bool(SCHEMA.compatibility(legacy).compatible), "malformed legacy summary accepted")
	run.free()

func _assert_current_v1_record() -> void:
	var record := _v1_record()
	var canonical := SCHEMA.canonical_authoritative_json(record)
	var hash := SCHEMA.canonical_hash(record)
	_expect(canonical == EXPECTED_CANONICAL, "canonical run-record bytes drifted")
	_expect(hash == EXPECTED_HASH, "canonical run-record hash drifted")
	record.integrity.canonical_hash = hash
	var result := SCHEMA.compatibility(record)
	_expect(bool(result.compatible) and str(result.status) == SCHEMA.CURRENT_SCHEMA, "current run-record rejected")
	var metadata_changed := record.duplicate(true)
	metadata_changed.metadata.extensions["org.example.fixture"]["label"] = "alternate"
	_expect(SCHEMA.canonical_authoritative_json(metadata_changed) == canonical and SCHEMA.canonical_hash(metadata_changed) == hash and bool(SCHEMA.compatibility(metadata_changed).compatible), "metadata changed authoritative identity")
	_expect(RUN_EXPORT.GENERATOR_SCHEMA_VERSION == SCHEMA.GENERATOR_SCHEMA_VERSION, "export world identity diverged from schema source")

func _assert_rejections() -> void:
	var valid := _v1_record()
	valid.integrity.canonical_hash = SCHEMA.canonical_hash(valid)
	var incompatible_generator := valid.duplicate(true)
	incompatible_generator.world.generator_schema_version = "1.0.0"
	_expect(str(SCHEMA.compatibility(incompatible_generator).status) == "generator_schema_version_mismatch", "generator mismatch accepted")
	var incompatible_ruleset := valid.duplicate(true)
	incompatible_ruleset.ruleset_version = "2.0.0"
	_expect(str(SCHEMA.compatibility(incompatible_ruleset).status) == "ruleset_version_mismatch", "ruleset mismatch accepted")
	var tampered := valid.duplicate(true)
	tampered.run.summary.inventory.wood = 3
	_expect(str(SCHEMA.compatibility(tampered).status) == "integrity_mismatch", "tampered authoritative record accepted")
	var unknown_authoritative := valid.duplicate(true)
	unknown_authoritative["unexpected"] = true
	_expect(str(SCHEMA.compatibility(unknown_authoritative).status) == "invalid_v1_envelope", "unknown authoritative key accepted")
	var gapped_spans := valid.duplicate(true)
	gapped_spans.replay.input_spans[1].start_tick = 61
	gapped_spans.integrity.canonical_hash = SCHEMA.canonical_hash(gapped_spans)
	_expect(str(SCHEMA.compatibility(gapped_spans).status) == "invalid_replay", "ambiguous replay gap accepted")
	var malformed_seed := valid.duplicate(true)
	malformed_seed.world.seed = "01"
	_expect(str(SCHEMA.compatibility(malformed_seed).status) == "generator_schema_version_mismatch", "noncanonical seed accepted")

func _v1_record() -> Dictionary:
	return {"schema":SCHEMA.CURRENT_SCHEMA,"world":{"seed":"-9223372036854775808","generator_schema_version":SCHEMA.GENERATOR_SCHEMA_VERSION,"generation_options":{"biome":"default","erosion":{"passes":2}}},"ruleset_version":SCHEMA.RULESET_VERSION,"simulation":{"tick_hz":SCHEMA.TICK_HZ,"start_tick":0},"run":{"outcome":"extracted","summary":{"coordinates":{"chunk_x":-1,"chunk_z":1,"offset_x":0,"offset_z":0},"elapsed_ticks":7200,"inventory":{"food":1,"wood":2}}},"replay":{"input_spans":[{"start_tick":0,"end_tick":59,"actions":1,"look_x":0,"look_y":-4},{"start_tick":60,"end_tick":119,"actions":0,"look_x":1,"look_y":0}],"checkpoints":[{"tick":60,"state_hash":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"}]},"integrity":{"canonical_hash_algorithm":"sha256","canonical_hash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"},"metadata":{"display_name":"compatibility fixture","extensions":{"org.example.fixture":{"source":"headless"}}}}

func _expect(condition: bool, message: String) -> void:
	if condition:
		return
	failed = true
	push_error(message)
