package connector

import (
	"encoding/json"
	"errors"
	"github.com/gongahkia/hot-cross-buns/internal/action"
	"net/http"
	"net/mail"
	"net/url"
	"strconv"
	"strings"
	"time"
)

func microsoftOperations() []serviceOperation {
	return []serviceOperation{
		{"whoami", "Verify the signed-in Microsoft account.", action.ConnectedRead},
		{"mail_list", "List Outlook messages; query searches mailbox content. Follow @odata.nextLink in cursor; only this same mailbox path is accepted.", action.ConnectedRead},
		{"mail_get", "Read one Outlook message by resource_id.", action.ConnectedRead},
		{"mail_folders", "List Outlook mail folders.", action.ConnectedRead},
		{"calendar_list", "List the user's calendars.", action.ConnectedRead},
		{"calendar_events", "Read a bounded calendar view. Supply RFC3339 time_min/time_max and optional resource_id calendar ID. Follow @odata.nextLink.", action.ConnectedRead},
		{"calendar_event_get", "Read one event by resource_id, including its @odata.etag before changes.", action.ConnectedRead},
		{"drive_list", "List the user's OneDrive drives.", action.ConnectedRead},
		{"drive_search", "Search OneDrive filenames/content metadata with query. resource_id optionally selects a drive.", action.ConnectedRead},
		{"drive_children", "List a folder's children; resource_id is drive_id/item_id. Use drive_root_children for a drive root.", action.ConnectedRead},
		{"drive_root_children", "List the default drive root, or a drive selected by resource_id.", action.ConnectedRead},
		{"drive_item_get", "Read file/folder metadata including eTag; resource_id is drive_id/item_id. Download URLs are untrusted data and never receive this token.", action.ConnectedRead},
		{"sites_search", "Search SharePoint sites by query; requires Sites.Read.All or equivalent.", action.ConnectedRead},
		{"site_get", "Read a SharePoint site by resource_id.", action.ConnectedRead},
		{"site_drives", "List a SharePoint site's document libraries by resource_id site ID; use drive operations for their contents.", action.ConnectedRead},
		{"teams_list", "List joined Microsoft Teams.", action.ConnectedRead},
		{"team_channels", "List one team's channels by resource_id team ID.", action.ConnectedRead},
		{"channel_messages", "Read a channel's messages; resource_id is team_id/channel_id. Follow @odata.nextLink.", action.ConnectedRead},
		{"channel_replies", "Read message replies; resource_id is team_id/channel_id/message_id.", action.ConnectedRead},
		{"chats_list", "List the signed-in user's Teams chats.", action.ConnectedRead},
		{"chat_messages", "Read Teams chat messages by resource_id chat ID.", action.ConnectedRead},
		{"mail_send", "Submit a plain-text Outlook email after exact approval. Payload to (email array), optional cc/bcc, subject and body. HTTP 202 confirms submission, not delivery. Never replay an uncertain send.", action.Publish},
		{"calendar_event_create", "Create an event after exact approval: payload subject, start/end RFC3339, optional body/location/attendees email array and calendar_id.", action.ConnectedMutate},
		{"calendar_event_update", "Update one event: payload resource_id, expected_etag from a fresh read and changed subject/start/end/body/location/attendees.", action.ConnectedMutate},
		{"calendar_event_delete", "Delete one event after exact approval: payload resource_id and expected_etag from a fresh read.", action.ConnectedMutate},
		{"drive_folder_create", "Create a folder after exact approval: payload resource_id drive_id/parent_item_id and name. Existing names are not overwritten.", action.ConnectedMutate},
		{"drive_item_update", "Rename a drive item after exact approval: resource_id drive_id/item_id, expected_etag, name.", action.ConnectedMutate},
		{"drive_item_move", "Move a drive item within its drive: resource_id drive_id/item_id, expected_etag and parent_id.", action.ConnectedMutate},
		{"drive_item_delete", "Delete a drive item after exact approval: resource_id drive_id/item_id and expected_etag.", action.ConnectedMutate},
		{"drive_share_link", "Create an organization-scoped view link: payload resource_id drive_id/item_id. Never creates an anonymous link.", action.Publish},
		{"channel_message_post", "Post plain text after exact approval: resource_id team_id/channel_id and body.", action.Publish},
		{"channel_reply_post", "Reply in a channel after exact approval: resource_id team_id/channel_id/message_id and body.", action.Publish},
		{"chat_message_post", "Post plain text in a chat after exact approval: resource_id chat_id and body.", action.Publish},
	}
}
func microsoftScopeAllows(op string, scopes []string) bool {
	required := []string{"User.Read"}
	switch {
	case op == "mail_send":
		required = []string{"Mail.Send"}
	case strings.HasPrefix(op, "mail_"):
		required = []string{"Mail.Read", "Mail.ReadWrite"}
	case strings.HasPrefix(op, "calendar_event_") && (strings.HasSuffix(op, "_create") || strings.HasSuffix(op, "_update") || strings.HasSuffix(op, "_delete")):
		required = []string{"Calendars.ReadWrite"}
	case strings.HasPrefix(op, "calendar_"):
		required = []string{"Calendars.Read", "Calendars.ReadWrite"}
	case strings.HasPrefix(op, "drive_") && (strings.HasSuffix(op, "_create") || strings.HasSuffix(op, "_update") || strings.HasSuffix(op, "_move") || strings.HasSuffix(op, "_delete") || op == "drive_share_link"):
		required = []string{"Files.ReadWrite", "Files.ReadWrite.All", "Sites.ReadWrite.All"}
	case strings.HasPrefix(op, "drive_"):
		required = []string{"Files.Read", "Files.Read.All", "Files.ReadWrite", "Files.ReadWrite.All", "Sites.Read.All", "Sites.ReadWrite.All"}
	case strings.HasPrefix(op, "site"):
		required = []string{"Sites.Read.All", "Sites.ReadWrite.All"}
	case op == "teams_list":
		required = []string{"Team.ReadBasic.All", "TeamSettings.Read.All", "TeamSettings.ReadWrite.All", "User.Read.All", "Directory.Read.All"}
	case op == "team_channels":
		required = []string{"Channel.ReadBasic.All", "ChannelSettings.Read.All", "ChannelSettings.ReadWrite.All", "Group.Read.All"}
	case op == "channel_messages" || op == "channel_replies":
		required = []string{"ChannelMessage.Read.All"}
	case strings.HasPrefix(op, "channel_"):
		required = []string{"ChannelMessage.Send"}
	case op == "chat_message_post":
		required = []string{"ChatMessage.Send", "Chat.ReadWrite"}
	case strings.HasPrefix(op, "chat"):
		required = []string{"Chat.Read", "Chat.ReadWrite"}
	}
	for _, s := range scopes {
		for _, need := range required {
			if strings.TrimPrefix(s, "https://graph.microsoft.com/") == need {
				return true
			}
		}
	}
	return false
}
func microsoftRead(d Descriptor, op string, in serviceInput) (string, string, []byte, error) {
	if len(in.Payload) > 0 || in.ThreadTS != "" || in.CalendarID != "" || in.EventID != "" || len(in.CalendarIDs) > 0 {
		return "", "", nil, errors.New("Microsoft reads use query, resource_id, cursor, limit and time bounds only")
	}
	path := ""
	paged := true
	q := url.Values{"$top": {strconv.Itoa(nativeLimit(in))}}
	one := func() (string, error) {
		ids, e := nativePathIDs(in.ResourceID, 1)
		if e != nil {
			return "", e
		}
		return ids[0], nil
	}
	switch op {
	case "whoami":
		path = "/me"
		paged = false
	case "mail_list":
		path = "/me/messages"
		q.Set("$select", "id,subject,from,toRecipients,receivedDateTime,isRead,bodyPreview,webLink")
		if in.Query != "" {
			q.Set("$search", strconv.Quote(in.Query))
		}
	case "mail_get", "calendar_event_get", "site_get", "site_drives", "team_channels", "chat_messages":
		id, e := one()
		if e != nil {
			return "", "", nil, e
		}
		switch op {
		case "mail_get":
			path = "/me/messages/" + id
			paged = false
		case "calendar_event_get":
			path = "/me/events/" + id
			paged = false
		case "site_get":
			path = "/sites/" + id
			paged = false
		case "site_drives":
			path = "/sites/" + id + "/drives"
		case "team_channels":
			path = "/teams/" + id + "/channels"
		case "chat_messages":
			path = "/chats/" + id + "/messages"
		}
	case "mail_folders":
		path = "/me/mailFolders"
	case "calendar_list":
		path = "/me/calendars"
	case "calendar_events":
		start, e1 := time.Parse(time.RFC3339, in.TimeMin)
		end, e2 := time.Parse(time.RFC3339, in.TimeMax)
		if e1 != nil || e2 != nil || !end.After(start) || end.Sub(start) > 366*24*time.Hour {
			return "", "", nil, errors.New("calendar view requires an increasing RFC3339 window up to 366 days")
		}
		path = "/me/calendarView"
		if in.ResourceID != "" {
			id, e := one()
			if e != nil {
				return "", "", nil, e
			}
			path = "/me/calendars/" + id + "/calendarView"
		}
		q.Set("startDateTime", in.TimeMin)
		q.Set("endDateTime", in.TimeMax)
	case "drive_list":
		path = "/me/drives"
	case "drive_search", "drive_root_children":
		root := "/me/drive"
		if in.ResourceID != "" {
			id, e := one()
			if e != nil {
				return "", "", nil, e
			}
			root = "/drives/" + id
		}
		path = root + "/root/children"
		if op == "drive_search" {
			if strings.TrimSpace(in.Query) == "" {
				return "", "", nil, errors.New("provide a file search query")
			}
			path = root + "/root/search(q='" + url.PathEscape(strings.ReplaceAll(in.Query, "'", "''")) + "')"
		}
	case "drive_children", "drive_item_get":
		ids, e := nativePathIDs(in.ResourceID, 2)
		if e != nil {
			return "", "", nil, e
		}
		path = "/drives/" + ids[0] + "/items/" + ids[1]
		if op == "drive_children" {
			path += "/children"
		} else {
			paged = false
		}
	case "sites_search":
		if strings.TrimSpace(in.Query) == "" {
			return "", "", nil, errors.New("provide a site search query")
		}
		path = "/sites"
		q.Set("search", in.Query)
	case "teams_list":
		path = "/me/joinedTeams"
	case "channel_messages", "channel_replies":
		count := 2
		if op == "channel_replies" {
			count = 3
		}
		ids, e := nativePathIDs(in.ResourceID, count)
		if e != nil {
			return "", "", nil, e
		}
		path = "/teams/" + ids[0] + "/channels/" + ids[1] + "/messages"
		if count == 3 {
			path += "/" + ids[2] + "/replies"
		}
	case "chats_list":
		path = "/me/chats"
	default:
		return "", "", nil, errors.New("unsupported Microsoft read")
	}
	if op == "teams_list" {
		if in.Cursor != "" || in.Limit != 0 {
			return "", "", nil, errors.New("joined teams does not support pagination controls")
		}
		q = url.Values{}
	}
	if op == "team_channels" {
		if in.Limit != 0 {
			return "", "", nil, errors.New("channel listing does not support a page size")
		}
		q.Del("$top")
		q.Set("$select", "id,displayName,description,membershipType,webUrl")
	}
	if op != "calendar_events" && (in.TimeMin != "" || in.TimeMax != "") {
		return "", "", nil, errors.New("time bounds apply only to calendar_events")
	}
	if in.Query != "" && op != "mail_list" && op != "drive_search" && op != "sites_search" {
		return "", "", nil, errors.New("this Microsoft operation does not accept a search query")
	}
	if !paged {
		if in.Cursor != "" || in.Limit != 0 || in.Query != "" {
			return "", "", nil, errors.New("single-resource reads do not accept pagination or query")
		}
		q = url.Values{}
	}
	if in.Fields != "" {
		return "", "", nil, errors.New("Microsoft result fields are host-selected")
	}
	endpoint, e := nativePagedURL(d, path, q, in.Cursor)
	return endpoint, http.MethodGet, nil, e
}
func microsoftRecipients(raw json.RawMessage) ([]map[string]any, error) {
	var emails []string
	if json.Unmarshal(raw, &emails) != nil || len(emails) > 50 {
		return nil, errors.New("recipients must be an array of up to 50 email addresses")
	}
	out := []map[string]any{}
	for _, email := range emails {
		a, e := mail.ParseAddress(email)
		if e != nil || a.Address != email {
			return nil, errors.New("use plain email addresses without display names")
		}
		out = append(out, map[string]any{"emailAddress": map[string]string{"address": email}})
	}
	return out, nil
}
func microsoftAction(d Descriptor, op string, raw []byte) (string, []byte, error) {
	base := d.Resource
	if op == "mail_send" {
		v, e := nativeObject(raw, "to cc bcc subject body")
		if e != nil {
			return "", nil, e
		}
		if e = nativeRequire(v, "subject", "body"); e != nil {
			return "", nil, e
		}
		message := map[string]any{"subject": json.RawMessage(v["subject"]), "body": map[string]any{"contentType": "Text", "content": json.RawMessage(v["body"])}}
		total := 0
		for _, item := range []struct{ input, output string }{{"to", "toRecipients"}, {"cc", "ccRecipients"}, {"bcc", "bccRecipients"}} {
			if b, ok := v[item.input]; ok {
				recipients, e := microsoftRecipients(b)
				if e != nil {
					return "", nil, e
				}
				total += len(recipients)
				message[item.output] = recipients
			}
		}
		if total < 1 || total > 50 {
			return "", nil, errors.New("provide 1–50 explicit recipients")
		}
		return base + "/me/sendMail", nativeJSON(map[string]any{"message": message, "saveToSentItems": true}), nil
	}
	if strings.HasPrefix(op, "calendar_event_") {
		id, v, e := nativeResourcePayload(raw, "subject body start end location attendees calendar_id")
		if op == "calendar_event_create" {
			v, e = nativeObject(raw, "subject body start end location attendees calendar_id")
			id = ""
		}
		if e != nil {
			return "", nil, e
		}
		if op != "calendar_event_create" && v["calendar_id"] != nil {
			return "", nil, errors.New("calendar_id applies only to event creation")
		}
		path := "/me/events"
		if op != "calendar_event_create" {
			ids, e := nativePathIDs(id, 1)
			if e != nil {
				return "", nil, e
			}
			path += "/" + ids[0]
		} else {
			if e = nativeRequire(v, "subject", "start", "end"); e != nil {
				return "", nil, e
			}
			if cid, ok := v["calendar_id"]; ok {
				var s string
				if json.Unmarshal(cid, &s) != nil || !nativeID(s) {
					return "", nil, errors.New("invalid calendar_id")
				}
				path = "/me/calendars/" + url.PathEscape(s) + "/events"
			}
		}
		if op == "calendar_event_delete" {
			if len(v) != 0 {
				return "", nil, errors.New("event deletion accepts only resource_id and expected_etag")
			}
			return base + path, nil, nil
		}
		body := map[string]any{}
		if raw, ok := v["subject"]; ok {
			if _, e := nativeString(v, "subject", true); e != nil {
				return "", nil, e
			}
			body["subject"] = raw
		}
		for _, key := range []string{"start", "end"} {
			if raw, ok := v[key]; ok {
				var value string
				if json.Unmarshal(raw, &value) != nil {
					return "", nil, errors.New("event times must be RFC3339 strings")
				}
				parsed, e := time.Parse(time.RFC3339, value)
				if e != nil {
					return "", nil, e
				}
				body[key] = map[string]string{"dateTime": parsed.UTC().Format("2006-01-02T15:04:05"), "timeZone": "UTC"}
			}
		}
		if v["start"] != nil && v["end"] != nil {
			a, _ := nativeString(v, "start", true)
			b, _ := nativeString(v, "end", true)
			start, _ := time.Parse(time.RFC3339, a)
			end, _ := time.Parse(time.RFC3339, b)
			if !end.After(start) {
				return "", nil, errors.New("event end must follow start")
			}
		}
		for _, item := range []struct{ key, field string }{{"body", "body"}, {"location", "location"}} {
			if _, ok := v[item.key]; ok {
				s, e := nativeString(v, item.key, false)
				if e != nil {
					return "", nil, e
				}
				if item.key == "body" {
					body[item.field] = map[string]string{"contentType": "Text", "content": s}
				} else {
					body[item.field] = map[string]string{"displayName": s}
				}
			}
		}
		if raw, ok := v["attendees"]; ok {
			recipients, e := microsoftRecipients(raw)
			if e != nil {
				return "", nil, e
			}
			for _, recipient := range recipients {
				recipient["type"] = "required"
			}
			body["attendees"] = recipients
		}
		if len(body) == 0 {
			return "", nil, errors.New("provide event fields to change")
		}
		return base + path, nativeJSON(body), nil
	}
	if strings.HasPrefix(op, "drive_") {
		id, v, e := nativeResourcePayload(raw, "name parent_id")
		if e != nil {
			return "", nil, e
		}
		ids, e := nativePathIDs(id, 2)
		if e != nil {
			return "", nil, e
		}
		path := "/drives/" + ids[0] + "/items/" + ids[1]
		body := map[string]any{}
		switch op {
		case "drive_folder_create", "drive_item_update":
			if len(v) != 1 || nativeRequire(v, "name") != nil {
				return "", nil, errors.New("provide only a nonempty name")
			}
			var name string
			_ = json.Unmarshal(v["name"], &name)
			if strings.ContainsAny(name, "/\\") || name == "." || name == ".." {
				return "", nil, errors.New("use a single file or folder name")
			}
			body["name"] = name
			if op == "drive_folder_create" {
				path += "/children"
				body["folder"] = map[string]any{}
				body["@microsoft.graph.conflictBehavior"] = "fail"
			}
		case "drive_item_move":
			parent, e := nativeString(v, "parent_id", true)
			if e != nil || !nativeID(parent) || len(v) != 1 {
				return "", nil, errors.New("provide only the exact destination parent_id")
			}
			body["parentReference"] = map[string]string{"id": parent}
		case "drive_item_delete":
			if len(v) != 0 {
				return "", nil, errors.New("deletion accepts only resource_id and expected_etag")
			}
			return base + path, nil, nil
		case "drive_share_link":
			if len(v) != 0 {
				return "", nil, errors.New("sharing accepts only resource_id")
			}
			path += "/createLink"
			body = map[string]any{"type": "view", "scope": "organization"}
		default:
			return "", nil, errors.New("unsupported drive action")
		}
		return base + path, nativeJSON(body), nil
	}
	if op == "channel_message_post" || op == "channel_reply_post" || op == "chat_message_post" {
		id, v, e := nativeResourcePayload(raw, "body")
		if e != nil {
			return "", nil, e
		}
		text, e := nativeString(v, "body", true)
		if e != nil || len(v) != 1 {
			return "", nil, errors.New("provide only a plain-text message body")
		}
		count := 2
		if op == "channel_reply_post" {
			count = 3
		}
		if op == "chat_message_post" {
			count = 1
		}
		ids, e := nativePathIDs(id, count)
		if e != nil {
			return "", nil, e
		}
		path := "/chats/" + ids[0] + "/messages"
		if count > 1 {
			path = "/teams/" + ids[0] + "/channels/" + ids[1] + "/messages"
			if count == 3 {
				path += "/" + ids[2] + "/replies"
			}
		}
		return base + path, nativeJSON(map[string]any{"body": map[string]string{"contentType": "text", "content": text}}), nil
	}
	return "", nil, errors.New("unsupported Microsoft action")
}
func productivityActionMethod(kind, op string) string {
	if kind == KindMicrosoft365 {
		if strings.HasSuffix(op, "_delete") {
			return http.MethodDelete
		}
		if strings.HasSuffix(op, "_update") || op == "drive_item_move" {
			return http.MethodPatch
		}
	}
	if kind == KindTodoist && strings.HasSuffix(op, "_delete") {
		return http.MethodDelete
	}
	return http.MethodPost
}
