package modelcatalog

// NativeLocalStatus is a bounded read-only observation, not a model-use receipt.
// Nil booleans/bytes mean unknown; downloaded, loaded and selected are distinct.
type NativeLocalStatus struct {
	SelectionBlock   string             `json:"selection_block"`
	StartBlock       string             `json:"start_block"`
	DownloadBlock    string             `json:"download_block"`
	SelectionNote    string             `json:"selection_note"`
	ResultID         string             `json:"result_id"`
	ObservedAt       string             `json:"observed_at"`
	RuntimePath      string             `json:"runtime_path"`
	Discovery        string             `json:"discovery"`
	Reachable        bool               `json:"reachable"`
	Version          string             `json:"version"`
	Ownership        string             `json:"ownership"`
	Endpoint         string             `json:"endpoint"`
	Issue            string             `json:"issue"`
	InstalledKnown   bool               `json:"installed_known"`
	LoadedKnown      bool               `json:"loaded_known"`
	SelectedProvider string             `json:"selected_provider"`
	ConfiguredModel  string             `json:"configured_model"`
	SelectedModel    string             `json:"selected_model"`
	TotalMemory      uint64             `json:"total_memory"`
	AvailableMemory  *uint64            `json:"available_memory"`
	AvailableDisk    *uint64            `json:"available_disk"`
	HardwareNote     string             `json:"hardware_note"`
	Catalog          []NativeLocalModel `json:"catalog"`
	Installed        []NativeLocalModel `json:"installed"`
	Blocked          string             `json:"blocked"`
}
type NativeLocalModel struct {
	Family         string `json:"family"`
	PackageSize    string `json:"package_size"`
	Capabilities   string `json:"capabilities"`
	RequiredMemory uint64 `json:"required_memory"`
	RequiredDisk   uint64 `json:"required_disk"`
	ID             string `json:"id"`
	Name           string `json:"name"`
	Tag            string `json:"tag"`
	Digest         string `json:"digest"`
	Size           *int64 `json:"size"`
	Downloaded     *bool  `json:"downloaded"`
	Loaded         *bool  `json:"loaded"`
	Eligible       bool   `json:"eligible"`
	Reason         string `json:"reason"`
	Source         string `json:"source"`
}
