package worksession

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"

	"github.com/gongahkia/hot-cross-buns/internal/branding"
)

// TaskEmoji is presentation only. Missing sidecars retain the legacy five-bread
// assignment; expanding the catalog must not reshuffle existing task identities.
func (s Store) TaskEmoji(id string) string {
	if validID(id) != nil {
		return ""
	}
	root, err := os.OpenRoot(s.root)
	if err != nil {
		return ""
	}
	defer root.Close()
	file, err := root.Open(filepath.Join(id, "bakery.json"))
	if err != nil {
		return ""
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil || !info.Mode().IsRegular() || info.Size() > 256 {
		return ""
	}
	var emoji string
	if json.NewDecoder(file).Decode(&emoji) != nil || !branding.ValidBakeryEmoji(emoji) {
		return ""
	}
	return emoji
}

func (s Store) retainTaskEmoji(id string) error {
	if validID(id) != nil {
		return errors.New("invalid task identity")
	}
	path := filepath.Join(s.root, id, "bakery.json")
	file, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if errors.Is(err, os.ErrExist) {
		return nil
	}
	if err != nil {
		return err
	}
	err = json.NewEncoder(file).Encode(branding.BakeryEmoji(id))
	closeErr := file.Close()
	if err != nil {
		return err
	}
	return closeErr
}
