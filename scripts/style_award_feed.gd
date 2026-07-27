class_name StyleAwardFeed
extends Control

const MAX_ROWS := 3

var rows: Array[Control] = []

func _ready() -> void:
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	custom_minimum_size = Vector2(330.0, 150.0)

func push_award(award: Dictionary) -> void:
	if award.is_empty():
		return
	var severity := str(award.get("severity", "minor"))
	var color := _color_for(severity)
	var title := "+%d  %s" % [int(award.get("points", 0)), str(award.get("label", "STYLE"))]
	var detail := "MVT x%.2f  COMBO x%d" % [float(award.get("movement_multiplier", 1.0)), int(award.get("combo_multiplier", 1))]
	_push_row(title, detail, color, 1.10 if severity == "peak" else 1.0)
	if bool(award.get("rank_up", false)):
		_push_row("RANK UP  " + str(award.get("tier", "FLOW")), "KEEP THE CHAIN ALIVE", Color("#f7e7a2"), 1.16)

func push_bank(points: int) -> void:
	if points > 0:
		_push_row("BANK +%d" % points, "CHAIN SECURED", Color("#b9f6df"), 1.04)

func push_bail(points: int) -> void:
	if points > 0:
		_push_row("BAIL -%d" % points, "BANKED STYLE IS SAFE", Color("#ef9b7d"), 1.08)

func clear_feed() -> void:
	for row in rows:
		if is_instance_valid(row):
			row.queue_free()
	rows.clear()

func _push_row(title: String, detail: String, color: Color, scale_factor: float) -> void:
	_prune_rows()
	while rows.size() >= MAX_ROWS:
		var stale: Control = rows.pop_back()
		if is_instance_valid(stale):
			stale.queue_free()
	var panel := PanelContainer.new()
	panel.custom_minimum_size = Vector2(322.0, 42.0)
	panel.position = Vector2(22.0, 0.0)
	panel.modulate = Color(1.0, 1.0, 1.0, 0.0)
	panel.scale = Vector2(scale_factor, scale_factor)
	panel.add_theme_stylebox_override("panel", _panel_style(color))
	var box := VBoxContainer.new()
	box.add_theme_constant_override("separation", -2)
	panel.add_child(box)
	var headline := Label.new()
	headline.text = title
	headline.add_theme_font_size_override("font_size", 18)
	headline.add_theme_color_override("font_color", color)
	headline.autowrap_mode = TextServer.AUTOWRAP_OFF
	box.add_child(headline)
	var subline := Label.new()
	subline.text = detail
	subline.add_theme_font_size_override("font_size", 12)
	subline.add_theme_color_override("font_color", Color("#d3dec5"))
	subline.autowrap_mode = TextServer.AUTOWRAP_OFF
	box.add_child(subline)
	add_child(panel)
	rows.push_front(panel)
	_layout_rows()
	var enter := create_tween()
	enter.set_parallel(true)
	enter.tween_property(panel, "modulate:a", 1.0, 0.08)
	enter.tween_property(panel, "scale", Vector2.ONE, 0.12).set_trans(Tween.TRANS_BACK).set_ease(Tween.EASE_OUT)
	var exit := create_tween()
	exit.tween_interval(1.15)
	exit.tween_property(panel, "modulate:a", 0.0, 0.16)
	exit.tween_callback(_discard_row.bind(panel))

func _layout_rows() -> void:
	var y := 0.0
	for row in rows:
		if not is_instance_valid(row):
			continue
		var tween := create_tween()
		tween.tween_property(row, "position:y", y, 0.10).set_trans(Tween.TRANS_QUAD).set_ease(Tween.EASE_OUT)
		y += 46.0

func _discard_row(row: Control) -> void:
	rows.erase(row)
	if is_instance_valid(row):
		row.queue_free()
	_layout_rows()

func _prune_rows() -> void:
	for index in range(rows.size() - 1, -1, -1):
		if not is_instance_valid(rows[index]):
			rows.remove_at(index)

func _panel_style(color: Color) -> StyleBoxFlat:
	var style := StyleBoxFlat.new()
	style.bg_color = Color("#102018e8")
	style.border_color = color
	style.set_border_width_all(1)
	style.set_corner_radius_all(3)
	style.content_margin_left = 10.0
	style.content_margin_right = 10.0
	style.content_margin_top = 3.0
	style.content_margin_bottom = 3.0
	return style

func _color_for(severity: String) -> Color:
	match severity:
		"peak": return Color("#f7e7a2")
		"major": return Color("#f1d477")
		_: return Color("#b9f6df")
