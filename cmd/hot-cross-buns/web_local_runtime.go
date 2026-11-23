package main

import (
	"context"
	"errors"
	"time"

	"github.com/gongahkia/hot-cross-buns/internal/localruntime"
	"github.com/gongahkia/hot-cross-buns/internal/modelcatalog"
)

func (b *nativeProviderBackend) localRuntimeAction(a modelcatalog.NativeProviderAction) modelcatalog.NativeProviderResult {
	result := modelcatalog.NativeProviderResult{RequestID: a.RequestID, Action: a.Action}
	if a.AppOwned || a.Provider != "" || a.APIKey != "" || a.Input != nil || a.ReplaceKey || a.OperationID != "" {
		result.Error = "Runtime controls accept only exact lifecycle review fields."
		return result
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	value, err := localruntime.Call(ctx, localruntime.Config{StateDir: b.stateDir}, localruntime.Action{RequestID: a.RequestID, Action: a.Action, ReviewID: a.ReviewID, Generation: a.Generation, ModelID: a.ModelID})
	if err != nil {
		result.Error = "The runtime operation was not confirmed. Refresh its status before reviewing again."
		return result
	}
	result.Runtime = &value.Status
	result.RuntimeReview = value.Review
	result.Confirmed = value.Confirmed
	result.Error = value.Error
	return result
}
func (b *nativeProviderBackend) ownedLocalEndpoint() (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	observed := localruntime.Existing(ctx, localruntime.Config{StateDir: b.stateDir})
	if observed.Error != "" || observed.Status.State != "running" || observed.Status.Endpoint == "" {
		return "", errors.New("start and verify the app-owned runtime first")
	}
	return observed.Status.Endpoint, nil
}
