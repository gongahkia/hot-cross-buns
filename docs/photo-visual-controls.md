# Photo visual controls

In photo mode, mouse wheel adjusts FOV; `0` restores entry FOV; Left/Right adjusts exposure; `Z`/`X` adjusts far-focus distance; `C`/`V` adjusts far blur; and `F` cycles Natural, Muted, Amber, and Vivid color profiles. Settings apply only to the temporary photo camera and are restored when photo mode closes.

Depth of field uses `CameraAttributesPractical`; Godot documents it as unsupported by Compatibility rendering, so the controls remain functional but blur may not render on that backend. Filter changes temporarily use the active expedition `Environment` adjustment properties. These controls do not save presets, embed capture metadata, alter generated world state, or perform high-resolution capture.
