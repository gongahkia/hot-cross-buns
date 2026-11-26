package tools

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"github.com/gongahkia/hot-cross-buns/internal/document"
	"testing"

	"github.com/gongahkia/hot-cross-buns/internal/artifact"
	"github.com/gongahkia/hot-cross-buns/internal/workspace"
)

func TestPresentationToolSchemaExposesVisibleSlideBody(t *testing.T) {
	definition := (WritePresentationArtifact{}).Definition()
	var spec struct {
		Properties map[string]struct {
			Properties map[string]struct {
				Items struct {
					Required   []string                   `json:"required"`
					Properties map[string]json.RawMessage `json:"properties"`
				} `json:"items"`
			} `json:"properties"`
		} `json:"properties"`
	}
	if err := json.Unmarshal(definition.Parameters, &spec); err != nil {
		t.Fatalf("presentation tool has invalid JSON schema: %v", err)
	}
	slides := spec.Properties["presentation"].Properties["slides"].Items
	if _, ok := slides.Properties["body"]; !ok {
		t.Fatal("model cannot see the visible slide body field")
	}
	for _, name := range slides.Required {
		if name == "body" {
			return
		}
	}
	t.Fatal("visible slide body is not required")
}

func TestWriteWorkbookWithoutTemplate(t *testing.T) {
	output, err := workspace.Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	tool := WriteWorkbookArtifact{Root: output, Contract: artifact.DefaultContract("book.xlsx")}
	_, err = tool.Execute(context.Background(), json.RawMessage(`{"path":"book.xlsx","workbook":{"title":"Smoke","sheets":[{"name":"Data","columns":[{"header":"Value"}],"rows":[[{"value":7}]]}]}}`))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := output.ReadRegularFile("book.xlsx", 16*1024*1024); err != nil {
		t.Fatal(err)
	}
}

func TestEditSelectedWordOriginalIntoStagedOutput(t *testing.T) {
	original, _, err := document.RenderDOCX(document.Spec{Title: "Letter", Blocks: []document.Block{{Kind: "paragraph", Text: "Hello Alex"}}})
	if err != nil {
		t.Fatal(err)
	}
	output, _ := workspace.Open(t.TempDir())
	calls := 0
	tool := EditDocumentArtifact{Root: output, Contract: artifact.DefaultContract("letter.docx"), ResolveSource: func(source string, limit int64) ([]byte, error) {
		calls++
		if source != "input/selected/letter.docx" {
			return nil, errors.New("unselected original")
		}
		return append([]byte(nil), original...), nil
	}}
	_, err = tool.Execute(context.Background(), json.RawMessage(`{"path":"letter.docx","source":"input/selected/letter.docx","text_edits":[{"find":"Alex","replace":"Sam"}]}`))
	if err != nil {
		t.Fatal(err)
	}
	if calls != 1 {
		t.Fatal("selected original was not used")
	}
	edited, err := output.ReadRegularFile("letter.docx", 64<<20)
	if err != nil || bytes.Equal(original, edited) {
		t.Fatal("staged edit missing", err)
	}
	if _, err = tool.Execute(context.Background(), json.RawMessage(`{"path":"other.docx","source":"input/unselected/letter.docx","text_edits":[{"find":"Alex","replace":"Sam"}]}`)); err == nil {
		t.Fatal("unselected upload edited")
	}
}
