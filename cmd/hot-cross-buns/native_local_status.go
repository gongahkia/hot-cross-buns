package main

import (
	"context"
	"os"
	"os/exec"
	"sort"
	"strings"
	"time"

	"github.com/gongahkia/hot-cross-buns/internal/auth"
	"github.com/gongahkia/hot-cross-buns/internal/localmodel"
	"github.com/gongahkia/hot-cross-buns/internal/modelcatalog"
)

func (b *nativeProviderBackend) localStatus(a modelcatalog.NativeProviderAction) modelcatalog.NativeProviderResult {
	r := modelcatalog.NativeProviderResult{RequestID: a.RequestID, Action: a.Action}
	if a.Provider != "" || a.Input != nil || a.ReplaceKey || a.ReviewID != "" {
		r.Error = "Local inspection accepts no mutation or provider fields."
		return r
	}
	settings, err := b.settings.Load()
	if err != nil {
		r.Error = "Model settings could not be read."
		return r
	}
	credentials, err := auth.New(b.stateDir)
	if err != nil {
		r.Error = "Private metadata unavailable."
		return r
	}
	redact, err := providerRedactor(credentials)
	if err != nil {
		r.Error = "Private metadata unavailable."
		return r
	}
	safe := func(s string) string { return safeProviderText(redact(s), nil) }
	host := inspectLocalModelHost()
	status := &modelcatalog.NativeLocalStatus{ResultID: providerNonce(), ObservedAt: time.Now().UTC().Format(time.RFC3339Nano), Ownership: "Unknown · discovery does not establish process ownership", Discovery: "PATH, /opt/homebrew/bin/ollama, /usr/local/bin/ollama, /Applications/Ollama.app/Contents/Resources/ollama", SelectedProvider: safe(settings.Defaults.Provider), SelectedModel: safe(settings.Defaults.Model), TotalMemory: host.TotalMemoryBytes, Catalog: []modelcatalog.NativeLocalModel{}, Installed: []modelcatalog.NativeLocalModel{}, Blocked: "Runtime Start and Download remain blocked by unverified ownership/use leases. Delete, update, unload and runtime stop remain unavailable. Reviewed future selection is independent of those mutations."}
	if local, found := configuredCustomProvider(settings, localmodel.ProviderID); found {
		status.ConfiguredModel = safe(local.DefaultModel)
	}
	status.StartBlock = nativeLocalStartBlock
	status.DownloadBlock = nativeLocalDownloadBlock
	status.SelectionNote = "Installed curated models with a verified digest can be reviewed for future selection. This does not load weights or live-test inference."
	if receipt, e := localmodel.NewSelectionReceipts(b.stateDir).Read(); e != nil {
		status.Issue = "Private selection receipt unavailable; inspect storage before changing local selection."
		status.SelectionBlock = "Private selection receipts are unavailable. Repair receipt storage before selecting."
	} else if receipt != nil && !b.localReceiptSafe(*receipt) {
		status.SelectionBlock = "Private selection metadata belongs to a different or unavailable profile. Inspect profile configuration before selecting."
	} else if receipt != nil && b.localReceiptSafe(*receipt) {
		r.LocalReceipt = receipt
		if receipt.Phase == "prepared" || receipt.Phase == "uncertain" {
			status.SelectionBlock = "Reconcile the previous selection before a new review."
		}
	}
	r.Local = status
	if path, e := exec.LookPath("ollama"); e == nil {
		status.RuntimePath = safe(path)
	} else {
		for _, path := range []string{"/opt/homebrew/bin/ollama", "/usr/local/bin/ollama", "/Applications/Ollama.app/Contents/Resources/ollama"} {
			if info, e := os.Stat(path); e == nil && !info.IsDir() && info.Mode()&0111 != 0 {
				status.RuntimePath = path
				break
			}
		}
	}
	if host.AvailableMemoryKnown {
		status.AvailableMemory = &host.AvailableMemoryBytes
	}
	if host.AvailableDiskKnown {
		status.AvailableDisk = &host.AvailableDiskBytes
	}
	status.HardwareNote = "2× published download size is a conservative eligibility guard, not measured inference admission. Memory pressure, GPU residency and live model quality are not established; unavailable resource measurements are shown as unknown."
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()
	var installed, running []localmodel.InstalledModel
	client, err := localClient("", settings)
	if err != nil {
		status.Issue = "Configured local endpoint is invalid. No request was made."
	} else {
		status.Endpoint = safe(client.BaseURL())
		version, e := client.Version(ctx)
		if e != nil {
			status.Issue = "Runtime reachability unknown: the local version request failed. No runtime was started."
		} else {
			status.Reachable = true
			status.Version = safe(version)
			installed, e = client.Models(ctx)
			status.InstalledKnown = e == nil
			if e != nil {
				status.Issue = "Installed inventory unavailable; downloaded state is unknown."
			}
			running, e = client.Running(ctx)
			status.LoadedKnown = e == nil
			if e != nil {
				status.Issue += " Loaded inventory unavailable; loaded state is unknown."
			}
		}
	}
	// A changed endpoint/default invalidates this observation rather than relabeling newer settings.
	current, e := b.settings.Load()
	if e != nil {
		r.Local = nil
		r.Error = "Settings could not be rechecked. Refresh explicitly."
		return r
	}
	old, of := configuredCustomProvider(settings, localmodel.ProviderID)
	now, nf := configuredCustomProvider(current, localmodel.ProviderID)
	if current.Defaults != settings.Defaults || of != nf || old.BaseURL != now.BaseURL || old.DefaultModel != now.DefaultModel {
		r.Local = nil
		r.Conflict = true
		r.Error = "Model selection changed during inspection. Refresh explicitly."
		return r
	}
	known := func(list []localmodel.InstalledModel, tag string) bool {
		for _, m := range list {
			if m.Name == tag {
				return true
			}
		}
		return false
	}
	boolptr := func(v bool) *bool { return &v }
	for _, m := range localmodel.Catalog() {
		eligibility := localmodel.Assess(m, host)
		row := modelcatalog.NativeLocalModel{ID: m.ID, Name: m.Name, Tag: m.OllamaModel, Eligible: eligibility.Allowed, Reason: safe(eligibility.Reason), Source: m.SourceURL, Family: strings.Split(m.OllamaModel, ":")[0], PackageSize: m.Download, Capabilities: m.Summary, RequiredMemory: eligibility.RequiredMemoryBytes, RequiredDisk: eligibility.RequiredDiskBytes}
		for _, item := range installed {
			if item.Name == m.OllamaModel {
				row.Digest = safe(item.Digest)
			}
		}
		if status.InstalledKnown {
			row.Downloaded = boolptr(known(installed, m.OllamaModel))
		}
		if status.LoadedKnown {
			row.Loaded = boolptr(known(running, m.OllamaModel))
		}
		status.Catalog = append(status.Catalog, row)
	}
	for _, m := range installed {
		row := modelcatalog.NativeLocalModel{ID: safe(m.Name), Name: safe(m.Name), Tag: safe(m.Name), Digest: safe(m.Digest), Size: nil, Downloaded: boolptr(true)}
		if m.SizeKnown {
			row.Size = &m.Size
		}
		if status.LoadedKnown {
			row.Loaded = boolptr(known(running, m.Name))
		}
		status.Installed = append(status.Installed, row)
	}
	sort.SliceStable(status.Catalog, func(i, j int) bool { return status.Catalog[i].Eligible && !status.Catalog[j].Eligible })
	return r
}
