@tool
extends VBoxContainer

const PROTOCOL_VERSION := 1

var editor_interface: EditorInterface
var _cli_path := ""
var _command := ""
var _active_process := {}
var _stdio: FileAccess
var _stderr: FileAccess
var _packages: ItemList
var _status: Label
var _sync_button: Button

func _ready() -> void:
	_build_ui()
	_set_status("Detecting wukong…")
	_cli_path = _detect_cli()
	if _cli_path.is_empty():
		_set_status("wukong was not found; set WUKONG_EXECUTABLE and restart Godot.")
		return
	_refresh_status()

func _process(_delta: float) -> void:
	if _active_process.is_empty():
		return
	_drain_stdout()
	_drain_stderr()
	if OS.is_process_running(int(_active_process["pid"])):
		return
	_drain_stdout()
	_drain_stderr()
	var exit_code := OS.get_process_exit_code(int(_active_process["pid"]))
	_active_process.clear()
	_stdio = null
	_stderr = null
	_sync_button.disabled = false
	if exit_code != 0:
		_set_status("wukong exited with status %d." % exit_code)
		return
	if _command == "sync":
		_refresh_status()

func _build_ui() -> void:
	var controls := HBoxContainer.new()
	var refresh := Button.new()
	refresh.text = "Refresh"
	refresh.pressed.connect(_refresh_status)
	controls.add_child(refresh)
	_sync_button = Button.new()
	_sync_button.text = "Sync"
	_sync_button.pressed.connect(_run_sync)
	controls.add_child(_sync_button)
	add_child(controls)
	_packages = ItemList.new()
	_packages.size_flags_vertical = Control.SIZE_EXPAND_FILL
	add_child(_packages)
	var files := HBoxContainer.new()
	var manifest := Button.new()
	manifest.text = "Manifest"
	manifest.pressed.connect(_open_manifest)
	files.add_child(manifest)
	var lockfile := Button.new()
	lockfile.text = "Lockfile"
	lockfile.pressed.connect(_open_lockfile)
	files.add_child(lockfile)
	add_child(files)
	_status = Label.new()
	_status.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	add_child(_status)

func _detect_cli() -> String:
	var configured := OS.get_environment("WUKONG_EXECUTABLE")
	var candidate := configured if not configured.is_empty() else "wukong"
	var output := []
	if OS.execute(candidate, ["--help"], output, true) == 0:
		return candidate
	return ""

func _refresh_status() -> void:
	_start("status", ["status", "--json", "--project", _project_path()])

func _run_sync() -> void:
	_start("sync", ["sync", "--json", "--project", _project_path()])

func _start(command: String, arguments: PackedStringArray) -> void:
	if _cli_path.is_empty() or not _active_process.is_empty():
		return
	_active_process = OS.execute_with_pipe(_cli_path, arguments, false)
	if _active_process.is_empty():
		_set_status("Could not start wukong.")
		return
	_command = command
	_stdio = _active_process["stdio"]
	_stderr = _active_process["stderr"]
	_sync_button.disabled = true
	_set_status("wukong %s started." % command)

func _drain_stdout() -> void:
	while true:
		var line := _stdio.get_line()
		if line.is_empty():
			return
		_handle_event(line)

func _drain_stderr() -> void:
	while true:
		var line := _stderr.get_line()
		if line.is_empty():
			return
		var diagnostic = JSON.parse_string(line)
		if diagnostic is Dictionary:
			_show_diagnostic(diagnostic)

func _handle_event(line: String) -> void:
	var event = JSON.parse_string(line)
	if not event is Dictionary or event.get("protocol") != PROTOCOL_VERSION:
		_set_status("wukong returned an unsupported machine event.")
		return
	match event.get("type"):
		"progress":
			_set_status("%s…" % event.get("phase", "working"))
		"result":
			_handle_result(event.get("result", {}))

func _handle_result(result: Dictionary) -> void:
	if _command == "status":
		_packages.clear()
		for package in result.get("packages", []):
			_packages.add_item("%s  %s" % [package.get("name"), package.get("immutable_id")])
		_set_status("%d installed package(s)." % _packages.item_count)
		return
	if _command == "sync":
		_set_status(
			"sync: %d written, %d unchanged, %d removed"
			% [result.get("written", 0), result.get("unchanged", 0), result.get("removed", 0)]
		)

func _show_diagnostic(diagnostic: Dictionary) -> void:
	var message := "error[%s]: %s" % [diagnostic.get("code", "unknown"), diagnostic.get("message", "unknown failure")]
	if diagnostic.get("recovery") != null:
		message += "\n%s" % diagnostic.get("recovery")
	_set_status(message)

func _open_manifest() -> void:
	_open_project_file("res://wukong.toml")

func _open_lockfile() -> void:
	_open_project_file("res://wukong.lock")

func _open_project_file(path: String) -> void:
	if FileAccess.file_exists(path):
		editor_interface.get_file_system_dock().navigate_to_path(path)
	else:
		_set_status("%s does not exist." % path)

func _project_path() -> String:
	return ProjectSettings.globalize_path("res://")

func _set_status(message: String) -> void:
	_status.text = message
