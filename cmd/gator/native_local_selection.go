package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"time"

	"github.com/gongahkia/gator/internal/auth"
	"github.com/gongahkia/gator/internal/config"
	"github.com/gongahkia/gator/internal/localmodel"
	"github.com/gongahkia/gator/internal/modelcatalog"
)

const nativeLocalStartBlock = "Start is unavailable: verified binary/listener process identity and cross-process runtime lifetime ownership are not implemented. Start Ollama yourself, then Refresh Status."
const nativeLocalDownloadBlock = "Download is unavailable: model-use protection does not yet cover cooperating requests, retained review and recovery. Use an explicit external Ollama workflow; Gator will not pull or replace a tag."

type nativeLocalSelectionExpectation struct {
	Public   modelcatalog.NativeLocalSelectionReview
	Expected localSelectionExpectation
	Expires  time.Time
}

func localSettingsRevision(s config.Settings) string {
	provider, found := configuredCustomProvider(s, localmodel.ProviderID)
	data, _ := json.Marshal(struct {
		Defaults config.Defaults
		Provider config.CustomProvider
		Found    bool
	}{s.Defaults, provider, found})
	hash := sha256.Sum256(data)
	return hex.EncodeToString(hash[:])
}
func (b *nativeProviderBackend) futureLocalSelection() *modelcatalog.NativeFutureSelection {
	settings, err := b.settings.Load()
	if err != nil {
		return nil
	}
	credentials, err := auth.New(b.stateDir)
	if err != nil {
		return nil
	}
	redact, err := providerRedactor(credentials)
	if err != nil {
		return nil
	}
	return &modelcatalog.NativeFutureSelection{Provider: safeProviderText(redact(settings.Defaults.Provider), nil), Model: safeProviderText(redact(settings.Defaults.Model), nil)}
}
func (b *nativeProviderBackend) localMetadataSafe(values ...string) bool {
	credentials, err := auth.New(b.stateDir)
	if err != nil {
		return false
	}
	redact, err := providerRedactor(credentials)
	if err != nil {
		return false
	}
	for _, value := range values {
		if safeProviderText(redact(value), nil) != value {
			return false
		}
	}
	return true
}
func (b *nativeProviderBackend) selectionReceiptWrite(lease *localmodel.SelectionReceiptLease, r localmodel.SelectionReceipt) error {
	if b.writeLocalReceipt != nil {
		return b.writeLocalReceipt(lease, r)
	}
	return lease.Write(r)
}
func (b *nativeProviderBackend) localSelectionAction(a modelcatalog.NativeProviderAction) modelcatalog.NativeProviderResult {
	result := modelcatalog.NativeProviderResult{RequestID: a.RequestID, Action: a.Action}
	fail := func(text string) modelcatalog.NativeProviderResult { result.Error = text; return result }
	if a.Provider != "" || a.Input != nil || a.ReplaceKey {
		return fail("Local selection accepts no credential or provider form fields.")
	}
	switch a.Action {
	case "local_start":
		return fail(nativeLocalStartBlock)
	case "local_download":
		return fail(nativeLocalDownloadBlock)
	case "local_cancel_review":
		if b.localReview != nil && (a.ReviewID != b.localReview.Public.ID || a.Generation != b.localReview.Public.Generation) {
			return fail("The local review changed; refresh before choosing again.")
		}
		b.localReview = nil
		result.Notice = "Local selection cancelled. Settings were not changed."
		return result
	case "local_review_select":
		b.localReview = nil
		prior, e := localmodel.NewSelectionReceipts(b.stateDir).Read()
		if e != nil {
			return fail("Private selection receipts are unavailable.")
		}
		if prior != nil && !b.localReceiptSafe(*prior) {
			return fail("The private receipt belongs to different or unavailable profile metadata.")
		}
		if prior != nil && (prior.Phase == "prepared" || prior.Phase == "uncertain") {
			if b.localReceiptSafe(*prior) {
				result.LocalReceipt = prior
			}
			return fail("Reconcile the previous selection before reviewing again.")
		}
		if a.ReviewID != "" || a.Generation != "" || a.OperationID != "" {
			return fail("A new review cannot reuse an operation identity.")
		}
		m, found := localmodel.Resolve(a.ModelID)
		if !found || m.ID != a.ModelID {
			return fail("Choose an exact reviewed catalog entry.")
		}
		host := inspectLocalModelHost()
		if e := localmodel.Assess(m, host); !e.Allowed {
			return fail("This model fails the current conservative hardware check. Refresh Status for details.")
		}
		settings, err := b.settings.Load()
		if err != nil {
			return fail("Settings could not be read.")
		}
		client, err := localClient("", settings)
		if err != nil || !b.localMetadataSafe(client.BaseURL()) {
			return fail("The reviewed local endpoint is unavailable or invalid.")
		}
		if local, ok := configuredCustomProvider(settings, localmodel.ProviderID); ok && local.APIKeyEnv != "" {
			return fail("Managed local inference cannot use an API-key environment configuration.")
		}
		ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
		defer cancel()
		if _, err := client.Version(ctx); err != nil {
			return fail("The local runtime did not confirm readiness. No selection was changed.")
		}
		inventory, err := client.Models(ctx)
		if err != nil {
			return fail("Installed inventory could not be verified.")
		}
		digest := ""
		for _, item := range inventory {
			if item.Name == m.OllamaModel {
				digest, err = localmodel.ModelDigest(item.Digest)
				break
			}
		}
		if err != nil || digest == "" || !b.localMetadataSafe(digest) {
			return fail("An installed SHA-256 model identity is required. Nothing was downloaded or selected.")
		}
		fresh, err := b.settings.Load()
		if err != nil || !sameLocalSelectionSettings(settings, fresh) {
			result.Conflict = true
			return fail("Model configuration changed during inspection. Review again.")
		}
		if b.localGeneration == "" {
			b.localGeneration = providerNonce()
		}
		review := modelcatalog.NativeLocalSelectionReview{ID: providerNonce(), Generation: b.localGeneration, ModelID: m.ID, Tag: m.OllamaModel, Digest: digest, Endpoint: client.BaseURL(), SettingsRevision: localSettingsRevision(settings), Notice: "Select for future work only. Existing requests keep their captured model. No weights are loaded, downloaded or live-tested. Ollama uses a mutable tag; a pre-request digest check is not an atomic server-side pin."}
		if review.ID == "" || review.Generation == "" {
			return fail("A secure local review identity could not be created.")
		}
		b.localReview = &nativeLocalSelectionExpectation{Public: review, Expected: localSelectionExpectation{Settings: settings, Endpoint: client.BaseURL(), Tag: m.OllamaModel, Digest: digest}, Expires: time.Now().Add(5 * time.Minute)}
		result.LocalReview = &review
		return result
	case "local_select":
		review := b.localReview
		if review == nil || a.ReviewID != review.Public.ID || a.Generation != review.Public.Generation || a.ModelID != review.Public.ModelID || a.OperationID != "" || time.Now().After(review.Expires) {
			return fail("The local review expired or changed. Review again; no selection was replayed.")
		}
		b.localReview = nil
		receipts := localmodel.NewSelectionReceipts(b.stateDir)
		lease, err := receipts.Lock()
		if err != nil {
			return fail("Another local selection owns the operation lock, or private receipts are unavailable.")
		}
		defer lease.Close()
		previous, err := lease.Read()
		if err != nil {
			return fail("The previous selection receipt is unreadable. Resolve private receipt storage before selecting.")
		}
		if previous != nil && !b.localReceiptSafe(*previous) {
			return fail("Private receipt metadata is unavailable.")
		}
		if previous != nil && (previous.RequestID == a.RequestID || previous.Phase == "prepared" || previous.Phase == "uncertain") {
			result.LocalReceipt = previous
			return fail("Reconcile the previous selection before a fresh explicit review. No retry was sent.")
		}
		stamp := time.Now().UTC().Format(time.RFC3339Nano)
		profile := sha256.Sum256([]byte(b.settings.Path()))
		receipt := localmodel.SelectionReceipt{Version: 1, ID: providerNonce(), RequestID: a.RequestID, ProfileID: hex.EncodeToString(profile[:]), Generation: review.Public.Generation, Endpoint: review.Public.Endpoint, ModelID: review.Public.ModelID, Tag: review.Public.Tag, Digest: review.Public.Digest, SettingsRevision: review.Public.SettingsRevision, Phase: "prepared", CreatedAt: stamp, UpdatedAt: stamp}
		if err := b.selectionReceiptWrite(lease, receipt); err != nil {
			return fail("A durable selection intent could not be recorded. Settings were not changed.")
		}
		ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
		defer cancel()
		manager := newLocalModelManager(b.settings)
		update, selectionErr := manager.use(ctx, review.Public.ModelID, &review.Expected)
		receipt.UpdatedAt = time.Now().UTC().Format(time.RFC3339Nano)
		if !update.Published {
			receipt.Phase = "failed"
			if err := b.selectionReceiptWrite(lease, receipt); err != nil {
				receipt.Phase = "uncertain"
			}
			result.LocalReceipt = &receipt
			result.Conflict = errors.Is(selectionErr, errProviderReviewChanged)
			return fail("Selection was not confirmed. Inspect current settings and inventory; review explicitly before retrying.")
		}
		result.Confirmed = true
		result.Changed = true
		receipt.Phase = "published"
		if err := b.selectionReceiptWrite(lease, receipt); err != nil {
			receipt.Phase = "uncertain"
			result.LocalReceipt = &receipt
			return fail("Future settings were published, but receipt finalization is unconfirmed. Reconcile before another local selection.")
		}
		result.LocalReceipt = &receipt
		result.Notice = "Go published this future model selection. No inference or download was run. Refresh Status to observe current runtime state."
		return result
	case "local_reconcile":
		lease, err := localmodel.NewSelectionReceipts(b.stateDir).Lock()
		if err != nil {
			return fail("Selection reconciliation could not acquire private operation ownership.")
		}
		defer lease.Close()
		receipt, err := lease.Read()
		if err != nil {
			return fail("Selection receipt could not be read safely.")
		}
		if receipt == nil {
			return fail("No selection receipt is available.")
		}
		if !b.localReceiptSafe(*receipt) {
			return fail("Private receipt metadata is unavailable.")
		}
		if receipt.ID != a.OperationID {
			return fail("Selection receipt identity changed. Refresh explicitly.")
		}
		settings, err := b.settings.Load()
		if err != nil {
			return fail("Current settings could not be inspected.")
		}
		client, err := localClient("", settings)
		if err != nil || client.BaseURL() != receipt.Endpoint {
			return fail("Current runtime endpoint differs from the receipt. Inspect configuration; no retry was sent.")
		}
		ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
		defer cancel()
		inventory, err := client.Models(ctx)
		if err != nil {
			return fail("Inventory is unavailable; the prior selection outcome remains unconfirmed.")
		}
		installed := false
		for _, item := range inventory {
			digest, e := localmodel.ModelDigest(item.Digest)
			if e == nil && item.Name == receipt.Tag && digest == receipt.Digest {
				installed = true
			}
		}
		local, _ := configuredCustomProvider(settings, localmodel.ProviderID)
		selected := settings.Defaults.Provider == localmodel.ProviderID && settings.Defaults.Model == receipt.Tag && local.ModelDigests[receipt.Tag] == receipt.Digest
		receipt.Phase = "reconciled"
		receipt.UpdatedAt = time.Now().UTC().Format(time.RFC3339Nano)
		if err := b.selectionReceiptWrite(lease, *receipt); err != nil {
			return fail("Reconciliation observation could not be retained. Nothing was replayed.")
		}
		result.LocalReceipt = receipt
		switch {
		case selected && installed:
			result.Notice = "Current settings select the reviewed installed digest. Historical publication causality is not inferred."
		case selected:
			result.Notice = "The configured future selection is missing or changed in inventory. Review repair explicitly; no download or fallback was attempted."
		default:
			result.Notice = "Current settings do not select this receipt's model. No publication, retry or rollback was performed."
		}
		return result
	default:
		return fail("Unsupported local operation.")
	}
}

func (b *nativeProviderBackend) localReceiptSafe(r localmodel.SelectionReceipt) bool {
	if r.ProfileID != b.localProfileID() {
		return false
	}
	return b.localMetadataSafe(r.ID, r.RequestID, r.Generation, r.ProfileID, r.Endpoint, r.Tag, r.Digest, r.SettingsRevision)
}

func (b *nativeProviderBackend) localProfileID() string {
	profile := sha256.Sum256([]byte(b.settings.Path()))
	return hex.EncodeToString(profile[:])
}
