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
		if len(args) != expected {
			return connector.Descriptor{}, fmt.Errorf("provide the %s connection details", preset.name)
		}
		resource := preset.resource
		if resource == "" {
			resource = strings.TrimSpace(args[2])
		}
		return connector.Descriptor{Version: connector.DescriptorVersion, ID: strings.TrimSpace(args[0]), Name: strings.TrimSpace(args[1]), Kind: preset.kind, Resource: resource, Authentication: connector.AuthBearer}, nil
	}
	return connector.Descriptor{}, fmt.Errorf("unknown service connection %q", operation)
}
