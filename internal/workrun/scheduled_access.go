package workrun

import (
	"github.com/gongahkia/hot-cross-buns/internal/connector"
	"slices"
)

func scheduledConnectorPermissions(registry connector.Registry, request Request) connector.PermissionSet {
	rules := append(connector.PermissionSet{}, request.ConnectorPermissions...)
	if request.ScheduledJobID == "" || request.ScheduledReads == nil {
		return rules
	}
	for _, id := range request.ConnectorIDs {
		d, found := registry.Get(id)
		if !found {
			continue
		}
		for _, op := range d.Operations() {
			if !slices.Contains(request.ScheduledReads[id], op.ID) {
				rules = append(rules, connector.PermissionRule{ConnectorID: id, Operation: op.ID, Read: connector.PermissionDeny, Write: connector.PermissionDeny})
			}
		}
	}
	return rules
}
