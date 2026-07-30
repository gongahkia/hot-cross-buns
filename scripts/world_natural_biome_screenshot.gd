class_name WorldNaturalBiomeScreenshot
extends RefCounted

const BIOMES = preload("res://scripts/world_biomes.gd")
const PRESENTATION = preload("res://scripts/world_region_presentation.gd")

static func capture(cells: Array, columns: int, tile_size: int = 16) -> Dictionary:
	assert(columns > 0 and tile_size > 0 and not cells.is_empty() and cells.size() % columns == 0,"natural biome screenshot dimensions must be valid")
	var rows := cells.size() / columns
	var image := Image.create(columns * tile_size,rows * tile_size,false,Image.FORMAT_RGBA8)
	var biomes: Array = []
	for index in range(cells.size()):
		assert(cells[index] is Dictionary,"natural biome screenshot cells must be dictionaries")
		var biome := _biome(cells[index] as Dictionary)
		biomes.append(biome)
		var color: Color = PRESENTATION.palette(biome,"wilderness").terrain
		var origin_x := index % columns * tile_size
		var origin_y := index / columns * tile_size
		for y in range(origin_y,origin_y + tile_size):
			for x in range(origin_x,origin_x + tile_size): image.set_pixel(x,y,color)
	return {"image":image,"width":image.get_width(),"height":image.get_height(),"biomes":biomes,"rgba_sha256":_sha256(image.get_data())}

static func _biome(cell: Dictionary) -> String:
	return BIOMES.lookup(float(cell.get("temperature",0.5)),float(cell.get("precipitation",cell.get("rainfall",0.5))),float(cell.get("elevation",0.0)),bool(cell.get("water",false)),float(cell.get("slope",0.0)),float(cell.get("hotspot",0.0)),bool(cell.get("flood_basalt",false)),int(cell.get("karst_type",0)),int(cell.get("reef_stage",0)),bool(cell.get("allow_exotic",false)),cell)

static func _sha256(bytes: PackedByteArray) -> String:
	var context := HashingContext.new()
	assert(context.start(HashingContext.HASH_SHA256) == OK,"natural biome screenshot hash initialization failed")
	assert(context.update(bytes) == OK,"natural biome screenshot hash update failed")
	return context.finish().hex_encode()
