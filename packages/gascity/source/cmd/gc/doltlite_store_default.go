//go:build !cgo || !gascity_native_beads

package main

const nativeDoltliteBeadsEnv = "GC_NATIVE_DOLTLITE_BEADS"

func nativeDoltliteBeadsEnabled() bool {
	return false
}
