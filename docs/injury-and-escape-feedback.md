# Injury and escape feedback

The centered encounter notice displays a brief `INJURY +NN` message for qualifying landing injuries and `WILDLIFE ESCAPED — ACTION` after a successful traversal contact. Messages share the existing briefing-label fade path.

Dependencies: `SurvivalState`, `WildlifeFeedback`, `WildlifeAgent`, and the existing expedition HUD. Feedback allocates one short tween per event.

Out of scope: wildlife-caused player injury, health bars, audio, hit markers, animation, rewards, and accessibility alternatives.
