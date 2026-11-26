package main

import (
	"context"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/gongahkia/hot-cross-buns/internal/agent"
	"github.com/gongahkia/hot-cross-buns/internal/auth"
	"github.com/gongahkia/hot-cross-buns/internal/codeexec"
	"github.com/gongahkia/hot-cross-buns/internal/config"
	"github.com/gongahkia/hot-cross-buns/internal/extension"
	"github.com/gongahkia/hot-cross-buns/internal/hooks"
	"github.com/gongahkia/hot-cross-buns/internal/localmodel"
	"github.com/gongahkia/hot-cross-buns/internal/lsp"
	"github.com/gongahkia/hot-cross-buns/internal/mcp"
	"github.com/gongahkia/hot-cross-buns/internal/model"
	"github.com/gongahkia/hot-cross-buns/internal/model/chatcompletions"
	"github.com/gongahkia/hot-cross-buns/internal/sandbox"
	"github.com/gongahkia/hot-cross-buns/internal/state"
	"github.com/gongahkia/hot-cross-buns/internal/tools"
	sharedusage "github.com/gongahkia/hot-cross-buns/internal/usage"
	"github.com/gongahkia/hot-cross-buns/internal/websearch"
)

func providerFromEnvironment() (model.Provider, error) {
	provider, err := providerNameFromEnvironment()
	if err != nil {
		return "", err
	}
	parsed, err := model.ParseProvider(provider)
	if err != nil {
		return "", fmt.Errorf("HOT_CROSS_BUNS_PROVIDER: %w", err)
	}
	return parsed, nil
}

func providerNameFromEnvironment() (string, error) {
	defaults, err := configuredDefaults()
	if err != nil {
		return "", err
	}
	provider := defaults.Provider
	if configured := os.Getenv("HOT_CROSS_BUNS_PROVIDER"); configured != "" {
		provider = configured
	}
	if _, _, err := resolveConfiguredProvider(provider, ""); err != nil {
		return "", fmt.Errorf("HOT_CROSS_BUNS_PROVIDER: %w", err)
	}
	return provider, nil
}

func modelFromEnvironment(provider model.Provider) string {
	if model := os.Getenv("HOT_CROSS_BUNS_MODEL"); model != "" {
		return model
	}
	if defaults, err := configuredDefaults(); err == nil && defaults.Model != "" {
		return defaults.Model
	}
	return model.DefaultModel(provider)
}

func modelFromProviderName(provider string) string {
	if modelName := os.Getenv("HOT_CROSS_BUNS_MODEL"); modelName != "" {
		return modelName
	}
	if _, modelName, err := resolveConfiguredProvider(provider, ""); err == nil {
		return modelName
	}
	return ""
}

// nativeExecutorConfiguration is shared provider/model construction for the
// Work-owned model and Code specialist. It is configuration, not execution.
type nativeExecutorConfiguration struct {
	Model          agent.Model
	Extensions     extension.Resolver
	HookTrusts     []hooks.Trust
	LSPTrusts      []lsp.Trust
	MCPTrusts      []mcp.Trust
	MCPCredentials auth.Store
	HTTP           tools.HTTPFetchOptions
	Sandbox        sandbox.Policy
}

func newCodeExecutor(providerName, modelName, baseURL string) (codeexec.Executor, error) {
	configuration, err := newNativeExecutorConfiguration(providerName, modelName, baseURL)
	if err != nil {
		return codeexec.Executor{}, err
	}
	return configuration.codeExecutor(), nil
}

func newNativeExecutorConfiguration(providerName, modelName, baseURL string) (nativeExecutorConfiguration, error) {
	settings, err := loadSettings()
	if err != nil {
		return nativeExecutorConfiguration{}, err
	}
	custom, found := configuredCustomProvider(settings, providerName)
	if found {
		return newCustomExecutorConfiguration(settings, custom, modelName, baseURL)
	}
	if strings.TrimSpace(baseURL) == "" {
		baseURL = settings.ProviderEndpoint(providerName)
	}
	provider, err := model.ParseProvider(providerName)
	if err != nil {
		return nativeExecutorConfiguration{}, err
	}
	modelName = model.EffectiveModel(provider, modelName)
	credentials, err := hotCrossBunsCredentials()
	if err != nil {
		return nativeExecutorConfiguration{}, err
	}
	backend, err := model.New(model.Config{
		Provider:        provider,
		Model:           modelName,
		BaseURL:         baseURL,
		Credentials:     &credentials,
		ProviderOptions: settings.OptionsForProvider(providerName),
	})
	if err != nil {
		return nativeExecutorConfiguration{}, err
	}
	return executorConfigurationWithExtensions(backend.Model, settings, providerName+"/"+modelName)
}

func newCustomExecutorConfiguration(settings config.Settings, provider config.CustomProvider, modelName, baseURL string) (nativeExecutorConfiguration, error) {
	if strings.TrimSpace(modelName) == "" {
		modelName = provider.DefaultModel
	}
	if !customProviderSupportsModel(provider, modelName) {
		return nativeExecutorConfiguration{}, fmt.Errorf("model %q is not configured for custom provider %q", modelName, provider.ID)
	}
	if strings.TrimSpace(baseURL) == "" {
		baseURL = provider.BaseURL
	}
	if provider.ID == localmodel.ProviderID {
		if _, err := localmodel.NewClientFromChatCompletionsURL(baseURL); err != nil {
			return nativeExecutorConfiguration{}, fmt.Errorf("managed local provider endpoint: %w", err)
		}
		reviewed, found := localmodel.Resolve(modelName)
		if !found {
			return nativeExecutorConfiguration{}, fmt.Errorf("managed local provider model %q is not in Hot Cross Buns's reviewed catalog", modelName)
		}
		if err := requireLocalModelEligibility(reviewed); err != nil {
			return nativeExecutorConfiguration{}, err
		}
	}
	apiKey := ""
	if provider.APIKeyEnv != "" {
		apiKey = os.Getenv(provider.APIKeyEnv)
	}
	source := "none"
	if provider.APIKeyEnv != "" {
		source = "environment"
	}
	backend := chatcompletions.Model{Config: chatcompletions.Config{
		ProviderID:       provider.ID,
		CredentialSource: source,
		APIKey:           apiKey,
		APIKeyEnv:        provider.APIKeyEnv,
		AllowEmptyAPIKey: provider.APIKeyEnv == "",
		BaseURL:          baseURL,
		Model:            modelName,
		ProviderName:     "custom provider " + provider.ID,
	}}
	if provider.ID == localmodel.ProviderID {
		if provider.APIKeyEnv != "" {
			return nativeExecutorConfiguration{}, fmt.Errorf("managed local provider cannot use a credential environment variable")
		}
		endpoint, err := localmodel.LocalURL(baseURL)
		if err != nil {
			return nativeExecutorConfiguration{}, err
		}
		backend.Config.BaseURL = endpoint.String()
		backend.Config.Client, err = localmodel.HTTPClient(endpoint.String())
		if err != nil {
			return nativeExecutorConfiguration{}, err
		}
		if provider.ModelDigests[modelName] == "" {
			root, err := state.ResolveDir("")
			if err != nil {
				return nativeExecutorConfiguration{}, err
			}
			receipt, err := localmodel.NewSelectionReceipts(root).Read()
			if err != nil {
				return nativeExecutorConfiguration{}, fmt.Errorf("local selection receipt is unavailable; inspect and repair explicitly")
			}
			if receipt != nil && receipt.Tag == modelName && receipt.Endpoint == strings.TrimSuffix(endpoint.String(), "/v1/chat/completions") {
				return nativeExecutorConfiguration{}, fmt.Errorf("native local digest binding is missing; review and select this model again")
			}
		}
		var localBackend agent.Model = localmodel.TextOnlyModel{Backend: backend}
		if digest := provider.ModelDigests[modelName]; digest != "" {
			client, err := localmodel.NewClientFromChatCompletionsURL(endpoint.String())
			if err != nil {
				return nativeExecutorConfiguration{}, err
			}
			localBackend = localmodel.DigestCheckedModel{Backend: localBackend, Client: client, Tag: modelName, Digest: digest}
		}
		return executorConfigurationWithExtensions(localBackend, settings, provider.ID+"/"+modelName)
	}
	return executorConfigurationWithExtensions(backend, settings, provider.ID+"/"+modelName)
}

func executorConfigurationWithExtensions(backend agent.Model, settings config.Settings, labels ...string) (nativeExecutorConfiguration, error) {
	extensions, err := extension.DefaultResolver(settings)
	if err != nil {
		return nativeExecutorConfiguration{}, err
	}
	credentials, err := hotCrossBunsCredentials()
	if err != nil {
		return nativeExecutorConfiguration{}, err
	}
	stateDir, err := state.ResolveDir("")
	if err != nil {
		return nativeExecutorConfiguration{}, err
	}
	label := "configured model"
	if len(labels) > 0 {
		label = labels[0]
	}
	parts := strings.SplitN(label, "/", 2)
	if len(parts) == 2 {
		profile := model.ContextPolicy(parts[0], parts[1])
		if configured := settings.ContextWindows[config.ModelAliasKey(parts[0], parts[1])]; configured > 0 {
			if profile.Source == "unknown deployment fallback" || profile.Source == "unallocated local runtime fallback" {
				profile.Window = configured
			} else {
				profile.Window = min(profile.Window, configured)
			}
			profile.OutputReserve = min(profile.OutputReserve, profile.Window/8)
			profile.Source = "configured model context window"
		}
		if parts[0] == localmodel.ProviderID {
			if provider, found := configuredCustomProvider(settings, parts[0]); found {
				client, clientErr := localmodel.NewClientFromChatCompletionsURL(provider.BaseURL)
				if clientErr != nil {
					return nativeExecutorConfiguration{}, clientErr
				}
				ctx, cancel := context.WithTimeout(context.Background(), 500*time.Millisecond)
				loaded, err := client.Running(ctx)
				cancel()
				if err == nil {
					for _, entry := range loaded {
						if entry.Name == parts[1] && entry.ContextLength >= 1024 {
							if settings.ContextWindows[config.ModelAliasKey(parts[0], parts[1])] > 0 {
								profile.Window = min(profile.Window, entry.ContextLength)
							} else {
								profile.Window = entry.ContextLength
							}
							profile.OutputReserve = min(8192, profile.Window/8)
							profile.Source = "Ollama allocated context"
						}
					}
				}
			}
		}
		backend = agent.WithContextPolicy(backend, profile)
	}
	backend = sharedusage.Model(backend, stateDir, label)
	return nativeExecutorConfiguration{
		Model:          backend,
		Extensions:     extensions,
		HookTrusts:     settings.HookTrusts,
		LSPTrusts:      settings.LSPTrusts,
		MCPTrusts:      settings.MCPTrusts,
		MCPCredentials: credentials,
		HTTP:           configuredWebSearch(settings, credentials, stateDir),
		Sandbox:        settings.Execution,
	}, nil
}

func webResearchOptionsFromEnvironment() tools.HTTPFetchOptions {
	return websearch.Environment(os.Getenv)
}

func configuredWebSearch(settings config.Settings, credentials auth.Store, stateDir string) tools.HTTPFetchOptions {
	resolved := websearch.Resolve(settings.Search, credentials, os.Getenv)
	options := resolved.Options
	options.BeginSearch = websearch.Meter(stateDir)
	return options
}

func (configuration nativeExecutorConfiguration) codeExecutor() codeexec.Executor {
	return codeexec.Executor{
		Model: configuration.Model, Extensions: configuration.Extensions,
		HookTrusts: configuration.HookTrusts, LSPTrusts: configuration.LSPTrusts, MCPTrusts: configuration.MCPTrusts,
		MCPCredentials: configuration.MCPCredentials, HTTP: configuration.HTTP, Sandbox: configuration.Sandbox,
	}
}

// resolveConfiguredProvider uses the persisted custom-model catalog first,
// then Hot Cross Buns's built-in direct adapters. It returns the default model whenever
// callers did not specify one.
func resolveConfiguredProvider(providerName, requestedModel string) (string, string, error) {
	settings, err := loadSettings()
	if err != nil {
		return "", "", err
	}
	if custom, found := configuredCustomProvider(settings, providerName); found {
		modelName := strings.TrimSpace(requestedModel)
		if modelName == "" {
			modelName = custom.DefaultModel
		}
		if !customProviderSupportsModel(custom, modelName) {
			return "", "", fmt.Errorf("model %q is not configured for custom provider %q", modelName, custom.ID)
		}
		return custom.ID, modelName, nil
	}
	provider, err := model.ParseProvider(providerName)
	if err != nil {
		return "", "", err
	}
	return string(provider), model.EffectiveModel(provider, requestedModel), nil
}

func loadSettings() (config.Settings, error) {
	store, err := config.DefaultStore()
	if err != nil {
		return config.Settings{}, err
	}
	return store.Load()
}

func configuredCustomProvider(settings config.Settings, providerName string) (config.CustomProvider, bool) {
	for _, provider := range settings.CustomProviders {
		if strings.EqualFold(provider.ID, strings.TrimSpace(providerName)) {
			return provider, true
		}
	}
	return config.CustomProvider{}, false
}

func customProviderSupportsModel(provider config.CustomProvider, modelName string) bool {
	for _, configured := range provider.Models {
		if configured == modelName {
			return true
		}
	}
	return false
}

func hotCrossBunsCredentials() (auth.Store, error) {
	stateDir, err := state.ResolveDir(os.Getenv("HOT_CROSS_BUNS_STATE_DIR"))
	if err != nil {
		return auth.Store{}, err
	}
	return auth.New(stateDir)
}

func displayModel(value string) string {
	if strings.TrimSpace(value) == "" {
		return "provider default"
	}
	return value
}
