class_name WorldChunkScheduler
extends RefCounted

const GENERATOR=preload("res://scripts/world_generator.gd")
var seed:int
var queue:Array=[]
var completed:Array=[]
var worker:Thread
var active:Dictionary={}
var token:=0
var cancelled:Dictionary={}
func _init(next_seed:int)->void:seed=next_seed
func request(chunk_x:int,chunk_z:int,lod:int=0,priority:float=0.0)->int:
	token+=1;queue.append({"seed":seed,"chunk_x":chunk_x,"chunk_z":chunk_z,"lod":lod,"token":token,"priority":priority});queue.sort_custom(func(a:Dictionary,b:Dictionary)->bool:return float(a.priority)<float(b.priority) if float(a.priority)!=float(b.priority) else int(a.token)<int(b.token));return token
func poll()->Array:
	if worker and not worker.is_alive(): completed.append(_finish(worker.wait_to_finish()));worker=null;active={}
	if worker==null and not queue.is_empty(): active=queue.pop_front();worker=Thread.new();worker.start(_generate.bind(active))
	var result:=completed.duplicate();completed.clear();return result
func wait_for_all()->Array:
	var result: Array=[]
	while not queue.is_empty() or worker:
		if worker:
			result.append(_finish(worker.wait_to_finish()));worker=null;active={}
		if not queue.is_empty(): active=queue.pop_front();worker=Thread.new();worker.start(_generate.bind(active))
	result.append_array(completed);completed.clear();return result
func shutdown()->void:
	if worker: worker.wait_to_finish();worker=null
	queue.clear();completed.clear();active={}
func cancel(request_token:int)->void:
	cancelled[request_token]=true;queue=queue.filter(func(request:Dictionary)->bool:return int(request.token)!=request_token)
func _finish(result:Dictionary)->Dictionary:
	if cancelled.has(int(result.get("token",-1))): result["status"]="cancelled";result.erase("descriptor")
	return result
static func _generate(request:Dictionary)->Dictionary:
	var generator=GENERATOR.new(int(request.seed));var descriptor=generator.chunk_descriptor(int(request.chunk_x),int(request.chunk_z));return {"status":"ok","token":int(request.token),"key":{"chunk_x":int(request.chunk_x),"chunk_z":int(request.chunk_z),"lod":int(request.lod)},"descriptor":descriptor}
