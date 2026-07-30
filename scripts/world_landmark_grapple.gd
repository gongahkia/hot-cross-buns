class_name WorldLandmarkGrapple
extends RefCounted

const ANCHOR_OFFSET := 1.4

static func anchor_spec(record: Dictionary, landmark_height: float) -> Dictionary:
	var landmark_id := str(record.get("id", ""))
	if landmark_id.is_empty() or landmark_height <= 0.0: return {}
	return {"name":"LandmarkGrappleAnchor","landmark_id":landmark_id,"height":landmark_height+ANCHOR_OFFSET}
