extends Node

var ambient_player: AudioStreamPlayer
var sfx_player: AudioStreamPlayer
var ambient_playback: AudioStreamGeneratorPlayback
var sfx_playback: AudioStreamGeneratorPlayback
var ambient_phase := 0.0
var sfx_phase := 0.0
var sfx_frequency := 440.0
var sfx_remaining := 0.0

func _ready() -> void:
	if DisplayServer.get_name() == "headless":
		set_process(false)
		return
	ambient_player = _generator_player(22050.0)
	sfx_player = _generator_player(22050.0)
	add_child(ambient_player)
	add_child(sfx_player)
	ambient_player.play()
	sfx_player.play()

func _exit_tree() -> void:
	if ambient_player:
		ambient_player.stop()
	if sfx_player:
		sfx_player.stop()
	ambient_playback = null
	sfx_playback = null
	if ambient_player:
		ambient_player.stream = null
	if sfx_player:
		sfx_player.stream = null

func _process(delta: float) -> void:
	ambient_player.volume_linear = Settings.master_volume * Settings.ambient_volume * 0.22
	sfx_player.volume_linear = Settings.master_volume * Settings.sfx_volume * 0.35
	if not ambient_playback:
		ambient_playback = ambient_player.get_stream_playback()
	if not sfx_playback:
		sfx_playback = sfx_player.get_stream_playback()
	_fill_ambient(delta)
	_fill_sfx(delta)

func play_sfx(kind: String) -> void:
	match kind:
		"jump":
			sfx_frequency = 380.0
			sfx_remaining = 0.08
		"dash":
			sfx_frequency = 620.0
			sfx_remaining = 0.11
		"boost":
			sfx_frequency = 520.0
			sfx_remaining = 0.16
		"launch":
			sfx_frequency = 740.0
			sfx_remaining = 0.2
		"pickup":
			sfx_frequency = 960.0
			sfx_remaining = 0.14
		"finish":
			sfx_frequency = 680.0
			sfx_remaining = 0.42

func _generator_player(rate: float) -> AudioStreamPlayer:
	var player := AudioStreamPlayer.new()
	var stream := AudioStreamGenerator.new()
	stream.mix_rate = rate
	stream.buffer_length = 0.5
	player.stream = stream
	return player

func _fill_ambient(_delta: float) -> void:
	if not ambient_playback:
		return
	var rate := 22050.0
	for _frame in ambient_playback.get_frames_available():
		var low := sin(ambient_phase * TAU * 77.0) * 0.16
		var high := sin(ambient_phase * TAU * 123.0) * 0.05
		ambient_playback.push_frame(Vector2.ONE * (low + high))
		ambient_phase = fmod(ambient_phase + 1.0 / rate, 1.0)

func _fill_sfx(_delta: float) -> void:
	if not sfx_playback:
		return
	var rate := 22050.0
	for _frame in sfx_playback.get_frames_available():
		var sample := 0.0
		if sfx_remaining > 0.0:
			var envelope: float = clampf(sfx_remaining * 12.0, 0.0, 1.0)
			sample = sin(sfx_phase * TAU * sfx_frequency) * envelope
			sfx_phase = fmod(sfx_phase + 1.0 / rate, 1.0)
			sfx_remaining = max(sfx_remaining - 1.0 / rate, 0.0)
		sfx_playback.push_frame(Vector2.ONE * sample)
