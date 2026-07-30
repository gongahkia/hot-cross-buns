class_name PixelPresentation
extends RefCounted

static func quantize(color: Color, steps: int = 8) -> Color:
	var count := maxi(2, steps)
	return Color(round(color.r*float(count-1))/float(count-1),round(color.g*float(count-1))/float(count-1),round(color.b*float(count-1))/float(count-1),color.a)
