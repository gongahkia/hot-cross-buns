class_name WildlifeFeedback
extends RefCounted

static func escape(action: String) -> Dictionary:
	return {"text":"WILDLIFE ESCAPED — "+action.to_upper(),"color":Color("#b9f6df")}

static func injury(amount: float) -> Dictionary:
	return {"text":"INJURY +%02d" % roundi(amount),"color":Color("#f1c38b")}
