//go:build darwin && cgo

package desktop

/*
#include <stdlib.h>
char *hcb_desktop_applications(void);
char *hcb_desktop_accessibility_snapshot(int pid,double x,double y,double width,double height);
int hcb_desktop_accessibility_perform(int pid,double x,double y,double width,double height,const char *witness,const int *path,int count,int action,const char *value);
*/
import "C"
import (
	"context"
	"encoding/json"
	"errors"
	"unsafe"
)

func (darwinRuntime) ReadAccessibility(ctx context.Context, window Window) (AccessibilityTree, error) {
	if err := ctx.Err(); err != nil {
		return AccessibilityTree{}, err
	}
	raw := C.hcb_desktop_accessibility_snapshot(C.int(window.PID), C.double(window.X), C.double(window.Y), C.double(window.Width), C.double(window.Height))
	if raw == nil {
		return AccessibilityTree{}, errors.New("could not read the approved focused window; check Accessibility access and inspect again")
	}
	defer C.free(unsafe.Pointer(raw))
	data := []byte(C.GoString(raw))
	var tree AccessibilityTree
	if len(data) > 128*1024 || json.Unmarshal(data, &tree) != nil {
		return tree, errors.New("invalid or oversized accessibility snapshot")
	}
	tree.Witness = data
	return tree, ctx.Err()
}
func (darwinRuntime) PerformAccessibility(ctx context.Context, window Window, tree AccessibilityTree, node AccessibilityElement, action, value string) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	code := map[string]int{"press": 1, "increment": 2, "decrement": 3, "set_value": 4}[action]
	if code == 0 || len(tree.Witness) == 0 {
		return errors.New("invalid accessibility action or missing witness")
	}
	witness := C.CString(string(tree.Witness))
	defer C.free(unsafe.Pointer(witness))
	text := C.CString(value)
	defer C.free(unsafe.Pointer(text))
	path := make([]C.int, len(node.Path))
	for i, index := range node.Path {
		path[i] = C.int(index)
	}
	var first *C.int
	if len(path) > 0 {
		first = &path[0]
	}
	result := C.hcb_desktop_accessibility_perform(C.int(window.PID), C.double(window.X), C.double(window.Y), C.double(window.Width), C.double(window.Height), witness, first, C.int(len(path)), C.int(code), text)
	switch result {
	case 1:
		return nil
	case 2:
		return errors.New("desktop control changed before dispatch; inspect and review again")
	case 3:
		return ErrActionUncertain
	default:
		return errors.New("macOS rejected this accessibility action; inspect the app before continuing")
	}
}

func (darwinRuntime) Applications(ctx context.Context) ([]Application, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	raw := C.hcb_desktop_applications()
	if raw == nil {
		return nil, errors.New("could not list running macOS applications")
	}
	defer C.free(unsafe.Pointer(raw))
	var apps []Application
	if err := json.Unmarshal([]byte(C.GoString(raw)), &apps); err != nil {
		return nil, err
	}
	return apps, ctx.Err()
}
