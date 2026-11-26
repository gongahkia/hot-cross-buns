package document

import (
	"archive/zip"
	"bytes"
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	"os"
	"path"
	"regexp"
	"sort"
	"strings"
	"unicode/utf8"
)

type TextEdit struct {
	Part     string `json:"part,omitempty"`
	Find     string `json:"find"`
	Replace  string `json:"replace"`
	Expected int    `json:"expected_count,omitempty"`
}
type textSpan struct {
	start, end, offset int
	openStart, openEnd int
	text               string
}

// EditDOCX changes only matched text nodes. Formatting and unrelated package
// parts stay intact; ambiguous edits fail before any output is written.
func EditDOCX(contents []byte, edits []TextEdit) ([]byte, Preview, error) {
	if len(contents) > 64<<20 || len(edits) < 1 || len(edits) > 256 {
		return nil, Preview{}, errors.New("DOCX edits need a file up to 64 MiB and 1–256 replacements")
	}
	archive, err := zip.NewReader(bytes.NewReader(contents), int64(len(contents)))
	if err != nil {
		return nil, Preview{}, err
	}
	if len(archive.File) > 4096 {
		return nil, Preview{}, errors.New("DOCX has too many archive parts")
	}
	parts := map[string][]byte{}
	files := map[string]*zip.File{}
	total := 0
	for _, file := range archive.File {
		name := file.Name
		if path.Clean(name) != name || strings.HasPrefix(name, "/") || strings.HasPrefix(name, "../") || strings.Contains(name, "\\") || files[name] != nil || file.Mode()&os.ModeSymlink != 0 {
			return nil, Preview{}, errors.New("DOCX contains an unsafe or duplicate archive part")
		}
		if strings.Contains(strings.ToLower(name), "vbaproject") || strings.HasSuffix(strings.ToLower(name), ".bin") {
			return nil, Preview{}, errors.New("macro-enabled or embedded executable DOCX is unsupported")
		}
		reader, err := file.Open()
		if err != nil {
			return nil, Preview{}, err
		}
		data, err := io.ReadAll(io.LimitReader(reader, (16<<20)+1))
		reader.Close()
		total += len(data)
		if err != nil || len(data) > 16<<20 || total > 128<<20 {
			return nil, Preview{}, errors.New("DOCX exceeds expanded archive limits")
		}
		files[name] = file
		parts[name] = data
	}
	if files["word/document.xml"] == nil || files["[Content_Types].xml"] == nil {
		return nil, Preview{}, errors.New("DOCX is missing required document parts")
	}
	changed := map[string]bool{}
	for index, edit := range edits {
		if edit.Part == "" {
			edit.Part = "word/document.xml"
		}
		if edit.Part != "word/document.xml" && edit.Part != "word/footnotes.xml" && edit.Part != "word/endnotes.xml" && !(strings.HasPrefix(edit.Part, "word/header") && strings.HasSuffix(edit.Part, ".xml")) && !(strings.HasPrefix(edit.Part, "word/footer") && strings.HasSuffix(edit.Part, ".xml")) {
			return nil, Preview{}, errors.New("choose a document, header, footer or note text part")
		}
		if edit.Find == "" || len(edit.Find) > 65536 || len(edit.Replace) > 65536 || !validEditText(edit.Find+edit.Replace) || edit.Expected < 0 || edit.Expected > 1000 {
			return nil, Preview{}, errors.New("invalid bounded DOCX text replacement")
		}
		if edit.Expected == 0 {
			edit.Expected = 1
		}
		data, ok := parts[edit.Part]
		if !ok {
			return nil, Preview{}, fmt.Errorf("DOCX part %s is absent", edit.Part)
		}
		data, err = replaceDOCXText(data, edit)
		if err != nil {
			return nil, Preview{}, fmt.Errorf("DOCX edit %d: %w", index+1, err)
		}
		parts[edit.Part] = data
		changed[edit.Part] = true
	}
	var out bytes.Buffer
	writer := zip.NewWriter(&out)
	for _, file := range archive.File {
		if !changed[file.Name] {
			if err := writer.Copy(file); err != nil {
				return nil, Preview{}, err
			}
			continue
		}
		header := file.FileHeader
		header.SetMode(0o600)
		target, err := writer.CreateHeader(&header)
		if err != nil {
			return nil, Preview{}, err
		}
		if _, err = target.Write(parts[file.Name]); err != nil {
			return nil, Preview{}, err
		}
	}
	if err = writer.Close(); err != nil {
		return nil, Preview{}, err
	}
	return out.Bytes(), Preview{Title: "Edited document", Blocks: len(edits), Warnings: []string{"Text nodes changed; verify layout in Word before publishing. Tracked-change semantics and field recalculation are not supported."}}, nil
}
func replaceDOCXText(data []byte, edit TextEdit) ([]byte, error) {
	decoder := xml.NewDecoder(bytes.NewReader(data))
	var spans []textSpan
	var text strings.Builder
	inText := false
	openStart, openEnd := 0, 0
	for {
		start := int(decoder.InputOffset())
		token, err := decoder.Token()
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, errors.New("DOCX text XML is invalid")
		}
		end := int(decoder.InputOffset())
		switch value := token.(type) {
		case xml.StartElement:
			if value.Name.Space == "http://schemas.openxmlformats.org/wordprocessingml/2006/main" {
				if value.Name.Local == "t" {
					inText = true
					openStart, openEnd = start, end
				} else if value.Name.Local == "tab" || value.Name.Local == "br" {
					text.WriteByte('\n')
				}
			}
		case xml.EndElement:
			if value.Name.Local == "t" {
				inText = false
			}
			if value.Name.Local == "p" {
				text.WriteByte('\n')
			}
		case xml.CharData:
			if inText {
				spans = append(spans, textSpan{start: start, end: end, offset: text.Len(), openStart: openStart, openEnd: openEnd, text: string(value)})
				text.Write(value)
			}
		}
	}
	full := text.String()
	if count := strings.Count(full, edit.Find); count != edit.Expected {
		return nil, fmt.Errorf("expected %d exact text matches, found %d; narrow the text or specify expected_count", edit.Expected, count)
	}
	// Map text-stream positions to decoded text nodes; paragraph boundaries never match.
	offsets := make([]int, len(spans))
	for i, span := range spans {
		offsets[i] = span.offset
	}
	replacements := make([]string, len(spans))
	for i, span := range spans {
		replacements[i] = span.text
	}
	var locations []int
	for pos := 0; ; {
		i := strings.Index(full[pos:], edit.Find)
		if i < 0 {
			break
		}
		locations = append(locations, pos+i)
		pos += i + len(edit.Find)
	}
	for n := len(locations) - 1; n >= 0; n-- {
		start := locations[n]
		end := start + len(edit.Find)
		inserted := false
		for i, span := range spans {
			left, right := offsets[i], offsets[i]+len(span.text)
			if right <= start || left >= end {
				continue
			}
			a, b := max(start-left, 0), min(end-left, len(span.text))
			replacement := ""
			if !inserted {
				replacement = edit.Replace
				inserted = true
			}
			replacements[i] = replacements[i][:a] + replacement + replacements[i][b:]
		}
	}
	type patch struct {
		start, end int
		data       []byte
	}
	var patches []patch
	opened := map[int]bool{}
	for i, span := range spans {
		if replacements[i] == span.text {
			continue
		}
		var escaped bytes.Buffer
		if err := xml.EscapeText(&escaped, []byte(replacements[i])); err != nil {
			return nil, err
		}
		patches = append(patches, patch{span.start, span.end, escaped.Bytes()})
		if !opened[span.openStart] {
			opened[span.openStart] = true
			tag := string(data[span.openStart:span.openEnd])
			space := regexp.MustCompile(`\sxml:space\s*=\s*(?:"[^"]*"|'[^']*')`)
			if space.MatchString(tag) {
				tag = space.ReplaceAllString(tag, ` xml:space="preserve"`)
			} else {
				tag = strings.TrimSuffix(tag, ">") + ` xml:space="preserve">`
			}
			patches = append(patches, patch{span.openStart, span.openEnd, []byte(tag)})
		}
	}
	sort.Slice(patches, func(i, j int) bool { return patches[i].start < patches[j].start })
	var out bytes.Buffer
	position := 0
	for _, patch := range patches {
		if patch.start < position {
			return nil, errors.New("overlapping DOCX XML edit")
		}
		out.Write(data[position:patch.start])
		out.Write(patch.data)
		position = patch.end
	}
	out.Write(data[position:])
	return out.Bytes(), nil
}
func validEditText(text string) bool {
	if !utf8.ValidString(text) {
		return false
	}
	for _, r := range text {
		if r < 32 || r == 0xfffe || r == 0xffff {
			return false
		}
	}
	return true
}
