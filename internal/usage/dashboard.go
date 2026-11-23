package usage

import (
	"sort"
	"time"
)

type DayUsage struct {
	Day      string `json:"day"`
	Requests int    `json:"requests"`
	Tokens   int64  `json:"tokens"`
}
type ProviderUsage struct {
	Name              string `json:"name"`
	Requests          int    `json:"requests"`
	Tokens            int64  `json:"tokens"`
	EstimatedRequests int    `json:"estimated_requests"`
}

// Dashboard reads display aggregates under one ledger lock; admission stays lightweight.
func (s Store) Dashboard(now time.Time) (Snapshot, error) {
	unlock, err := s.lock()
	if err != nil {
		return Snapshot{}, err
	}
	defer unlock()
	result, err := s.snapshot(now)
	if err != nil {
		return result, err
	}
	for offset := -6; offset <= 0; offset++ {
		date := now.UTC().AddDate(0, 0, offset).Format("2006-01-02")
		day, err := s.day(date)
		if err != nil {
			return Snapshot{}, err
		}
		total := totals(day)
		result.History = append(result.History, DayUsage{Day: date, Requests: total.Requests, Tokens: total.Tokens})
		if offset != 0 {
			continue
		}
		providers := map[string]ProviderUsage{}
		for _, charge := range day.Charges {
			name := charge.Provider
			if name == "" {
				name = "Unspecified provider"
			}
			value := providers[name]
			value.Name = name
			value.Requests++
			value.Tokens += charge.Tokens
			if charge.Estimated {
				value.EstimatedRequests++
			}
			providers[name] = value
		}
		for _, provider := range providers {
			result.Providers = append(result.Providers, provider)
		}
		sort.Slice(result.Providers, func(i, j int) bool {
			a, b := result.Providers[i], result.Providers[j]
			if a.Requests != b.Requests {
				return a.Requests > b.Requests
			}
			return a.Name < b.Name
		})
	}
	return result, nil
}
