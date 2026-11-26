package modelcatalog

import (
	"errors"
	"strings"

	"github.com/gongahkia/hot-cross-buns/internal/localruntime"
	"github.com/gongahkia/hot-cross-buns/internal/model"
)

// NativeProviderAction is finite host input. APIKey is save-only transient data,
// never a display model, request journal, command argument or completion field.
type NativeProviderAction struct {
	AppOwned    bool                 `json:"app_owned,omitempty"`
	ModelID     string               `json:"model_id,omitempty"`
	OperationID string               `json:"operation_id,omitempty"`
	Generation  string               `json:"generation,omitempty"`
	RequestID   string               `json:"request_id"`
	Action      string               `json:"action"`
	Provider    string               `json:"provider,omitempty"`
	ReviewID    string               `json:"review_id,omitempty"`
	Input       *NativeProviderInput `json:"input,omitempty"`
	ReplaceKey  bool                 `json:"replace_key,omitempty"`
	APIKey      string               `json:"api_key,omitempty"`
}
type NativeProviderInput struct {
	Model        string            `json:"model"`
	EndpointMode string            `json:"endpoint_mode"`
	Endpoint     string            `json:"endpoint"`
	APIVersion   string            `json:"api_version"`
	Options      map[string]string `json:"options,omitempty"`
}
type NativeProviderRow struct {
	Models      []string          `json:"models,omitempty"`
	IsDefault   bool              `json:"is_default"`
	ID          string            `json:"id"`
	Model       string            `json:"model"`
	Stored      bool              `json:"stored"`
	Ambient     bool              `json:"ambient"`
	Expired     bool              `json:"expired"`
	Kind        string            `json:"kind"`
	Configured  bool              `json:"configured"`
	Ready       bool              `json:"ready"`
	Issue       string            `json:"issue"`
	Destination string            `json:"destination"`
	Fields      []string          `json:"fields"`
	Options     map[string]string `json:"options,omitempty"`
	APIVersion  string            `json:"api_version"`
}
type NativeProviderReview struct {
	Options          map[string]string `json:"options,omitempty"`
	ID               string            `json:"id"`
	Provider         string            `json:"provider"`
	Operation        string            `json:"operation"`
	Model            string            `json:"model"`
	Destination      string            `json:"destination"`
	EndpointMode     string            `json:"endpoint_mode"`
	CredentialAction string            `json:"credential_action"`
	SetsDefaults     bool              `json:"sets_defaults"`
}
type NativeProviderResult struct {
	Inventory       *NativeModelInventory        `json:"inventory,omitempty"`
	Runtime         *localruntime.Status         `json:"runtime,omitempty"`
	RuntimeReview   *localruntime.Review         `json:"runtime_review,omitempty"`
	FutureSelection *NativeFutureSelection       `json:"future_selection,omitempty"`
	LocalReview     *NativeLocalSelectionReview  `json:"local_review,omitempty"`
	LocalReceipt    *NativeLocalSelectionReceipt `json:"local_receipt,omitempty"`
	Local           *NativeLocalStatus           `json:"local,omitempty"`
	RequestID       string                       `json:"request_id"`
	Action          string                       `json:"action"`
	Provider        string                       `json:"provider,omitempty"`
	Rows            []NativeProviderRow          `json:"rows,omitempty"`
	Review          *NativeProviderReview        `json:"review,omitempty"`
	Confirmed       bool                         `json:"confirmed"`
	Changed         bool                         `json:"changed"`
	Conflict        bool                         `json:"conflict"`
	Error           string                       `json:"error,omitempty"`
	Notice          string                       `json:"notice,omitempty"`
}

// NativeModelInventory contains configuration metadata, never executable paths,
// credential values, native login files or private provider options.
type NativeModelInventory struct {
	Agents    []NativeAgentModel  `json:"agents"`
	Providers []NativeProviderRow `json:"providers"`
}
type NativeAgentModel struct {
	Name           string `json:"name"`
	Kind           string `json:"kind"`
	Provider       string `json:"provider,omitempty"`
	Model          string `json:"model,omitempty"`
	Inherits       bool   `json:"inherits"`
	Auth           string `json:"auth,omitempty"`
	Continuation   string `json:"continuation"`
	Steering       bool   `json:"steering"`
	Questions      bool   `json:"questions"`
	AllowEdits     bool   `json:"allow_edits"`
	MaxSteps       int    `json:"max_steps,omitempty"`
	TimeoutSeconds int    `json:"timeout_seconds,omitempty"`
}

func NativeCloudFields(provider model.Provider) []string {
	switch provider {
	case model.AzureOpenAI, model.AzureOpenAIResponses:
		return []string{"api_version"}
	case model.CloudflareWorkers:
		return []string{"account_id"}
	case model.CloudflareGateway:
		return []string{"account_id", "gateway_id", "gateway_protocol"}
	case model.Radius:
		return []string{"gateway"}
	default:
		return []string{}
	}
}

// NormalizeNativeCloudSetup reuses the terminal's canonical form validation,
// including Azure URL expansion and provider-specific field rules.
func NormalizeNativeCloudSetup(setup CloudModelSetup, version string) (CloudModelSetup, error) {
	provider, err := model.ParseProvider(setup.Provider)
	if err != nil || !model.SupportsAPIKeyLogin(provider) {
		return CloudModelSetup{}, errors.New("unsupported API-key provider")
	}
	allowed := NativeCloudFields(provider)
	for name := range setup.Options {
		found := false
		for _, field := range allowed {
			if name == field && field != "api_version" {
				found = true
			}
		}
		if !found {
			return CloudModelSetup{}, errors.New("unsupported provider option")
		}
	}
	if len(setup.Model) > 512 || strings.ContainsAny(setup.Model, "\x00\r\n") || len(setup.BaseURL) > 2048 || len(version) > 128 {
		return CloudModelSetup{}, errors.New("invalid configuration size")
	}
	form := newCloudModelSetupForm(provider, setup.Model, setup.BaseURL, setup.Options, 80)
	form.apiVersion.SetValue(version)
	return form.configuration()
}
