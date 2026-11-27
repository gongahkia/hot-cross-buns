package branding

import (
	_ "embed"
	"encoding/json"
	"hash/fnv"
	"slices"
)

//go:embed bakery.json
var bakeryJSON []byte

var bakery = func() []string {
	var values []string
	if err := json.Unmarshal(bakeryJSON, &values); err != nil {
		panic(err)
	}
	return values
}()

func BakeryEmoji(id string) string {
	hash := fnv.New32a()
	_, _ = hash.Write([]byte(id))
	return bakery[int(hash.Sum32())%len(bakery)]
}
func ValidBakeryEmoji(value string) bool { return slices.Contains(bakery, value) }
