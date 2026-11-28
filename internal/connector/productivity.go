package connector

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"strconv"
	"strings"
)

const (
	KindMicrosoft365      = "microsoft365"
	KindLinear            = "linear"
	KindTodoist           = "todoist"
	KindDropbox           = "dropbox"
	MicrosoftResource     = "https://graph.microsoft.com/v1.0"
	MicrosoftAuthorizeURL = "https://login.microsoftonline.com/common/oauth2/v2.0/authorize"
	MicrosoftTokenURL     = "https://login.microsoftonline.com/common/oauth2/v2.0/token"
	MicrosoftDeviceURL    = "https://login.microsoftonline.com/common/oauth2/v2.0/devicecode"
	MicrosoftReadScopes   = "offline_access User.Read Mail.Read Calendars.Read Files.Read"
)

func productivityKind(kind string) bool {
	return kind == KindMicrosoft365 || kind == KindLinear || kind == KindTodoist || kind == KindDropbox
}
func validateProductivityResource(d Descriptor, u *url.URL) error {
	if d.Kind == KindMicrosoft365 && d.Authentication == AuthOAuth && u.Scheme != "http" && (d.OAuthAuthorizeURL != MicrosoftAuthorizeURL || d.OAuthTokenURL != MicrosoftTokenURL) {
		return errors.New("Microsoft sign-in requires the Microsoft identity endpoints")
	}
	expected := map[string]string{KindMicrosoft365: MicrosoftResource, KindLinear: "https://api.linear.app/graphql", KindTodoist: "https://api.todoist.com/api/v1", KindDropbox: "https://api.dropboxapi.com/2"}[d.Kind]
	if u.RawQuery != "" || u.Fragment != "" || u.RawPath != "" || strings.HasSuffix(d.Resource, "/") {
		return errors.New("use the service API base without a query, fragment or trailing slash")
	}
	if d.Resource != expected && !(u.Scheme == "http" && isLoopbackHost(u.Hostname())) {
		return fmt.Errorf("%s requires the exact API base %s", d.Kind, expected)
	}
	return nil
}
func productivityOperations(d Descriptor) []Operation {
	var specs []serviceOperation
	switch d.Kind {
	case KindMicrosoft365:
		specs = microsoftOperations()
	case KindLinear:
		specs = linearOperations()
	case KindTodoist:
		specs = todoistOperations()
	case KindDropbox:
		specs = dropboxOperations()
	}
	ops := serviceOperations(specs)
	if d.Kind == KindMicrosoft365 && d.Authentication == AuthOAuth {
		filtered := ops[:0]
		for _, op := range ops {
			if microsoftScopeAllows(op.ID, strings.Fields(d.OAuthScopes)) {
				filtered = append(filtered, op)
			}
		}
		return filtered
	}
	return ops
}
func productivityRead(d Descriptor, op string, in serviceInput) (string, string, []byte, error) {
	switch d.Kind {
	case KindMicrosoft365:
		return microsoftRead(d, op, in)
	case KindLinear:
		return linearRead(d, op, in)
	case KindTodoist:
		return todoistRead(d, op, in)
	case KindDropbox:
		return dropboxRead(d, op, in)
	}
	return "", "", nil, errors.New("unsupported productivity connector")
}
func productivityAction(d Descriptor, op string, payload []byte) (string, []byte, error) {
	switch d.Kind {
	case KindMicrosoft365:
		return microsoftAction(d, op, payload)
	case KindLinear:
		return linearAction(d, op, payload)
	case KindTodoist:
		return todoistAction(d, op, payload)
	case KindDropbox:
		return dropboxAction(d, op, payload)
	}
	return "", nil, errors.New("unsupported productivity action")
}
func nativeID(value string) bool {
	return value != "" && len(value) <= 512 && value != "." && value != ".." && !strings.ContainsAny(value, "/\\?#\x00\r\n\t ")
}
func nativePathIDs(value string, count int) ([]string, error) {
	parts := strings.Split(value, "/")
	if len(parts) != count {
		return nil, errors.New("provide the exact resource ID components described by this operation")
	}
	for i, p := range parts {
		if !nativeID(p) {
			return nil, errors.New("invalid resource ID")
		}
		parts[i] = url.PathEscape(p)
	}
	return parts, nil
}
func nativeLimit(in serviceInput) int {
	if in.Limit == 0 {
		return 30
	}
	return in.Limit
}
func nativeObject(raw []byte, allowed string) (map[string]json.RawMessage, error) {
	var v map[string]json.RawMessage
	if json.Unmarshal(raw, &v) != nil || v == nil {
		return nil, errors.New("payload must be a JSON object")
	}
	for k := range v {
		if !strings.Contains(" "+allowed+" ", " "+k+" ") {
			return nil, fmt.Errorf("unsupported payload field %q", k)
		}
	}
	return v, nil
}
func nativeString(v map[string]json.RawMessage, key string, required bool) (string, error) {
	raw, found := v[key]
	if !found && !required {
		return "", nil
	}
	var s string
	if json.Unmarshal(raw, &s) != nil || required && strings.TrimSpace(s) == "" || len(s) > 10000 || strings.ContainsRune(s, '\x00') {
		return "", fmt.Errorf("provide a valid %s", key)
	}
	return s, nil
}
func nativeRequire(v map[string]json.RawMessage, keys ...string) error {
	for _, k := range keys {
		if _, err := nativeString(v, k, true); err != nil {
			return err
		}
	}
	return nil
}
func nativeResourcePayload(raw []byte, allowed string) (string, map[string]json.RawMessage, error) {
	v, err := nativeObject(raw, "resource_id "+allowed)
	if err != nil {
		return "", nil, err
	}
	id, err := nativeString(v, "resource_id", true)
	delete(v, "resource_id")
	return id, v, err
}
func nativeJSON(value any) []byte { b, _ := json.Marshal(value); return b }
func nativePagedURL(d Descriptor, path string, q url.Values, cursor string) (string, error) {
	endpoint := d.Resource + path
	if cursor != "" {
		if strings.Contains(cursor, "://") {
			next, e := url.Parse(cursor)
			base, be := url.Parse(endpoint)
			if e != nil || be != nil || next.Scheme != base.Scheme || next.Host != base.Host || next.EscapedPath() != base.EscapedPath() || next.User != nil || next.Fragment != "" {
				return "", errors.New("pagination URL must remain on the exact selected service resource")
			}
			values := next.Query()
			token, skip := values.Get("$skiptoken"), values.Get("$skip")
			if token != "" {
				q.Set("$skiptoken", token)
			} else if n, e := strconv.Atoi(skip); e == nil && n >= 0 && n <= 100000 {
				q.Set("$skip", skip)
			} else {
				return "", errors.New("pagination URL has no supported bounded continuation token")
			}
		} else {
			q.Set("$skiptoken", cursor)
		}
	}
	if len(q) > 0 {
		endpoint += "?" + q.Encode()
	}
	return endpoint, nil
}
func productivityPrecondition(d Descriptor, op string, raw []byte) ([]byte, string, error) {
	if d.Kind != KindMicrosoft365 || !(strings.HasSuffix(op, "_update") || strings.HasSuffix(op, "_delete") || op == "drive_item_move") {
		return raw, "", nil
	}
	var body map[string]json.RawMessage
	if json.Unmarshal(raw, &body) != nil {
		return nil, "", errors.New("invalid change payload")
	}
	tag, err := nativeString(body, "expected_etag", true)
	if err != nil || len(tag) > 512 || strings.ContainsAny(tag, "\r\n") {
		return nil, "", errors.New("read the current resource and provide its exact expected_etag before changing it")
	}
	delete(body, "expected_etag")
	return nativeJSON(body), tag, nil
}
