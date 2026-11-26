package connector

import (
	"encoding/json"
	"errors"
	"net/http"
	"regexp"
	"strconv"
	"strings"

	"github.com/gongahkia/hot-cross-buns/internal/action"
)

var notionID = regexp.MustCompile(`\A(?:[0-9a-fA-F]{32}|[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})\z`)

func notionExtraOperations() []Operation {
	ops := serviceOperations([]serviceOperation{
		{"block_get", "Read one Notion block before editing its content.", action.ConnectedRead},
		{"database_get", "Read a database's metadata to discover its data source IDs. Search finds shared pages/data sources, not every row.", action.ConnectedRead},
		{"data_source_get", "Read one data source's property schema before querying or creating entries.", action.ConnectedRead},
		{"data_source_query", "Read entries in a data source, with optional payload filter and sorts. Follow cursor pagination; read nested blocks separately.", action.ConnectedRead},
		{"block_append", "Append 1–100 child blocks to a page/block after exact approval. Payload resource_id, children and optional position (start/end/after_block). Read existing content first; never retry an uncertain append automatically.", action.ConnectedMutate},
		{"block_update", "Update one existing block's content or archive state after exact approval. Payload resource_id plus Notion block fields. Read block_get first; changing page properties uses page_update.", action.ConnectedMutate},
	})
	for i := range ops {
		if action.RequiresFreshApproval(ops[i].Capability) {
			continue
		}
		ops[i].InputSchema = json.RawMessage(`{"type":"object","additionalProperties":false,"required":["resource_id"],"properties":{"resource_id":{"type":"string","description":"Exact Notion UUID (32 hex digits or UUID with hyphens)"},"cursor":{"type":"string"},"limit":{"type":"integer","minimum":1,"maximum":100},"payload":{"type":"object","description":"data_source_query only: filter object and sorts array; cursor and limit are supplied outside payload","additionalProperties":false,"properties":{"filter":{"type":"object"},"sorts":{"type":"array","items":{"type":"object"}}}}}}`)
	}
	return ops
}
func notionExtraRead(d Descriptor, op string, in serviceInput) (string, string, []byte, error) {
	if !notionID.MatchString(in.ResourceID) {
		return "", "", nil, errors.New("choose an exact Notion page/block/database/data-source UUID")
	}
	path := ""
	method := http.MethodGet
	var body []byte
	switch op {
	case "block_get":
		path = "/blocks/" + in.ResourceID
	case "database_get":
		path = "/databases/" + in.ResourceID
	case "data_source_get":
		path = "/data_sources/" + in.ResourceID
	case "data_source_query":
		path = "/data_sources/" + in.ResourceID + "/query"
		method = http.MethodPost
		parameters := map[string]json.RawMessage{}
		if len(in.Payload) > 0 {
			if err := json.Unmarshal(in.Payload, &parameters); err != nil {
				return "", "", nil, err
			}
		}
		for key, value := range parameters {
			switch key {
			case "filter":
				var v map[string]json.RawMessage
				if json.Unmarshal(value, &v) != nil || v == nil {
					return "", "", nil, errors.New("Notion filter must be an object")
				}
			case "sorts":
				var v []map[string]json.RawMessage
				if json.Unmarshal(value, &v) != nil || v == nil || len(v) > 100 {
					return "", "", nil, errors.New("Notion sorts must be an array of at most 100 objects")
				}
			default:
				return "", "", nil, errors.New("Notion query payload supports only filter and sorts")
			}
		}
		limit := in.Limit
		if limit == 0 {
			limit = 100
		}
		parameters["page_size"] = json.RawMessage(strconv.Itoa(limit))
		if in.Cursor != "" {
			parameters["start_cursor"], _ = json.Marshal(in.Cursor)
		}
		body, _ = json.Marshal(parameters)
	default:
		return "", "", nil, errors.New("unsupported Notion read")
	}
	if op != "data_source_query" && (len(in.Payload) > 0 || in.Cursor != "" || in.Limit != 0) {
		return "", "", nil, errors.New("single Notion resource reads do not accept query parameters")
	}
	return strings.TrimRight(d.Resource, "/") + path, method, body, nil
}
func notionBlockAction(d Descriptor, op string, raw []byte) (string, []byte, error) {
	id, payload, err := extractResourceID(raw)
	if err != nil {
		return "", nil, err
	}
	if !notionID.MatchString(id) {
		return "", nil, errors.New("choose an exact Notion page/block UUID")
	}
	var body map[string]json.RawMessage
	if err := json.Unmarshal(payload, &body); err != nil {
		return "", nil, err
	}
	if len(body) == 0 {
		return "", nil, errors.New("choose block fields to change")
	}
	path := "/blocks/" + id
	if op == "block_append" {
		for key := range body {
			if key != "children" && key != "position" {
				return "", nil, errors.New("append supports children and optional position only")
			}
		}
		var children []map[string]json.RawMessage
		if json.Unmarshal(body["children"], &children) != nil || len(children) < 1 || len(children) > 100 {
			return "", nil, errors.New("append requires 1–100 child blocks")
		}
		for _, child := range children {
			if len(child) == 0 {
				return "", nil, errors.New("child blocks must be nonempty objects")
			}
		}
		if rawPosition, ok := body["position"]; ok {
			var position struct {
				Type  string `json:"type"`
				After *struct {
					ID string `json:"id"`
				} `json:"after_block,omitempty"`
			}
			decoder := json.NewDecoder(strings.NewReader(string(rawPosition)))
			decoder.DisallowUnknownFields()
			if decoder.Decode(&position) != nil {
				return "", nil, errors.New("invalid Notion insert position")
			}
			switch position.Type {
			case "start", "end":
				if position.After != nil {
					return "", nil, errors.New("unexpected after_block position")
				}
			case "after_block":
				if position.After == nil || !notionID.MatchString(position.After.ID) {
					return "", nil, errors.New("position needs an exact sibling UUID")
				}
			default:
				return "", nil, errors.New("position must be start, end or after_block")
			}
		}
		path += "/children"
	} else if op != "block_update" {
		return "", nil, errors.New("unsupported Notion block action")
	}
	return strings.TrimRight(d.Resource, "/") + path, payload, nil
}
func notionBlockEvidence(op string, payload, data json.RawMessage) (ExecutionEvidence, error) {
	var receipt struct {
		ID      string `json:"id"`
		Object  string `json:"object"`
		Results []struct {
			ID string `json:"id"`
		} `json:"results"`
	}
	if json.Unmarshal(data, &receipt) != nil {
		return ExecutionEvidence{}, action.MarkUncertain(errors.New("Notion returned invalid confirmation; inspect content before retrying"))
	}
	id, _, _ := extractResourceID(payload)
	if op == "block_update" {
		if !notionID.MatchString(receipt.ID) || strings.ReplaceAll(strings.ToLower(receipt.ID), "-", "") != strings.ReplaceAll(strings.ToLower(id), "-", "") {
			return ExecutionEvidence{}, action.MarkUncertain(errors.New("Notion did not confirm the selected block; inspect before retrying"))
		}
		return ExecutionEvidence{ProviderResourceID: receipt.ID}, nil
	}
	var request struct {
		Children []json.RawMessage `json:"children"`
	}
	_ = json.Unmarshal(payload, &request)
	if receipt.Object != "list" || len(receipt.Results) != len(request.Children) {
		return ExecutionEvidence{}, action.MarkUncertain(errors.New("Notion did not confirm every appended block; inspect before retrying"))
	}
	for _, block := range receipt.Results {
		if !notionID.MatchString(block.ID) {
			return ExecutionEvidence{}, action.MarkUncertain(errors.New("Notion returned an invalid block identity; inspect before retrying"))
		}
	}
	return ExecutionEvidence{ProviderResourceID: id}, nil
}
