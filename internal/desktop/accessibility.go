package desktop

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"strings"
	"time"
	"unicode/utf8"
)

const MaxAccessibilityElements = 128
const MaxAccessibilityText = 16 * 1024

// AccessibilityRuntime is optional: older/unsupported drivers cannot silently
// fall back to screenshots or arbitrary coordinate input for text-only models.
type AccessibilityRuntime interface {
	ReadAccessibility(context.Context, Window) (AccessibilityTree, error)
	PerformAccessibility(context.Context, Window, AccessibilityTree, AccessibilityElement, string, string) error
}
type AccessibilityElement struct {
	Path           []int    `json:"path"`
	Role           string   `json:"role"`
	Label          string   `json:"label"`
	Value          string   `json:"value"`
	Enabled        bool     `json:"enabled"`
	Actions        []string `json:"actions"`
	ValueTruncated bool     `json:"value_truncated,omitempty"`
}
type AccessibilityTree struct {
	Title      string                 `json:"title"`
	Elements   []AccessibilityElement `json:"elements"`
	Truncated  bool                   `json:"truncated"`
	Restricted bool                   `json:"restricted"`
	Witness    []byte                 `json:"-"`
}
type Element struct {
	Ref            string   `json:"ref"`
	Role           string   `json:"role"`
	Label          string   `json:"label,omitempty"`
	Value          string   `json:"value,omitempty"`
	Enabled        bool     `json:"enabled"`
	Actions        []string `json:"actions,omitempty"`
	ValueTruncated bool     `json:"value_truncated,omitempty"`
}
type AccessibilitySnapshot struct {
	ID        string    `json:"snapshot_id"`
	Window    Window    `json:"window"`
	Elements  []Element `json:"elements"`
	Truncated bool      `json:"truncated"`
}

var ErrActionUncertain = errors.New("application did not confirm the action; desktop access is paused until private review")

type accessibilityCapture struct {
	expires    time.Time
	window     Window
	tree       AccessibilityTree
	id, policy string
	refs       map[string]AccessibilityElement
}

func (c *Controller) AccessibilityAvailable() bool {
	_, ok := c.runtime.(AccessibilityRuntime)
	return ok
}

func (c *Controller) AccessibilitySnapshot(ctx context.Context, id string) (AccessibilitySnapshot, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	delete(c.accessibility, id)
	if c.uncertain[id] {
		return AccessibilitySnapshot{}, ErrActionUncertain
	}
	session, err := c.running(id)
	if err != nil {
		return AccessibilitySnapshot{}, err
	}
	trusted, err := c.runtime.AccessibilityTrusted()
	if err != nil || !trusted {
		return AccessibilitySnapshot{}, errors.New("macOS Accessibility permission is required before reading approved apps")
	}
	window, err := c.allowedFront(ctx, session)
	if err != nil {
		return AccessibilitySnapshot{}, err
	}
	runtime, ok := c.runtime.(AccessibilityRuntime)
	if !ok {
		return AccessibilitySnapshot{}, errors.New("this desktop runtime has no accessibility driver")
	}
	tree, err := runtime.ReadAccessibility(ctx, window)
	if err != nil {
		return AccessibilitySnapshot{}, err
	}
	if err := validateAccessibilityTree(tree); err != nil {
		return AccessibilitySnapshot{}, err
	}
	if _, err = c.running(id); err != nil {
		return AccessibilitySnapshot{}, err
	}
	fresh, err := c.allowedFront(ctx, session)
	if err != nil || !sameWindow(window, fresh) {
		return AccessibilitySnapshot{}, errors.New("desktop window changed while reading; inspect it again")
	}
	bytes := make([]byte, 16)
	if _, err := rand.Read(bytes); err != nil {
		return AccessibilitySnapshot{}, err
	}
	capture := accessibilityCapture{expires: time.Now().Add(5 * time.Minute), window: window, tree: cloneAccessibilityTree(tree), id: hex.EncodeToString(bytes), policy: PolicyDigest(session), refs: map[string]AccessibilityElement{}}
	out := AccessibilitySnapshot{ID: capture.id, Window: window, Truncated: tree.Truncated, Elements: []Element{}}
	out.Window.Title = tree.Title
	for i, node := range capture.tree.Elements {
		ref := fmt.Sprintf("e%d", i+1)
		capture.refs[ref] = node
		out.Elements = append(out.Elements, Element{Ref: ref, Role: node.Role, Label: node.Label, Value: node.Value, Enabled: node.Enabled, Actions: append([]string{}, node.Actions...), ValueTruncated: node.ValueTruncated})
	}
	c.accessibility[id] = capture
	return out, nil
}

// DescribeAccessibilityAction freezes the same target shown in the review.
// It neither changes focus nor executes input. Native paths/witnesses stay private.
func (c *Controller) DescribeAccessibilityAction(ctx context.Context, id, snapshot, ref, action, value string) (string, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	capture, node, err := c.accessibilityTarget(id, snapshot, ref, action, value)
	if err != nil {
		return "", err
	}
	description := fmt.Sprintf("Return to approved %s window %q; %s %s %q (%s)", capture.window.Application.BundleID, capture.tree.Title, action, node.Role, node.Label, ref)
	if action == "set_value" {
		description += fmt.Sprintf("; current field content %q", node.Value)
	}
	return description, nil
}
func (c *Controller) AccessibilityAction(ctx context.Context, id, snapshot, ref, action, value string) (Window, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	capture, node, err := c.accessibilityTarget(id, snapshot, ref, action, value)
	if err != nil {
		return Window{}, err
	}
	delete(c.accessibility, id)
	trusted, err := c.runtime.AccessibilityTrusted()
	if err != nil || !trusted {
		return Window{}, errors.New("Accessibility permission is no longer available")
	}
	// Approval happens in HCB. Returning to the frozen target is part of the
	// reviewed action; recheck its window identity and bounds before dispatch.
	if err := c.runtime.Activate(ctx, capture.window.Application.BundleID); err != nil {
		return Window{}, err
	}
	session, err := c.running(id)
	if err != nil {
		return Window{}, err
	}
	window, err := c.allowedFront(ctx, session)
	if err != nil || !sameWindow(capture.window, window) {
		return Window{}, errors.New("approved desktop window changed; take a new snapshot and review again")
	}
	runtime, ok := c.runtime.(AccessibilityRuntime)
	if !ok {
		return Window{}, errors.New("accessibility driver is unavailable")
	}
	fresh, err := runtime.ReadAccessibility(ctx, window)
	if err != nil {
		return Window{}, err
	}
	if err = validateAccessibilityTree(fresh); err != nil {
		return Window{}, err
	}
	if treeDigest(fresh) != treeDigest(capture.tree) {
		return Window{}, errors.New("desktop controls changed since the snapshot; inspect and review again")
	}
	if _, err = c.running(id); err != nil {
		return Window{}, err
	}
	if err = runtime.PerformAccessibility(ctx, window, fresh, node, action, value); err != nil {
		if errors.Is(err, ErrActionUncertain) {
			c.uncertain[id] = true
			_, pauseErr := c.store.SetPaused(id, true)
			return Window{}, errors.Join(err, pauseErr)
		}
		return Window{}, err
	}
	return window, nil
}
func (c *Controller) accessibilityTarget(id, snapshot, ref, action, value string) (accessibilityCapture, AccessibilityElement, error) {
	if c.uncertain[id] {
		return accessibilityCapture{}, AccessibilityElement{}, ErrActionUncertain
	}
	session, err := c.running(id)
	if err != nil {
		return accessibilityCapture{}, AccessibilityElement{}, err
	}
	capture, ok := c.accessibility[id]
	if !ok || snapshot == "" || capture.id != snapshot || time.Now().After(capture.expires) || capture.policy != PolicyDigest(session) {
		return capture, AccessibilityElement{}, errors.New("desktop snapshot expired; inspect the approved window again")
	}
	node, ok := capture.refs[ref]
	if !ok || !node.Enabled || !slices.Contains(node.Actions, action) {
		return capture, node, errors.New("that desktop control/action is unavailable in this snapshot")
	}
	if action == "set_value" {
		if node.ValueTruncated || len(value) > 8192 || !utf8.ValidString(value) || strings.ContainsRune(value, 0) {
			return capture, node, errors.New("set_value needs complete prior field content and at most 8192 valid UTF-8 bytes; use private takeover for secrets")
		}
	} else if value != "" {
		return capture, node, errors.New("only set_value accepts a value")
	}
	return capture, node, nil
}
func validateAccessibilityTree(tree AccessibilityTree) error {
	if tree.Restricted {
		return errors.New("a sensitive field, file dialog or modal sheet is present; take over privately before continuing")
	}
	if len(tree.Elements) > MaxAccessibilityElements {
		return errors.New("accessibility snapshot exceeds its element bound")
	}
	size := len(tree.Title)
	for _, node := range tree.Elements {
		if len(node.Path) > 12 || node.Role == "" || len(node.Role) > 128 {
			return errors.New("invalid accessibility control path or role")
		}
		for _, index := range node.Path {
			if index < 0 || index > 4096 {
				return errors.New("invalid accessibility child index")
			}
		}
		size += len(node.Label) + len(node.Value) + len(node.Role)
		for _, action := range node.Actions {
			if !slices.Contains([]string{"press", "increment", "decrement", "set_value"}, action) {
				return errors.New("unsupported accessibility action")
			}
		}
		if slices.Contains(node.Actions, "set_value") && !slices.Contains([]string{"AXTextField", "AXTextArea", "AXComboBox"}, node.Role) {
			return errors.New("non-text desktop controls cannot accept text values")
		}
		if node.ValueTruncated && slices.Contains(node.Actions, "set_value") {
			return errors.New("cannot replace a partially inspected field")
		}
	}
	if size > MaxAccessibilityText+4096 {
		return errors.New("accessibility text exceeds its bound")
	}
	return nil
}
func sameWindow(a, b Window) bool {
	return a.ID == b.ID && a.PID == b.PID && a.Application.BundleID == b.Application.BundleID && a.X == b.X && a.Y == b.Y && a.Width == b.Width && a.Height == b.Height
}
func treeDigest(tree AccessibilityTree) [32]byte {
	encoded, _ := json.Marshal(tree)
	return sha256.Sum256(encoded)
}

func cloneAccessibilityTree(tree AccessibilityTree) AccessibilityTree {
	tree.Elements = append([]AccessibilityElement(nil), tree.Elements...)
	tree.Witness = append([]byte(nil), tree.Witness...)
	for i := range tree.Elements {
		tree.Elements[i].Path = append([]int(nil), tree.Elements[i].Path...)
		tree.Elements[i].Actions = append([]string(nil), tree.Elements[i].Actions...)
	}
	return tree
}
