// Package branding identifies implemented adapters using a finite local catalog.
package branding

import (
	"embed"
	"encoding/json"
)

//go:embed catalog.json
var catalogFS embed.FS

type Brand struct {
	ID          string   `json:"id"`
	Label       string   `json:"label"`
	File        string   `json:"file"`
	Providers   []string `json:"providers"`
	Connectors  []string `json:"connectors"`
	Searches    []string `json:"searches"`
	Specialists []string `json:"specialists"`
}

var catalog = func() []Brand {
	data, err := catalogFS.ReadFile("catalog.json")
	if err != nil {
		panic(err)
	}
	var brands []Brand
	if err := json.Unmarshal(data, &brands); err != nil {
		panic(err)
	}
	return brands
}()

// Valid accepts identities, never user-supplied paths, URLs or display names.
func Valid(id string) bool {
	for _, brand := range catalog {
		if brand.ID == id {
			return true
		}
	}
	return false
}
func Connector(kind string) string {
	for _, brand := range catalog {
		for _, value := range brand.Connectors {
			if value == kind {
				return brand.ID
			}
		}
	}
	return ""
}
func Specialist(role string) string {
	for _, brand := range catalog {
		for _, value := range brand.Specialists {
			if value == role {
				return brand.ID
			}
		}
	}
	return ""
}

func Search(provider string) string {
	for _, brand := range catalog {
		for _, value := range brand.Searches {
			if value == provider {
				return brand.ID
			}
		}
	}
	return ""
}

// Service matches typed connector kinds and host-selected search adapters.
func Service(kind string) string {
	if id := Connector(kind); id != "" {
		return id
	}
	return Search(kind)
}
