class_name PerformanceHistogram
extends Control

var samples: Array[float] = []
var current_time := -1.0
var best_time := -1.0

func _ready() -> void:
	custom_minimum_size = Vector2(680.0, 190.0)

func set_data(attempts: Array[float], current: float, best: float) -> void:
	samples = attempts.duplicate()
	current_time = current
	best_time = best
	queue_redraw()

func _draw() -> void:
	var border := Color("#6e8c72")
	var panel := Color("#0e1a14e8")
	var grid := Color("#314a37")
	var bars := Color("#9dbf76")
	var current := Color("#f1d477")
	var best := Color("#82d0a2")
	var font := get_theme_font("font")
	var font_size := 12
	draw_rect(Rect2(Vector2.ZERO, size), panel, true)
	draw_rect(Rect2(Vector2.ZERO, size), border, false, 2.0)
	if font:
		draw_string(font, Vector2(14.0, 18.0), "PERSONAL TIME DISTRIBUTION", HORIZONTAL_ALIGNMENT_LEFT, -1.0, font_size, Color("#d9e6c9"))
	if samples.is_empty():
		if font:
			draw_string(font, Vector2(14.0, 62.0), "NO COMPLETED RUNS", HORIZONTAL_ALIGNMENT_LEFT, -1.0, 16, Color("#a4b29a"))
		return
	var min_time: float = float(samples.min())
	var max_time: float = float(samples.max())
	var span := maxf(max_time - min_time, 0.25)
	var padding := maxf(span * 0.12, 0.08)
	min_time = maxf(0.0, min_time - padding)
	max_time += padding
	span = max_time - min_time
	var bin_count := clampi(int(ceil(sqrt(float(samples.size())))), 5, 10)
	var bin_counts: Array[int] = []
	bin_counts.resize(bin_count)
	for index in range(bin_count):
		bin_counts[index] = 0
	for sample in samples:
		var bin := clampi(int(floor((sample - min_time) / span * bin_count)), 0, bin_count - 1)
		bin_counts[bin] += 1
	var peak := 1
	for count in bin_counts:
		peak = maxi(peak, count)
	var graph := Rect2(44.0, 32.0, size.x - 58.0, size.y - 68.0)
	draw_line(Vector2(graph.position.x, graph.end.y), graph.end, grid, 1.0)
	draw_line(graph.position, Vector2(graph.position.x, graph.end.y), grid, 1.0)
	var bar_width := graph.size.x / float(bin_count)
	for index in range(bin_count):
		var height := graph.size.y * float(bin_counts[index]) / float(peak)
		var rect := Rect2(graph.position.x + float(index) * bar_width + 3.0, graph.end.y - height, maxf(bar_width - 6.0, 1.0), height)
		draw_rect(rect, bars, true)
	var current_bin := clampi(int(floor((current_time - min_time) / span * bin_count)), 0, bin_count - 1)
	var best_bin := clampi(int(floor((best_time - min_time) / span * bin_count)), 0, bin_count - 1)
	var current_x := graph.position.x + (float(current_bin) + 0.5) * bar_width
	var best_x := graph.position.x + (float(best_bin) + 0.5) * bar_width
	draw_line(Vector2(best_x, graph.position.y), Vector2(best_x, graph.end.y), best, 1.0)
	draw_line(Vector2(current_x, graph.position.y), Vector2(current_x, graph.end.y), current, 2.0)
	if font:
		draw_string(font, Vector2(graph.position.x, size.y - 14.0), _time_text(min_time), HORIZONTAL_ALIGNMENT_LEFT, -1.0, font_size, Color("#a4b29a"))
		draw_string(font, Vector2(graph.end.x - 70.0, size.y - 14.0), _time_text(max_time), HORIZONTAL_ALIGNMENT_LEFT, -1.0, font_size, Color("#a4b29a"))
		draw_string(font, Vector2(graph.position.x, 29.0), "FAST", HORIZONTAL_ALIGNMENT_LEFT, -1.0, font_size, best)
		draw_string(font, Vector2(graph.end.x - 28.0, 29.0), "SLOW", HORIZONTAL_ALIGNMENT_LEFT, -1.0, font_size, current)

func _time_text(seconds: float) -> String:
	var minutes := int(seconds / 60.0)
	var remainder := seconds - float(minutes) * 60.0
	return "%02d:%05.2f" % [minutes, remainder]
