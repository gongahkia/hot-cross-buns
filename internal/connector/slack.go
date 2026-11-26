package connector

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
)

var slackChannelID = regexp.MustCompile(`\A[A-Z0-9]{1,64}\z`)
var slackTimestamp = regexp.MustCompile(`\A[0-9]{1,16}\.[0-9]{6}\z`)

func slackOperations(specs []serviceOperation) []Operation {
	ops := serviceOperations(specs)
	for i := range ops {
		if ops[i].ID == "thread_replies" {
			ops[i].InputSchema = json.RawMessage(`{"type":"object","additionalProperties":false,"required":["resource_id","thread_ts"],"properties":{"resource_id":{"type":"string","description":"Exact Slack channel/conversation ID"},"thread_ts":{"type":"string","description":"Exact parent message timestamp, e.g. 1482960137.003543"},"cursor":{"type":"string"},"limit":{"type":"integer","minimum":1,"maximum":100}}}`)
		}
	}
	return ops
}
func slackConversationRead(d Descriptor, op string, in serviceInput) (string, string, []byte, error) {
	q := url.Values{}
	path := ""
	limit := in.Limit
	switch op {
	case "channels_list":
		path = "/conversations.list"
		types := in.Query
		if types == "" {
			types = "public_channel"
		}
		for _, kind := range strings.Split(types, ",") {
			if kind != "public_channel" && kind != "private_channel" && kind != "im" && kind != "mpim" {
				return "", "", nil, errors.New("choose valid Slack conversation types")
			}
		}
		q.Set("types", types)
		q.Set("exclude_archived", "true")
		if limit == 0 {
			limit = 100
		}
	case "thread_replies":
		if !slackChannelID.MatchString(in.ResourceID) || !slackTimestamp.MatchString(in.ThreadTS) {
			return "", "", nil, errors.New("Slack thread requires an exact channel ID and parent thread_ts")
		}
		path = "/conversations.replies"
		q.Set("channel", in.ResourceID)
		q.Set("ts", in.ThreadTS)
		if limit == 0 {
			limit = 15
		}
	default:
		return "", "", nil, errors.New("unsupported Slack conversation read")
	}
	q.Set("limit", strconv.Itoa(limit))
	if in.Cursor != "" {
		q.Set("cursor", in.Cursor)
	}
	return strings.TrimRight(d.Resource, "/") + path + "?" + q.Encode(), http.MethodGet, nil, nil
}
