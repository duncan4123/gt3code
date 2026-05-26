//go:build !cgo || !gascity_native_beads

package main

import "github.com/gastownhall/gascity/internal/beads"

const nativeDoltliteBeadsEnv = "GC_NATIVE_DOLTLITE_BEADS"

func openOptimizedDoltliteStore(storePath string, store *beads.BdStore) (beads.Store, bool) {
	return nil, false
}

func nativeDoltliteBeadsEnabled() bool {
	return false
}
