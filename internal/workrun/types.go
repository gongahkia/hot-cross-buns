// Package workrun orchestrates provider-independent, non-Git Work sessions.
// Coding is shared by the conversation runner and bounded specialists; its
// isolated execution engine returns evidence without modifying live source.
package workrun

import (
	"context"
	"encoding/json"
	"github.com/gongahkia/hot-cross-buns/internal/knowledge"
	"time"

	"github.com/gongahkia/hot-cross-buns/internal/action"
	"github.com/gongahkia/hot-cross-buns/internal/agent"
	"github.com/gongahkia/hot-cross-buns/internal/artifact"
	"github.com/gongahkia/hot-cross-buns/internal/attachment"
	"github.com/gongahkia/hot-cross-buns/internal/browser"
	"github.com/gongahkia/hot-cross-buns/internal/cliagent"
	"github.com/gongahkia/hot-cross-buns/internal/codeexec"
	"github.com/gongahkia/hot-cross-buns/internal/connector"
	"github.com/gongahkia/hot-cross-buns/internal/desktop"
	"github.com/gongahkia/hot-cross-buns/internal/fileaccess"
	"github.com/gongahkia/hot-cross-buns/internal/orchestrator"
	"github.com/gongahkia/hot-cross-buns/internal/projectcapture"
	"github.com/gongahkia/hot-cross-buns/internal/sandbox"
	"github.com/gongahkia/hot-cross-buns/internal/scheduleaccess"
	"github.com/gongahkia/hot-cross-buns/internal/snapshot"
	"github.com/gongahkia/hot-cross-buns/internal/tools"
	"github.com/gongahkia/hot-cross-buns/internal/workactivity"
	"github.com/gongahkia/hot-cross-buns/internal/workhistory"
	"github.com/gongahkia/hot-cross-buns/internal/worksession"
	"github.com/gongahkia/hot-cross-buns/internal/workspace"
)

const (
	CodeCapabilityLSP       = "lsp"
	CodeCapabilityMCP       = "mcp"
	CodeCapabilityExtension = "extension"
	CodeCapabilityHTTP      = "http"
	CodeCapabilityBrowser   = "browser"
	CodeCapabilityTerminal  = "terminal"
	CodeCapabilityHooks     = "hooks"
)

// CodePolicy is the user-owned capability envelope for Hot Cross Buns's internal Code
// tools and specialists. The Work manager can code or delegate, but it cannot
// widen this policy. Empty policies deliberately resolve to strict, offline
// execution with only the built-in patch tools and verifier commands.
type CodePolicy struct {
	MaxSteps               int
	Verification           [][]string
	Scopes                 []string
	Profile                string
	Setup                  [][]string
	AllowedCommands        [][]string
	AllowedCommandPrefixes [][]string
	Sandbox                sandbox.Policy
	Capabilities           []string
	BrowserSession         string
}

// HasCapability reports an explicit per-Work-run grant. Configuration and
// project trust remain necessary but are never sufficient by themselves.
func (p CodePolicy) HasCapability(name string) bool {
	for _, capability := range p.Capabilities {
		if capability == name {
			return true
		}
	}
	return false
}

// Request describes one bounded local work session.
type Request struct {
	// OriginConversationID is supplied only after the application verifies an
	// immutable dialogue task origin. Execution ownership remains ConversationID.
	OriginConversationID  string `json:"-"`
	ConversationContext   string
	TaskPlan              *TaskPlanReference `json:",omitempty"`
	reviewedPlan          *worksession.TaskPlan
	ExternalAgents        []cliagent.Config
	ReplyToUpdateID       string
	UpdateContext         string
	InputIDs              []string
	ForegroundApp         bool
	ScheduledJobID        string            `json:"-"`
	ScheduledJobPolicy    string            `json:"-"`
	CheckScheduledFiles   func() error      `json:"-"`
	ApproveFilesystem     fileaccess.Decide `json:"-"`
	FilesystemProtected   []string
	files                 *fileaccess.Task
	LearnFromChats        bool
	MaintainMemory        bool
	DisableChatHistory    bool
	ApproveAppChange      func(context.Context, any) (bool, error)
	ApproveScheduleChange func(context.Context, scheduleaccess.Review) (string, error)
	OnAppChange           func(AppChange)
	AfterAppRun           func(AppChange, AppMutation)
	queueAppChange        func(AppChange, AppMutation)
	DisabledRoles         []string
	RoleConfiguration     map[string]orchestrator.RoleConfiguration
	OnSupervisor          func(*orchestrator.Supervisor)
	OTLPEndpoint          string
	Limits                agent.Limits
	Budget                *agent.Budget
	WebOrigins            []string
	// ApproveWebAccess reviews an additional read-only grant for this task.
	// Only the foreground owner can supply it; it is never retained as a grant.
	ApproveWebAccess        func(context.Context, WebAccessReview) (bool, error)
	catalog                 *evidenceCatalog
	researchTools           []agent.Tool
	DisableDelegation       bool
	integration             *codeIntegration
	Project                 *projectcapture.Bundle
	Provider                string
	SourcePath              string
	IgnoredInstructionPaths []string
	Objective               string
	RunID                   string
	RequestedAt             time.Time
	PreparationContext      context.Context
	// EnableControl exposes stop and steering for this foreground run through a
	// private loopback endpoint. It never grants action approval authority.
	EnableControl         bool
	controlSteering       chan string
	controlRespond        func(int, string, bool) error
	controlCancelTask     func(string) error
	controlSteerTask      func(string, string) error
	controlAnswerTask     func(string, string, map[string][]string) error
	controlPending        func() int
	controlInspectTask    func(string) (orchestrator.Task, error)
	controlReview         func(int) (Interaction, string, error)
	controlExecutionCheck func() error
	MaxSteps              int
	Mode                  action.Mode
	// DecisionOrigin identifies how the host chose this run's route. It is
	// observational metadata and cannot widen Mode or any tool grant.
	DecisionOrigin string
	DecisionReason string
	Decision       *workhistory.Decision
	Contract       artifact.Contract
	StateDir       string
	System         string
	// LearningContext is a bounded projection of applicable active learnings.
	// It is supplied by the application boundary; candidates never appear here.
	LearningContext string
	// MemoryContext is a bounded selection of explicit user memories.
	MemoryContext string
	// NoteContext names relevant saved notes with short excerpts. Full note text
	// remains available through knowledge_read and is never tool authority.
	NoteContext          string
	ContextRefs          []string
	RecallTrace          []knowledge.RecallTrace
	ContextItems         []workhistory.ContextItem
	ExcludedKnowledgeIDs []string
	RecallStatus         string
	GoalID               string
	// GoalContext is explicitly user-maintained ongoing context. It conveys
	// neither tool authority nor an instruction that overrides the current task.
	GoalContext          string
	GoalPlanContext      string
	OnEvent              agent.EventSink
	Steering             <-chan string
	ConnectorIDs         []string
	CredentialPins       map[string]string
	OAuthRefreshPins     map[string]string
	OAuthAccountPins     map[string]string
	ApproveAction        action.Approver
	ApproveConnectorRead func(context.Context, string, string, json.RawMessage) (bool, error)
	ConversationID       string
	ParentRevisionID     string
	SnapshotID           string
	RefreshSource        bool
	ConnectorPermissions connector.PermissionSet
	SnapshotOptions      snapshot.Options
	OnSnapshot           func(snapshot.Manifest)
	Images               []agent.Image
	Attachments          []agent.Attachment
	// OriginalFiles contains only this admitted request's explicitly selected
	// inputs. Raw originals never enter provider messages or serialized requests.
	OriginalFiles []attachment.Original `json:"-"`
	// BrowserSession is an explicit developer-selected local browser session
	// granted to the Work manager itself. It is intentionally separate from
	// Code.BrowserSession: the manager cannot silently borrow a Code grant.
	BrowserSession string
	BrowserPolicy  string
	// DisableBrowser is an explicit per-request opt-out. Browser access still
	// requires the captured session grant, regardless of the model provider.
	DisableBrowser bool
	// ApproveBrowser is invoked for every browser mutation. Unlike command
	// approval, an "always" decision is never remembered by browser tools.
	ApproveBrowser func(context.Context, []string) (tools.CommandDecision, error)
	// DesktopSession is an explicit macOS app allowlist capability. Tools use
	// native accessibility references or an explicitly enabled computer protocol.
	DesktopSession string
	DesktopPolicy  string
	ApproveDesktop func(context.Context, []string) (tools.CommandDecision, error)
	// RequireCode is reserved for internal evaluation of patch evidence.
	// EnableCode grants isolated coding tools and the bounded coding specialist
	// without requiring a patch for every turn. Inspect mode remains read-only.
	EnableCode         bool
	RequireCode        bool
	Code               CodePolicy
	ApproveCodeCommand func(context.Context, []string) (tools.CommandDecision, error)
}

func (r Request) codeEnabled() bool { return r.EnableCode || r.RequireCode }
func (r Request) externalEditsEnabled() bool {
	if r.DisableDelegation {
		return false
	}
	for _, cfg := range r.ExternalAgents {
		disabled := false
		for _, role := range r.DisabledRoles {
			if role == cfg.Role() {
				disabled = true
			}
		}
		if cfg.AllowEdits && !disabled {
			return true
		}
	}
	return false
}

// Outcome retains staged files and trusted evidence even when model execution
// fails. Source is never modified by the executor.
type Outcome struct {
	Recovery *worksession.RequestRecovery
	// ParentArtifacts is copied from the independently verified parent bundle.
	// It distinguishes retained output from changes made by this execution.
	ParentArtifacts  []artifact.File
	ParentOutput     workspace.Root
	Activity         *workactivity.Trace
	Work             workspace.Work
	Manifest         artifact.Manifest
	Result           agent.Result
	Events           []agent.Event
	ConversationID   string
	RevisionID       string
	ParentRevisionID string
	SnapshotID       string
	SourceSnapshot   snapshot.Manifest
}

// CodeRequest asks Hot Cross Buns's Code specialist to work against the exact
// frozen source selected by a Work run. The implementation must isolate all
// writes and return a reviewable patch rather than mutate SourcePath.
type CodeRequest struct {
	Filesystem  *fileaccess.Task
	OnEvent     agent.EventSink
	Budget      *agent.Budget
	Baseline    []byte
	Project     *projectcapture.Bundle
	ID          string
	SourcePath  string
	ScratchPath string
	Task        string
	ParentRunID string
	MaxSteps    int
	Policy      CodePolicy
	Approve     func(context.Context, []string) (tools.CommandDecision, error)
}

// CodeResult is the bounded handoff from Hot Cross Buns Code back to Hot Cross Buns Work.
type CodeResult struct {
	BaselineSHA256 string
	Usage          agent.Usage
	Summary        string
	Patch          []byte
	ChangedPaths   []string
	Steps          int
}

// CodeSession exposes the same isolated harness to the conversation runner and
// to bounded delegates. Finish exports evidence; it never applies to live source.
type CodeSession struct {
	Harness *codeexec.Prepared
	Model   agent.Model
	Finish  func(context.Context, agent.Result) (CodeResult, error)
}
type CodeSessionFactory func(context.Context, CodeRequest) (*CodeSession, error)

// CodeDelegate adapts Hot Cross Buns's isolated coding workflow into a Work specialist.
type CodeDelegate func(context.Context, CodeRequest) (CodeResult, error)

// Executor combines a provider-independent model with private workspace
// allocation and artifact sealing.
type Executor struct {
	App               AppController
	RoleConfiguration map[string]orchestrator.RoleConfiguration
	RoleSteps         map[string]int
	HTTP              tools.HTTPFetchOptions
	RoleModels        map[string]agent.Model
	Model             agent.Model
	Now               func() time.Time
	StateDir          string
	Connectors        connector.Runtime
	Code              CodeDelegate
	CodeSession       CodeSessionFactory
	// Browser is the private local controller for an explicitly granted Work
	// browser session. A nil value fails closed if BrowserSession is requested.
	Browser browser.Controller
	Desktop *desktop.Controller
}
