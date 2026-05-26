//go:build cgo && gascity_native_beads

package main

import (
	"os"
	"strconv"
	"strings"

	"github.com/gastownhall/gascity/internal/beads"
)

const nativeDoltliteBeadsEnv = "GC_NATIVE_DOLTLITE_BEADS"

func init() {
	registerBdBeadsBackendOptimizer(optimizeDoltliteBdBeadsBackend)
}

func optimizeDoltliteBdBeadsBackend(req beadsBackendRequest, store beads.Store) (beads.Store, bool) {
	if !nativeDoltliteBeadsEnabled() {
		return nil, false
	}
	bdStore, ok := store.(*beads.BdStore)
	if !ok {
		return nil, false
	}
	direct, err := beads.NewDoltliteNativeStore(req.ScopeRoot, bdStore)
	if err == nil {
		return direct, true
	}
	return nil, false
}

func nativeDoltliteBeadsEnabled() bool {
	raw := strings.TrimSpace(os.Getenv(nativeDoltliteBeadsEnv))
	if raw == "" {
		return true
	}
	enabled, err := strconv.ParseBool(raw)
	return err == nil && enabled
}
