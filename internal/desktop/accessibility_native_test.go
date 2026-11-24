//go:build darwin && cgo

package desktop

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// This opt-in acceptance test only operates on its own disposable AppKit app.
func TestNativeAccessibilityAcceptance(t *testing.T) {
	if os.Getenv("HCB_DESKTOP_NATIVE_SMOKE") != "1" {
		t.Skip("set HCB_DESKTOP_NATIVE_SMOKE=1 for the disposable native app acceptance test")
	}
	runtime := DefaultRuntime()
	trusted, err := runtime.AccessibilityTrusted()
	if err != nil {
		t.Fatal(err)
	}
	if !trusted {
		t.Skip("No access: macOS Accessibility permission is unavailable to this test runtime")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	app := filepath.Join(t.TempDir(), "HCBFixture.app")
	contents := filepath.Join(app, "Contents")
	binary := filepath.Join(contents, "MacOS", "fixture")
	if err := os.MkdirAll(filepath.Dir(binary), 0700); err != nil {
		t.Fatal(err)
	}
	info := `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>dev.hotcrossbuns.desktop-fixture</string><key>CFBundleExecutable</key><string>fixture</string><key>CFBundleName</key><string>HCB Fixture</string><key>CFBundlePackageType</key><string>APPL</string></dict></plist>`
	if err := os.WriteFile(filepath.Join(contents, "Info.plist"), []byte(info), 0600); err != nil {
		t.Fatal(err)
	}
	command := exec.CommandContext(ctx, "/usr/bin/clang", "-framework", "AppKit", "-o", binary, "testdata/accessibility_fixture.m")
	if output, err := command.CombinedOutput(); err != nil {
		t.Fatalf("compile fixture: %v: %s", err, output)
	}
	process := exec.CommandContext(ctx, binary)
	if err := process.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = process.Process.Kill(); _ = process.Wait() })
	bundle := "dev.hotcrossbuns.desktop-fixture"
	var window Window
	for until := time.Now().Add(5 * time.Second); time.Now().Before(until); {
		window, err = runtime.FrontWindow(ctx)
		if err == nil && window.Application.BundleID == bundle {
			break
		}
		time.Sleep(50 * time.Millisecond)
	}
	if err != nil || window.Application.BundleID != bundle {
		t.Fatalf("fixture did not become foreground: %v", err)
	}
	store, _ := Open(t.TempDir())
	session, err := store.Start(StartOptions{Apps: []Application{{BundleID: bundle}}})
	if err != nil {
		t.Fatal(err)
	}
	controller, _ := NewController(store, runtime)
	snapshot, err := controller.AccessibilitySnapshot(ctx, session.ID)
	if err != nil {
		t.Fatal(err)
	}
	var field string
	for _, node := range snapshot.Elements {
		if node.Role == "AXTextField" && strings.Contains(strings.Join(node.Actions, " "), "set_value") {
			field = node.Ref
		}
	}
	if field == "" {
		t.Fatalf("no writable fixture field: %+v", snapshot)
	}
	if _, err = controller.AccessibilityAction(ctx, session.ID, snapshot.ID, field, "set_value", "Native fixture verified"); err != nil {
		t.Fatal(err)
	}
	snapshot, err = controller.AccessibilitySnapshot(ctx, session.ID)
	if err != nil {
		t.Fatal(err)
	}
	found := false
	button := ""
	for _, node := range snapshot.Elements {
		found = found || node.Value == "Native fixture verified"
		if node.Role == "AXButton" && node.Label == "Apply fixture" {
			button = node.Ref
		}
	}
	if !found || button == "" {
		t.Fatalf("native field/button unavailable: %+v", snapshot)
	}
	if _, err = controller.AccessibilityAction(ctx, session.ID, snapshot.ID, button, "press", ""); err != nil {
		t.Fatal(err)
	}
	snapshot, err = controller.AccessibilitySnapshot(ctx, session.ID)
	if err != nil {
		t.Fatal(err)
	}
	found = false
	for _, node := range snapshot.Elements {
		found = found || node.Value == "Applied fixture"
	}
	if !found {
		t.Fatalf("native button outcome not observed: %+v", snapshot)
	}
}
