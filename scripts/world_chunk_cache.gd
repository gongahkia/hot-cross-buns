class_name WorldChunkCache
extends RefCounted
var capacity:int
var entries:Dictionary={}
var order:Array[String]=[]
func _init(next_capacity:int=128)->void:capacity=maxi(0,next_capacity)
func fetch(key:String)->Dictionary:
	if not entries.has(key):return {}
	_touch(key);return (entries[key] as Dictionary).duplicate(true)
func put(key:String,value:Dictionary)->void:
	if capacity==0:return
	entries[key]=value.duplicate(true);_touch(key)
	if order.size()>capacity:entries.erase(order.pop_front())
func _touch(key:String)->void:
	var index:=order.find(key)
	if index>=0:order.remove_at(index)
	order.append(key)
func size()->int:return entries.size()
