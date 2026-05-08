//go:build gascity_native_beads

package main

import "github.com/gastownhall/gascity/internal/beads"

func openOptimizedDoltliteStore(storePath string, store *beads.BdStore) (beads.Store, bool) {
	direct, err := beads.NewDoltliteNativeStore(storePath, store)
	if err != nil {
		return nil, false
	}
	return direct, true
}
