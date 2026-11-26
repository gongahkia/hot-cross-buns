package document

import (
	"archive/zip"
	"bytes"
	"context"
	"io"
	"strings"
	"testing"
)

func TestDOCXEditsAcrossFormattedRunsPreserveUnrelatedParts(t *testing.T) {
	var source bytes.Buffer
	writer := zip.NewWriter(&source)
	parts := map[string]string{"[Content_Types].xml": "<Types/>", "word/document.xml": `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Hello </w:t></w:r><w:r><w:t>world &amp; team</w:t></w:r></w:p></w:body></w:document>`, "word/styles.xml": "untouched style bytes"}
	for name, body := range parts {
		out, _ := writer.Create(name)
		out.Write([]byte(body))
	}
	writer.Close()
	result, _, err := EditDOCX(source.Bytes(), []TextEdit{{Find: "Hello world", Replace: "Hi everyone"}})
	if err != nil {
		t.Fatal(err)
	}
	archive, _ := zip.NewReader(bytes.NewReader(result), int64(len(result)))
	for _, file := range archive.File {
		reader, _ := file.Open()
		data, _ := io.ReadAll(reader)
		reader.Close()
		if file.Name == "word/document.xml" {
			if !bytes.Contains(data, []byte("Hi everyone")) || !bytes.Contains(data, []byte("<w:b/>")) || !bytes.Contains(data, []byte(" &amp; team")) {
				t.Fatalf("text/format damaged: %s", data)
			}
		} else if string(data) != parts[file.Name] {
			t.Fatal("unrelated bytes changed")
		}
	}
	if _, _, err = EditDOCX(source.Bytes(), []TextEdit{{Find: "missing", Replace: "x"}}); err == nil {
		t.Fatal("unmatched edit accepted")
	}
	if _, _, err = EditDOCX(source.Bytes(), []TextEdit{{Find: "Hello world", Replace: "x", Expected: 2}}); err == nil {
		t.Fatal("wrong count accepted")
	}
}
func TestPDFPageEditingAndVisibleStamp(t *testing.T) {
	original, _, err := RenderPDF(Spec{Title: "PDF", Blocks: []Block{{Kind: "paragraph", Text: "First"}, {Kind: "page_break"}, {Kind: "paragraph", Text: "Second"}}})
	if err != nil {
		t.Fatal(err)
	}
	result, preview, err := EditPDF(context.Background(), original, []PDFEdit{{Operation: "collect", Pages: []int{2, 1, 2}}, {Operation: "rotate", Pages: []int{1}, Rotation: 90}, {Operation: "stamp", Pages: []int{1}, Text: "DRAFT"}, {Operation: "remove", Pages: []int{3}}})
	if err != nil || preview.Pages != 2 || !bytes.HasPrefix(result, []byte("%PDF")) {
		t.Fatalf("PDF editing: %#v %v", preview, err)
	}
	if _, _, err = EditPDF(context.Background(), original, []PDFEdit{{Operation: "remove", Pages: []int{1, 2}}}); err == nil {
		t.Fatal("removed all pages")
	}
	if _, _, err = EditPDF(context.Background(), original, []PDFEdit{{Operation: "rotate", Pages: []int{3}, Rotation: 90}}); err == nil {
		t.Fatal("out-of-range page")
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, _, err = EditPDF(ctx, original, []PDFEdit{{Operation: "collect", Pages: []int{1}}}); err == nil || !strings.Contains(err.Error(), "canceled") {
		t.Fatal("cancelled edit ran")
	}
}
