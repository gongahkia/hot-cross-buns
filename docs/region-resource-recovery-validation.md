# Region resource and recovery validation

`region_resource_recovery_test.gd` locates each generated region family, scans its 8×8 chunk area for deterministic resource records, and requires nonempty, unique, valid survival inventory with a food, water, dirty-water, or shelter-material recovery path. It also verifies that the shelter-material cost can be spent and that protected rest reduces injury/exposure while recovering health.

The scan validates descriptor availability, not pickup reachability, long-run balance, respawn, save persistence, or every seed. Runtime shelter placement/collision is covered by its owning construction tests.
