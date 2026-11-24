package sandbox

import (
	"errors"
	"path/filepath"
)

// LiveFilesystem is supplied only by the foreground permission owner. It is
// never decoded from a model tool argument, project file or saved CLI config.
type LiveFilesystem struct {
	Read        []string
	Write       []string
	Protected   []string
	Full        bool
	Fingerprint string
}

func (f *LiveFilesystem) validate() error {
	if f == nil {
		return nil
	}
	if f.Fingerprint == "" || len(f.Read) > 128 || len(f.Write) > 128 || len(f.Protected) > 32 {
		return errors.New("invalid reviewed filesystem envelope")
	}
	for _, roots := range [][]string{f.Read, f.Write, f.Protected} {
		for _, root := range roots {
			if !filepath.IsAbs(root) || filepath.Clean(root) != root {
				return errors.New("reviewed filesystem paths must be canonical and absolute")
			}
			if filepath.Dir(root) == root && !f.Full {
				return errors.New("filesystem root requires explicit full access")
			}
		}
	}
	if len(f.Protected) == 0 {
		return errors.New("reviewed filesystem access must protect the permission owner")
	}
	return nil
}
