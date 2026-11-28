package main

import (
	"fmt"
	"strings"

	"github.com/gongahkia/hot-cross-buns/internal/connector"
	"github.com/gongahkia/hot-cross-buns/internal/uisnapshot"
	"github.com/gongahkia/hot-cross-buns/internal/workapp"
)

type connectionPreset struct {
	action, kind, key, name, detail, description, resource, help, docs string
}

var connectionPresets = []connectionPreset{
	{action: "add-github", kind: connector.KindGitHub, key: "G", name: "GitHub", detail: "Read issues, PRs, branches and CI results; review changes before publishing.", description: "Connect one repository with a fine-grained personal access token. Grant Pull requests read (write for changes), Contents read, Checks read, Issues read (write for changes), and Actions read. Enter the token privately after saving. Code pushes remain a separately authorized CLI workflow.", help: "Repository API URL: https://api.github.com/repos/owner/repo", docs: "https://docs.github.com/en/rest/pulls/pulls"},
	{action: "add-gitlab", kind: connector.KindGitLab, key: "L", name: "GitLab", detail: "Read issues, merge requests and pipelines; review changes before publishing.", description: "Connect one project with a personal or project access token. Use read_api for reads or api for reviewed changes. Find the numeric project ID in GitLab project settings. Self-managed HTTPS instances are supported. Enter the token privately after saving. Code pushes remain a separate CLI workflow.", help: "Project API URL: https://gitlab.com/api/v4/projects/123 (replace 123 with your project ID)", docs: "https://docs.gitlab.com/api/rest/authentication/"},
	{action: "add-slack", kind: connector.KindSlack, key: "S", name: "Slack", resource: "https://slack.com/api",
		detail:      "Find channels, search messages, read threads, and review messages before posting.",
		description: "Use a Slack app token from your workspace. Message search needs a user token with search:read; channel discovery needs the matching channel read scopes, and history/threads need the matching history scopes and token type. Posting additionally needs chat:write. After saving, enter the token privately and check access.",
		docs:        "https://docs.slack.dev/authentication/tokens/"},
	{action: "add-notion", kind: connector.KindNotion, key: "N", name: "Notion", resource: "https://api.notion.com/v1",
		detail:      "Search shared pages, query data sources, and review content edits.",
		description: "Use a Notion internal connection token or personal access token. For an internal connection, share the pages you want Hot Cross Buns to use through Notion's Add connections menu. Enable Read content; add Insert content or Update content only if you want reviewed edits. After saving, enter the token privately.",
		docs:        "https://developers.notion.com/guides/authorization/overview"},
	{action: "add-atlassian", kind: connector.KindAtlassian, key: "A", name: "Atlassian",
		detail:      "Search Jira issues and Confluence pages, and review updates before applying them.",
		description: "Use an access token from your organization's approved Atlassian OAuth app. Enter the API base for the site authorized by that grant, then save its token privately. Jira needs read:jira-work; Confluence needs its content read scopes. Writing needs the corresponding write scopes. Expired access tokens must be replaced; this setup does not manage an OAuth app or refresh grant.",
		help:        "Use https://api.atlassian.com/ex/jira/<cloud-id> or https://api.atlassian.com/ex/confluence/<cloud-id>. Find the cloud ID in your OAuth grant's accessible resources. Do not put tokens in the URL.",
		docs:        "https://developer.atlassian.com/cloud/jira/platform/oauth-2-3lo-apps/"},
	{action: "add-microsoft365", kind: connector.KindMicrosoft365, key: "M", name: "Microsoft 365", resource: connector.MicrosoftResource, detail: "Outlook, OneDrive, SharePoint and Teams, with reviewed email, calendar, message and file changes.", description: "Register your own public client in Microsoft Entra and enable public client/device-code flows. Enter its public application client ID and delegated Graph scopes below. The defaults allow personal mail, calendars and files to be read. Teams/SharePoint and changes need their matching additional scopes and may need administrator consent. Sign in from any browser, including when HCB runs on a Raspberry Pi.", docs: "https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-device-code"},
	{action: "add-linear", kind: connector.KindLinear, key: "I", name: "Linear", resource: "https://api.linear.app/graphql", detail: "Read teams, issues, projects and comments; review creates, updates and status changes.", description: "Create a personal API key in Linear settings with access to the teams you want to use. Restrict its permissions to the operations you need. Save the key privately after adding this connection.", docs: "https://linear.app/developers/graphql"},
	{action: "add-todoist", kind: connector.KindTodoist, key: "T", name: "Todoist", resource: "https://api.todoist.com/api/v1", detail: "Read tasks, projects, sections, labels and comments; review edits, moves and completions.", description: "Use your personal API token from Todoist Settings → Integrations → Developer. It can access your Todoist account, so review each proposed change. Save the token privately after adding the connection.", docs: "https://developer.todoist.com/api/v1/"},
	{action: "add-dropbox", kind: connector.KindDropbox, key: "D", name: "Dropbox", resource: "https://api.dropboxapi.com/2", detail: "Search and read files, metadata and revisions; review folder, move, copy, restore and sharing changes.", description: "Use a Dropbox scoped app access token. Prefer App folder access where possible; Full Dropbox is needed for existing account files outside that folder. Enable account_info.read, files.metadata.read and files.content.read for reads; add matching metadata/content write and sharing scopes only when needed. Generated access tokens can expire; reconnect privately or use chat-assisted setup with your own OAuth app for refresh tokens.", docs: "https://developers.dropbox.com/oauth-guide"},
	{action: "add-mcp", kind: connector.KindRemoteMCP, key: "P", name: "Custom MCP server", detail: "Connect to a local or remote Streamable HTTP server and map its search, read and action tools.", description: "Enter an exact HTTPS MCP endpoint, or HTTP on loopback. HCB connects outbound, including from a Raspberry Pi. Map exact tool names from the server documentation. At least search or read is required. Action calls always need exact review. Choose bearer for a private access token, none only for an intentionally unauthenticated server, or oauth with your app details. Never put credentials in URLs or chat.", help: "https://mcp.example.com/mcp or http://127.0.0.1:8000/mcp", docs: "https://modelcontextprotocol.io/specification/2025-11-25/basic/transports"},
	{action: "add-json", kind: connector.KindHTTPJSON, key: "J", name: "JSON API",
		detail:      "Read a JSON endpoint from another service using its access token.",
		description: "Connect one exact JSON resource. After saving, enter its bearer access token privately. This connection reads the configured endpoint; it does not publish changes.",
		help:        "The exact HTTPS URL that returns JSON. Do not include tokens or passwords in the URL."},
}

func serviceConnectionActions() []workapp.ControlAction {
	actions := make([]workapp.ControlAction, 0, len(connectionPresets))
	for _, preset := range connectionPresets {
		id := strings.ReplaceAll(preset.kind, "_", "-")
		a := workapp.ControlAction{Key: preset.key, Label: preset.name, Icon: preset.kind, Detail: preset.detail, Action: preset.action, Description: preset.description, Review: true,
			Fields: []workapp.ControlField{{Label: "Connection ID", Value: id, Help: "Choose a unique name for each account."}, {Label: "Display name", Value: preset.name}}}
		if preset.resource == "" {
			a.Fields = append(a.Fields, workapp.ControlField{Label: "Resource URL", Help: preset.help})
		}
		if preset.kind == connector.KindMicrosoft365 {
			a.Fields = append(a.Fields, workapp.ControlField{Label: "Public application client ID"}, workapp.ControlField{Label: "Graph delegated scopes", Value: connector.MicrosoftReadScopes, Help: "Add only needed scopes: Sites.Read.All, Team.ReadBasic.All, Channel.ReadBasic.All, ChannelMessage.Read.All, Chat.Read; changes need Mail.Send, Calendars.ReadWrite, Files.ReadWrite, ChannelMessage.Send or ChatMessage.Send. Some need administrator consent."})
		}
		if preset.kind == connector.KindRemoteMCP {
			a.Fields = append(a.Fields, workapp.ControlField{Label: "Search tool (optional)"}, workapp.ControlField{Label: "Read tool (optional)"}, workapp.ControlField{Label: "Action tool (optional)"}, workapp.ControlField{Label: "Authentication", Value: "bearer", Help: "bearer, none or oauth"}, workapp.ControlField{Label: "OAuth public client ID (oauth only)"}, workapp.ControlField{Label: "OAuth authorization URL (oauth only)"}, workapp.ControlField{Label: "OAuth token URL (oauth only)"}, workapp.ControlField{Label: "OAuth loopback redirect URL (oauth only)", Help: "On a remote host, forward this loopback port over SSH before sign-in."}, workapp.ControlField{Label: "OAuth scopes (oauth only)"})
		}
		if preset.docs != "" {
			a.Links = []uisnapshot.Link{{Label: preset.name + " setup guide", URL: preset.docs}}
		}
		actions = append(actions, a)
	}
	return actions
}

func serviceConnectionDescriptor(operation string, args []string) (connector.Descriptor, error) {
	for _, preset := range connectionPresets {
		if preset.action != operation {
			continue
		}
		expected := 2
		if preset.resource == "" {
			expected++
		}
		if preset.kind == connector.KindMicrosoft365 {
			expected += 2
		}
		if preset.kind == connector.KindRemoteMCP {
			expected += 9
		}
		if len(args) != expected {
			return connector.Descriptor{}, fmt.Errorf("provide the %s connection details", preset.name)
		}
		resource := preset.resource
		if resource == "" {
			resource = strings.TrimSpace(args[2])
		}
		d := connector.Descriptor{Version: connector.DescriptorVersion, ID: strings.TrimSpace(args[0]), Name: strings.TrimSpace(args[1]), Kind: preset.kind, Resource: resource, Authentication: connector.AuthBearer}
		if preset.kind == connector.KindMicrosoft365 {
			d.Authentication = connector.AuthOAuth
			d.OAuthClientID = strings.TrimSpace(args[2])
			d.OAuthScopes = strings.TrimSpace(args[3])
			d.OAuthAuthorizeURL = connector.MicrosoftAuthorizeURL
			d.OAuthTokenURL = connector.MicrosoftTokenURL
			d.OAuthRedirectURL = "http://127.0.0.1:0/oauth/callback"
		}
		if preset.kind == connector.KindRemoteMCP {
			d.SearchTool = strings.TrimSpace(args[3])
			d.ReadTool = strings.TrimSpace(args[4])
			d.ActionTool = strings.TrimSpace(args[5])
			d.Authentication = strings.TrimSpace(args[6])
			d.OAuthClientID = strings.TrimSpace(args[7])
			d.OAuthAuthorizeURL = strings.TrimSpace(args[8])
			d.OAuthTokenURL = strings.TrimSpace(args[9])
			d.OAuthRedirectURL = strings.TrimSpace(args[10])
			d.OAuthScopes = strings.TrimSpace(args[11])
		}
		return d, d.Validate()
	}
	return connector.Descriptor{}, fmt.Errorf("unknown service connection %q", operation)
}
