package connector

import (
	"encoding/json"
	"errors"
	"github.com/gongahkia/hot-cross-buns/internal/action"
	"net/http"
	"strings"
	"unicode/utf8"
)

func dropboxOperations() []serviceOperation {
	return []serviceOperation{
		{"whoami", "Verify the Dropbox account.", action.ConnectedRead},
		{"folder_list", "List a folder. resource_id is a Dropbox /path or id:...; empty means root. Pass response cursor unchanged for continuation. No recursive traversal.", action.ConnectedRead},
		{"files_search", "Search files by query; optional resource_id folder path; continue with cursor.", action.ConnectedRead},
		{"file_get", "Read file/folder metadata by resource_id /path or id:... .", action.ConnectedRead},
		{"file_download", "Read a file up to 128 KiB by resource_id /path or id:... . Returns UTF-8 text or base64, metadata and SHA256; larger files require a separate import.", action.ConnectedRead},
		{"file_revisions", "Read a file's revision history by resource_id /path or id:... .", action.ConnectedRead},
		{"shared_links", "List shared links, optionally for resource_id /path or id:...; pass cursor for continuation.", action.ConnectedRead},
		{"folder_create", "Create a folder after exact approval: payload path. Existing names fail; no autorename.", action.ConnectedMutate},
		{"file_move", "Move file/folder after exact approval: payload from_path and to_path. No overwrite, ownership transfer or autorename.", action.ConnectedMutate},
		{"file_copy", "Copy file/folder after exact approval: payload from_path and to_path. No autorename or ownership transfer.", action.ConnectedMutate},
		{"file_delete", "Delete after exact approval: payload path; optional parent_rev for a file read immediately beforehand. Folder deletion affects descendants.", action.ConnectedMutate},
		{"file_restore", "Restore a specific revision after exact approval: payload path and rev.", action.ConnectedMutate},
		{"share_link_create", "Create or retrieve a shared link after exact approval: payload path. Uses Dropbox's default access policy; the resulting link can be externally accessible.", action.Publish},
		{"share_link_revoke", "Revoke a particular Dropbox shared link after exact approval: payload url. Does not delete the file.", action.ConnectedMutate},
	}
}
func dropboxPath(value string, root bool) bool {
	if value == "" {
		return root
	}
	if len(value) > 4096 || !utf8.ValidString(value) || strings.ContainsAny(value, "\x00\r\n\\") {
		return false
	}
	if strings.HasPrefix(value, "id:") {
		return nativeID(strings.TrimPrefix(value, "id:"))
	}
	if !strings.HasPrefix(value, "/") || strings.HasSuffix(value, "/") {
		return false
	}
	for _, p := range strings.Split(value[1:], "/") {
		if p == "" || p == "." || p == ".." {
			return false
		}
	}
	return true
}
func dropboxRead(d Descriptor, op string, in serviceInput) (string, string, []byte, error) {
	if len(in.Payload) > 0 || in.Fields != "" || in.TimeMin != "" || in.TimeMax != "" {
		return "", "", nil, errors.New("Dropbox reads accept query, resource_id, cursor and limit only")
	}
	path := ""
	var body any
	switch op {
	case "whoami":
		if in.ResourceID != "" || in.Query != "" || in.Cursor != "" || in.Limit != 0 {
			return "", "", nil, errors.New("account check accepts no arguments")
		}
		path = "/users/get_current_account"
	case "folder_list":
		if !dropboxPath(in.ResourceID, true) || in.Query != "" {
			return "", "", nil, errors.New("provide a Dropbox folder path or ID")
		}
		path = "/files/list_folder"
		body = map[string]any{"path": in.ResourceID, "recursive": false, "include_deleted": false, "limit": nativeLimit(in)}
		if in.Cursor != "" {
			path += "/continue"
			body = map[string]string{"cursor": in.Cursor}
		}
	case "files_search":
		if !dropboxPath(in.ResourceID, true) || strings.TrimSpace(in.Query) == "" && in.Cursor == "" {
			return "", "", nil, errors.New("provide a search query and optional Dropbox folder path")
		}
		path = "/files/search_v2"
		options := map[string]any{"max_results": nativeLimit(in)}
		if in.ResourceID != "" {
			options["path"] = in.ResourceID
		}
		body = map[string]any{"query": in.Query, "options": options}
		if in.Cursor != "" {
			path = "/files/search/continue_v2"
			body = map[string]string{"cursor": in.Cursor}
		}
	case "file_get", "file_download", "file_revisions":
		if !dropboxPath(in.ResourceID, false) || in.Query != "" || in.Cursor != "" {
			return "", "", nil, errors.New("provide only the exact Dropbox file path or ID")
		}
		path = "/files/get_metadata"
		body = map[string]any{"path": in.ResourceID}
		if op == "file_revisions" {
			path = "/files/list_revisions"
			body = map[string]any{"path": in.ResourceID, "limit": nativeLimit(in)}
		}
		if op == "file_download" {
			path = "/files/download"
		}
	case "shared_links":
		if !dropboxPath(in.ResourceID, true) || in.Query != "" {
			return "", "", nil, errors.New("provide an optional Dropbox path")
		}
		path = "/sharing/list_shared_links"
		args := map[string]any{}
		if in.ResourceID != "" {
			args["path"] = in.ResourceID
		}
		if in.Cursor != "" {
			args["cursor"] = in.Cursor
		}
		body = args
	default:
		return "", "", nil, errors.New("unsupported Dropbox read")
	}
	endpoint := d.Resource + path
	if op == "file_download" && d.Resource == "https://api.dropboxapi.com/2" {
		endpoint = "https://content.dropboxapi.com/2" + path
	}
	return endpoint, http.MethodPost, nativeJSON(body), nil
}
func dropboxAction(d Descriptor, op string, raw []byte) (string, []byte, error) {
	allowed := map[string]string{"folder_create": "path", "file_move": "from_path to_path", "file_copy": "from_path to_path", "file_delete": "path parent_rev", "file_restore": "path rev", "share_link_create": "path", "share_link_revoke": "url"}[op]
	if allowed == "" {
		return "", nil, errors.New("unsupported Dropbox action")
	}
	v, e := nativeObject(raw, allowed)
	if e != nil {
		return "", nil, e
	}
	for _, key := range strings.Fields(allowed) {
		if key == "parent_rev" {
			continue
		}
		if e = nativeRequire(v, key); e != nil {
			return "", nil, e
		}
	}
	for key := range v {
		s, e := nativeString(v, key, true)
		if e != nil {
			return "", nil, e
		}
		if strings.HasSuffix(key, "path") && !dropboxPath(s, false) {
			return "", nil, errors.New("use an absolute Dropbox path or id:... without traversal")
		}
		if (key == "rev" || key == "parent_rev") && !nativeID(s) {
			return "", nil, errors.New("provide the exact revision from a fresh metadata read")
		}
		if key == "url" && (!strings.HasPrefix(s, "https://") || len(s) > 4096) {
			return "", nil, errors.New("provide the exact HTTPS shared link")
		}
	}
	path := ""
	switch op {
	case "folder_create":
		path = "/files/create_folder_v2"
		v["autorename"] = json.RawMessage(`false`)
	case "file_move", "file_copy":
		path = "/files/move_v2"
		if op == "file_copy" {
			path = "/files/copy_v2"
		}
		v["autorename"] = json.RawMessage(`false`)
		v["allow_ownership_transfer"] = json.RawMessage(`false`)
	case "file_delete":
		path = "/files/delete_v2"
	case "file_restore":
		path = "/files/restore"
	case "share_link_create":
		path = "/sharing/create_shared_link_with_settings"
	case "share_link_revoke":
		path = "/sharing/revoke_shared_link"
	}
	return d.Resource + path, nativeJSON(v), nil
}
