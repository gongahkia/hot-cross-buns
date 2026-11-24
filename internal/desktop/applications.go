package desktop

import (
	"context"
	"errors"
	"sort"
)

type applicationRuntime interface {
	Applications(context.Context) ([]Application, error)
}

// AvailableApplications is private setup metadata, never an implicit grant.
func AvailableApplications(ctx context.Context, runtime Runtime) ([]Application, error) {
	driver, ok := runtime.(applicationRuntime)
	if !ok {
		return nil, errors.New("computer access requires macOS with the native accessibility driver")
	}
	apps, err := driver.Applications(ctx)
	if err != nil {
		return nil, err
	}
	out := []Application{}
	seen := map[string]bool{}
	for _, app := range apps {
		if validateApplication(app) == nil && !seen[app.BundleID] {
			out = append(out, app)
			seen[app.BundleID] = true
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].BundleID < out[j].BundleID })
	return out, nil
}
