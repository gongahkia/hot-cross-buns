package document

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"sync"

	"github.com/pdfcpu/pdfcpu/pkg/api"
	"github.com/pdfcpu/pdfcpu/pkg/pdfcpu/model"
	"github.com/pdfcpu/pdfcpu/pkg/pdfcpu/types"
)

type PDFEdit struct {
	Operation string `json:"operation"`
	Pages     []int  `json:"pages"`
	Rotation  int    `json:"rotation,omitempty"`
	Text      string `json:"text,omitempty"`
}

var pdfEditMu sync.Mutex

func init() { api.DisableConfigDir() }

type boundedPDF struct{ bytes.Buffer }

func (w *boundedPDF) Write(data []byte) (int, error) {
	if w.Len()+len(data) > 64<<20 {
		return 0, errors.New("edited PDF exceeds 64 MiB")
	}
	return w.Buffer.Write(data)
}
func pdfConfig() *model.Configuration {
	c := model.NewDefaultConfiguration()
	c.Offline = true
	return c
}

func EditPDF(ctx context.Context, original []byte, edits []PDFEdit) ([]byte, Preview, error) {
	if len(original) > 64<<20 || len(edits) < 1 || len(edits) > 32 {
		return nil, Preview{}, errors.New("PDF edits need an input up to 64 MiB and 1–32 operations")
	}
	// pdfcpu uses shared font/config state. Keep operations serialized and offline.
	pdfEditMu.Lock()
	defer pdfEditMu.Unlock()
	data := append([]byte(nil), original...)
	count, err := api.PageCount(bytes.NewReader(data), pdfConfig())
	if err != nil {
		return nil, Preview{}, err
	}
	if count < 1 || count > 1000 {
		return nil, Preview{}, errors.New("PDF editing supports 1–1000 pages")
	}
	for _, edit := range edits {
		if err := ctx.Err(); err != nil {
			return nil, Preview{}, err
		}
		if len(edit.Pages) == 0 || len(edit.Pages) > 1000 {
			return nil, Preview{}, errors.New("select explicit PDF pages")
		}
		selected := make([]string, len(edit.Pages))
		seen := map[int]bool{}
		for i, page := range edit.Pages {
			if page < 1 || page > count {
				return nil, Preview{}, fmt.Errorf("page %d is outside the current %d-page PDF", page, count)
			}
			selected[i] = strconv.Itoa(page)
			if seen[page] && edit.Operation != "collect" {
				return nil, Preview{}, errors.New("duplicate PDF selection")
			}
			seen[page] = true
		}
		if edit.Operation != "rotate" && edit.Rotation != 0 || edit.Operation != "stamp" && edit.Text != "" {
			return nil, Preview{}, errors.New("PDF fields do not match the selected operation")
		}
		var out boundedPDF
		switch edit.Operation {
		case "rotate":
			if edit.Rotation != 90 && edit.Rotation != 180 && edit.Rotation != 270 {
				return nil, Preview{}, errors.New("rotation must be 90, 180 or 270 degrees")
			}
			err = api.Rotate(bytes.NewReader(data), &out, edit.Rotation, selected, pdfConfig())
		case "collect":
			err = api.Collect(bytes.NewReader(data), &out, selected, pdfConfig())
			count = len(selected)
		case "remove":
			if len(seen) >= count {
				return nil, Preview{}, errors.New("cannot remove every PDF page")
			}
			err = api.RemovePages(bytes.NewReader(data), &out, selected, pdfConfig())
			count -= len(seen)
		case "stamp":
			if strings.TrimSpace(edit.Text) == "" || len(edit.Text) > 2048 || strings.ContainsAny(edit.Text, "\x00\r") {
				return nil, Preview{}, errors.New("stamp requires bounded visible text")
			}
			var watermark *model.Watermark
			watermark, err = api.TextWatermark(edit.Text, "font:Helvetica, points:12, position:bc, rotation:0, opacity:1", true, false, types.POINTS)
			if err == nil {
				err = api.AddWatermarks(bytes.NewReader(data), &out, selected, watermark, pdfConfig())
			}
		default:
			return nil, Preview{}, errors.New("PDF operation must be rotate, collect, remove or stamp")
		}
		if err != nil {
			return nil, Preview{}, err
		}
		if err = ctx.Err(); err != nil {
			return nil, Preview{}, err
		}
		data = out.Bytes()
	}
	verified, err := api.PageCount(bytes.NewReader(data), pdfConfig())
	if err != nil || verified != count {
		return nil, Preview{}, errors.New("edited PDF failed page-count verification")
	}
	return data, Preview{Title: "Edited PDF", Pages: count, Blocks: len(edits), Warnings: []string{"Stamps are visible overlays, not secure redactions or underlying text replacement. Verify layout; edits can invalidate digital signatures."}}, nil
}
