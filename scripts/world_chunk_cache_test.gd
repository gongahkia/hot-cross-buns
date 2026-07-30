extends SceneTree
const CACHE=preload("res://scripts/world_chunk_cache.gd")
var failed:=false
func _initialize()->void:
	var cache=CACHE.new(2);cache.put("a",{"v":1});cache.put("b",{"v":2});cache.fetch("a");cache.put("c",{"v":3})
	_expect(cache.fetch("b").is_empty() and int(cache.fetch("a").v)==1 and cache.size()==2,"chunk LRU drifted")
	quit(1 if failed else 0)
func _expect(condition:bool,message:String)->void:
	if condition:return
	failed=true;push_error(message)
