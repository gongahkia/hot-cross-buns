package connector

import (
	"context"
	"encoding/json"
	"github.com/gongahkia/hot-cross-buns/internal/action"
	"github.com/gongahkia/hot-cross-buns/internal/auth"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestProductivityAllOperationsHaveBoundedRoutesAndReviewedWrites(t *testing.T) {
	for _, kind := range []string{KindMicrosoft365, KindLinear, KindTodoist, KindDropbox} {
		t.Run(kind, func(t *testing.T) {
			calls := 0
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				calls++
				w.Header().Set("Content-Type", "application/json")
				if kind == KindLinear {
					io.WriteString(w, `{"data":{"result":{"success":true,"id":"one"}}}`)
				} else {
					io.WriteString(w, `{"id":"one"}`)
				}
			}))
			defer server.Close()
			d := Descriptor{Version: 1, ID: "account", Name: "Account", Kind: kind, Resource: server.URL, Authentication: AuthNone}
			registry, e := NewRegistry([]Descriptor{d})
			if e != nil {
				t.Fatal(e)
			}
			runtime := Runtime{Registry: registry, HTTPClient: server.Client()}
			for _, op := range d.Operations() {
				t.Run(op.ID, func(t *testing.T) {
					if op.Capability == action.ConnectedRead {
						in := serviceInput{}
						switch op.ID {
						case "tasks_search", "files_search", "drive_search", "sites_search":
							in.Query = "search"
						case "calendar_events":
							in.TimeMin = "2026-11-01T00:00:00Z"
							in.TimeMax = "2026-11-02T00:00:00Z"
						case "drive_children", "drive_item_get", "channel_messages":
							in.ResourceID = "parent/child"
						case "channel_replies":
							in.ResourceID = "team/channel/message"
						case "mail_get", "calendar_event_get", "site_get", "site_drives", "team_channels", "chat_messages", "states_list", "issue_get", "project_get", "issue_comments", "task_get", "section_get", "label_get", "comment_get", "task_comments", "project_comments":
							in.ResourceID = "id-one"
						case "file_get", "file_revisions", "file_download":
							in.ResourceID = "/file.txt"
						}
						endpoint, method, body, e := serviceRead(d, op.ID, in)
						if e != nil || !strings.HasPrefix(endpoint, server.URL+"/") && endpoint != server.URL || method != "GET" && method != "POST" {
							t.Fatalf("invalid read route %s %s: %s %v", method, endpoint, body, e)
						}
						return
					}
					payload := map[string]any{"resource_id": "id-one"}
					switch kind {
					case KindMicrosoft365:
						switch op.ID {
						case "mail_send":
							payload = map[string]any{"to": []string{"user@example.com"}, "subject": "Hello", "body": "Hello"}
						case "calendar_event_create":
							payload = map[string]any{"subject": "Meeting", "start": "2026-11-01T12:00:00Z", "end": "2026-11-01T13:00:00Z"}
						case "calendar_event_update":
							payload["subject"] = "Updated"
							payload["expected_etag"] = `"old"`
						case "calendar_event_delete":
							payload["expected_etag"] = `"old"`
						case "drive_folder_create", "drive_item_update":
							payload["resource_id"] = "drive/item"
							payload["name"] = "folder"
							if op.ID == "drive_item_update" {
								payload["expected_etag"] = `"old"`
							}
						case "drive_item_move":
							payload["resource_id"] = "drive/item"
							payload["parent_id"] = "parent"
							payload["expected_etag"] = `"old"`
						case "drive_item_delete":
							payload["resource_id"] = "drive/item"
							payload["expected_etag"] = `"old"`
						case "drive_share_link":
							payload["resource_id"] = "drive/item"
						case "channel_message_post":
							payload["resource_id"] = "team/channel"
							payload["body"] = "Hello"
						case "channel_reply_post":
							payload["resource_id"] = "team/channel/message"
							payload["body"] = "Hello"
						case "chat_message_post":
							payload["body"] = "Hello"
						}
					case KindLinear:
						switch op.ID {
						case "issue_create":
							payload = map[string]any{"title": "Issue", "teamId": "team"}
						case "issue_update":
							payload["title"] = "Changed"
						case "project_create":
							payload = map[string]any{"name": "Project", "teamIds": []string{"team"}}
						case "project_update":
							payload["name"] = "Changed"
						case "comment_create":
							payload = map[string]any{"issueId": "issue", "body": "Comment"}
						case "comment_update":
							payload["body"] = "Changed"
						}
					case KindTodoist:
						if strings.HasSuffix(op.ID, "_create") {
							payload = map[string]any{"name": "Name"}
							switch op.ID {
							case "task_create":
								payload = map[string]any{"content": "Task"}
							case "comment_create":
								payload = map[string]any{"content": "Comment", "task_id": "task"}
							case "section_create":
								payload["project_id"] = "project"
							}
						}
						if strings.HasSuffix(op.ID, "_update") {
							key := "name"
							if op.ID == "task_update" || op.ID == "comment_update" {
								key = "content"
							}
							payload[key] = "Changed"
						}
						if op.ID == "task_move" {
							payload["project_id"] = "project"
						}
					case KindDropbox:
						payload = map[string]any{"path": "/file.txt"}
						switch op.ID {
						case "file_move", "file_copy":
							payload = map[string]any{"from_path": "/file.txt", "to_path": "/new.txt"}
						case "file_restore":
							payload["rev"] = "revision"
						case "share_link_revoke":
							payload = map[string]any{"url": "https://www.dropbox.com/s/link"}
						}
					}
					before := calls
					prepared, e := runtime.PrepareAction(d.ID, op.ID, actionInput(nativeJSON(payload)))
					if e != nil || calls != before {
						t.Fatalf("prepare made network call or failed: %v", e)
					}
					if _, e = runtime.ExecutePreparedWithEvidence(context.Background(), action.Inspect, prepared); e == nil || calls != before {
						t.Fatal("inspect mode executed a write")
					}
					if _, e = runtime.ExecutePreparedWithEvidence(context.Background(), action.Act, prepared); e != nil || calls != before+1 {
						t.Fatalf("reviewed action failed %v", e)
					}
				})
			}
		})
	}
}
func TestProductivityCredentialHeadersAndGraphQLFailures(t *testing.T) {
	body := `{"data":{"viewer":{"id":"user"}}}`
	header := ""
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		header = r.Header.Get("Authorization")
		io.WriteString(w, body)
	}))
	defer server.Close()
	credentials, e := auth.New(t.TempDir())
	if e != nil {
		t.Fatal(e)
	}
	d := Descriptor{Version: 1, ID: "linear", Name: "Linear", Kind: KindLinear, Resource: server.URL, Authentication: AuthBearer}
	registry, _ := NewRegistry([]Descriptor{d})
	token, _ := auth.NewBearerToken("private-key", time.Time{})
	if e = credentials.Put(d.CredentialRef(), token); e != nil {
		t.Fatal(e)
	}
	runtime := Runtime{Registry: registry, Credentials: credentials}
	if _, e = runtime.Invoke(context.Background(), action.Inspect, d.ID, "whoami", []byte(`{}`)); e != nil || header != "private-key" {
		t.Fatalf("Linear API key route: %q %v", header, e)
	}
	for _, bad := range []string{`{"errors":[{"message":"provider error"}],"data":null}`, `{"data":{"issueCreate":{"success":false}}}`} {
		body = bad
		if strings.Contains(bad, "errors") {
			if _, e = runtime.Invoke(context.Background(), action.Inspect, d.ID, "whoami", []byte(`{}`)); e == nil {
				t.Fatal("GraphQL error accepted")
			}
		} else {
			p, e := runtime.PrepareAction(d.ID, "issue_create", actionInput([]byte(`{"title":"Issue","teamId":"team"}`)))
			if e != nil {
				t.Fatal(e)
			}
			if _, e = runtime.ExecutePreparedWithEvidence(context.Background(), action.Act, p); e == nil {
				t.Fatal("failed mutation claimed success")
			}
		}
	}
}
func TestProductivityConfinementAndScopes(t *testing.T) {
	d := Descriptor{Version: 1, ID: "ms", Name: "MS", Kind: KindMicrosoft365, Resource: MicrosoftResource, Authentication: AuthOAuth, OAuthClientID: "public", OAuthAuthorizeURL: MicrosoftAuthorizeURL, OAuthTokenURL: MicrosoftTokenURL, OAuthRedirectURL: "http://127.0.0.1:0/oauth/callback", OAuthScopes: MicrosoftReadScopes}
	if e := d.Validate(); e != nil {
		t.Fatal(e)
	}
	for _, op := range d.Operations() {
		if op.Capability != action.ConnectedRead || strings.HasPrefix(op.ID, "site") || strings.HasPrefix(op.ID, "chat") || strings.HasPrefix(op.ID, "team") {
			t.Fatalf("default scopes exposed %s", op.ID)
		}
	}
	for _, cursor := range []string{"https://evil.example/me/messages?$skip=1", MicrosoftResource + "/me/drive?$skip=1"} {
		if _, _, _, e := microsoftRead(d, "mail_list", serviceInput{Cursor: cursor}); e == nil {
			t.Fatal("pagination escaped exact resource")
		}
	}
	if _, _, e := productivityPrecondition(d, "drive_item_delete", []byte(`{"resource_id":"drive/item"}`)); e == nil {
		t.Fatal("unguarded Graph delete accepted")
	}
	for _, kind := range []string{KindMicrosoft365, KindLinear, KindTodoist, KindDropbox} {
		bad := d
		bad.Kind = kind
		bad.Resource = "https://evil.example/api"
		if e := bad.Validate(); e == nil {
			t.Fatal("credential destination not pinned")
		}
	}
	for _, path := range []string{"/../secret", "https://evil.example", "/a/./b", "/a//b"} {
		if dropboxPath(path, false) {
			t.Fatal("invalid Dropbox path accepted")
		}
	}
	var obj map[string]any
	if json.Unmarshal(nativeJSON(map[string]string{"value": "ok"}), &obj) != nil {
		t.Fatal("JSON helper invalid")
	}
}

func TestMicrosoftTeamsUsesOnlySupportedODataParameters(t *testing.T) {
	d := Descriptor{Resource: MicrosoftResource}
	endpoint, _, _, e := microsoftRead(d, "teams_list", serviceInput{})
	if e != nil || endpoint != MicrosoftResource+"/me/joinedTeams" {
		t.Fatal(endpoint, e)
	}
	endpoint, _, _, e = microsoftRead(d, "team_channels", serviceInput{ResourceID: "team"})
	if e != nil || strings.Contains(endpoint, "%24top") {
		t.Fatal(endpoint, e)
	}
}

func TestDropboxDownloadUsesArgumentHeaderAndBoundsBytes(t *testing.T) {
	size := 2
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/files/download" || r.Header.Get("Dropbox-API-Arg") != `{"path":"/file.txt"}` {
			t.Error("wrong download route or argument")
		}
		b, _ := io.ReadAll(r.Body)
		if len(b) != 0 {
			t.Error("download sent JSON request body")
		}
		w.Header().Set("Dropbox-API-Result", `{"id":"id:file","rev":"one"}`)
		io.WriteString(w, strings.Repeat("a", size))
	}))
	defer server.Close()
	d := Descriptor{Version: 1, ID: "dropbox", Name: "Dropbox", Kind: KindDropbox, Resource: server.URL, Authentication: AuthNone}
	registry, _ := NewRegistry([]Descriptor{d})
	runtime := Runtime{Registry: registry}
	r, e := runtime.Invoke(context.Background(), action.Inspect, d.ID, "file_download", []byte(`{"resource_id":"/file.txt"}`))
	if e != nil || !strings.Contains(string(r.Data), `"content":"aa"`) {
		t.Fatal(string(r.Data), e)
	}
	size = 128*1024 + 1
	if _, e = runtime.Invoke(context.Background(), action.Inspect, d.ID, "file_download", []byte(`{"resource_id":"/file.txt"}`)); e == nil {
		t.Fatal("oversized download returned")
	}
}
