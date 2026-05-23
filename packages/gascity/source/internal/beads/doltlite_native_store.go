//go:build cgo && gascity_native_beads

package beads

import (
	"errors"
	"fmt"
)

// DoltliteNativeStore keeps Gas City's in-process DoltLite read path while
// leaving writes on the normal bd CLI path. Beads' DoltLite backend does not
// yet expose a public Go write API, and Gas City must not import Beads internal
// packages or a consumer-specific adapter from the upstream Beads module.
type DoltliteNativeStore struct {
	*DoltliteReadStore
}

func NewDoltliteNativeStore(dir string, backing *BdStore) (*DoltliteNativeStore, error) {
	readStore, err := NewDoltliteReadStore(dir, backing)
	if err != nil {
		return nil, err
	}
	return &DoltliteNativeStore{DoltliteReadStore: readStore}, nil
}

func (s *DoltliteNativeStore) Ping() error {
	if _, err := s.Get("__gascity_ping__"); err != nil && !errors.Is(err, ErrNotFound) {
		return fmt.Errorf("doltlite native store ping: %w", err)
	}
	return nil
}
