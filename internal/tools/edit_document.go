package tools

import (
	"context"
	"encoding/json"
	"errors"
	"path/filepath"
	"strings"

	"github.com/gongahkia/hot-cross-buns/internal/agent"
	"github.com/gongahkia/hot-cross-buns/internal/artifact"
	"github.com/gongahkia/hot-cross-buns/internal/document"
	"github.com/gongahkia/hot-cross-buns/internal/workspace"
)

type EditDocumentArtifact struct {
	Root          workspace.Root
	Source        workspace.Root
	Contract      artifact.Contract
	ResolveSource func(string, int64) ([]byte, error)
	OnRenderer    func(artifact.RendererEvidence)
}

func (t EditDocumentArtifact) Definition() agent.ToolDefinition {
	return agent.ToolDefinition{Name: "work_edit_document", Description: "Edit an existing DOCX or PDF into a staged output copy. DOCX exact text replacements span formatting runs within a paragraph and require expected_count (default 1); unmatched or ambiguous edits fail. Formatting and untouched archive parts are preserved. PDF supports rotate, collect (select/reorder/duplicate pages), remove, and stamp (visible text overlay, never secure redaction or semantic replacement). Original bytes remain unchanged. Source accepts selected input/... originals or source/..., previous/... and output/... mounts. Inspect the result before publishing; native layout fidelity is not established by package validation.", Parameters: schema(`{"type":"object","additionalProperties":false,"required":["path","source"],"properties":{"path":{"type":"string"},"source":{"type":"string"},"text_edits":{"type":"array","maxItems":256,"items":{"type":"object","additionalProperties":false,"required":["find","replace"],"properties":{"part":{"type":"string"},"find":{"type":"string"},"replace":{"type":"string"},"expected_count":{"type":"integer","minimum":1,"maximum":1000}}}},"pdf_edits":{"type":"array","maxItems":32,"items":{"type":"object","additionalProperties":false,"required":["operation","pages"],"properties":{"operation":{"enum":["rotate","collect","remove","stamp"]},"pages":{"type":"array","minItems":1,"maxItems":1000,"items":{"type":"integer","minimum":1}},"rotation":{"enum":[90,180,270]},"text":{"type":"string","maxLength":2048}}}}}}`)}
}
func readArtifactSource(root workspace.Root, source string, resolve func(string, int64) ([]byte, error)) ([]byte, error) {
	if resolve != nil {
		if !strings.Contains(source, "/") || !strings.HasPrefix(source, "input/") && !strings.HasPrefix(source, "source/") && !strings.HasPrefix(source, "previous/") && !strings.HasPrefix(source, "output/") {
			source = "source/" + source
		}
		return resolve(source, 64<<20)
	}
	if strings.HasPrefix(source, "input/") || strings.HasPrefix(source, "previous/") || strings.HasPrefix(source, "output/") {
		return nil, errors.New("this file mount is not available")
	}
	return root.ReadRegularFile(filepath.FromSlash(strings.TrimPrefix(source, "source/")), 64<<20)
}
func (t EditDocumentArtifact) Execute(ctx context.Context, raw json.RawMessage) (agent.ToolResult, error) {
	var in struct {
		Path   string              `json:"path"`
		Source string              `json:"source"`
		Text   []document.TextEdit `json:"text_edits"`
		PDF    []document.PDFEdit  `json:"pdf_edits"`
	}
	if err := decodeArguments(raw, &in); err != nil {
		return agent.ToolResult{}, err
	}
	if in.Path == "" || in.Source == "" || strings.ToLower(filepath.Ext(in.Source)) != strings.ToLower(filepath.Ext(in.Path)) {
		return agent.ToolResult{}, errors.New("choose matching source and output DOCX or PDF extensions")
	}
	original, err := readArtifactSource(t.Source, in.Source, t.ResolveSource)
	if err != nil {
		return agent.ToolResult{}, err
	}
	var data []byte
	var preview document.Preview
	switch strings.ToLower(filepath.Ext(in.Path)) {
	case ".docx":
		if len(in.PDF) > 0 {
			return agent.ToolResult{}, errors.New("PDF operations require a PDF")
		}
		data, preview, err = document.EditDOCX(original, in.Text)
	case ".pdf":
		if len(in.Text) > 0 {
			return agent.ToolResult{}, errors.New("PDF text replacement is unsupported; use an explicit visible stamp or reconstruct a new document")
		}
		data, preview, err = document.EditPDF(ctx, original, in.PDF)
	default:
		return agent.ToolResult{}, errors.New("editable documents are DOCX and PDF")
	}
	if err != nil {
		return agent.ToolResult{}, err
	}
	if err = artifact.WriteBinary(t.Root, t.Contract, in.Path, data); err != nil {
		return agent.ToolResult{}, err
	}
	evidence, err := artifact.NewRendererEvidence(in.Path, "hot-cross-buns.document.v1", in, original, data)
	if err != nil {
		return agent.ToolResult{}, err
	}
	if t.OnRenderer != nil {
		t.OnRenderer(evidence)
	}
	result, err := success(map[string]any{"path": in.Path, "bytes": len(data), "preview": preview, "original_unchanged": true})
	return agent.ToolResult{Content: result}, err
}
