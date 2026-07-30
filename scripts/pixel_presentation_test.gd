extends SceneTree
const PRESENTATION = preload("res://scripts/pixel_presentation.gd")
var failed := false
func _initialize() -> void:
	var quantized := PRESENTATION.quantize(Color(0.51,0.1,0.99), 8)
	_expect(is_equal_approx(quantized.r,4.0/7.0) and is_equal_approx(quantized.g,1.0/7.0) and is_equal_approx(quantized.b,1.0), "palette quantization drifted")
	_expect(PRESENTATION.quantize(Color(0.5,0.5,0.5), 1) == PRESENTATION.quantize(Color(0.5,0.5,0.5), 2), "palette step floor drifted")
	quit(1 if failed else 0)
func _expect(condition: bool, message: String) -> void:
	if condition: return
	failed = true; push_error(message)
