class_name RunArchive
extends RefCounted

const MAX_RECORDS := 32

var records: Array[Dictionary] = []
var next_id := 1

func append(record: Dictionary) -> Dictionary:
	if str(record.get("outcome", "active")) not in ["extracted", "failed"]: return {}
	var summary := {"id":next_id,"outcome":str(record.outcome),"level":str(record.get("level", "")),"seed":int(record.get("seed", 0)),"elapsed":float(record.get("elapsed", 0.0)),"collectibles":int(record.get("collectibles", 0)),"resources":(record.get("resources", {}) as Dictionary).duplicate(),"regions":(record.get("regions", []) as Array).duplicate(),"survival":(record.get("survival", {}) as Dictionary).duplicate(true)}
	next_id += 1
	records.append(summary)
	if records.size() > MAX_RECORDS: records.pop_front()
	return summary.duplicate(true)

func list() -> Array:
	return records.duplicate(true)
