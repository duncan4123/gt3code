//go:build cgo && gascity_native_beads

package main

import "testing"

func TestNativeDoltliteBeadsEnabledDefaultsOn(t *testing.T) {
	t.Setenv(nativeDoltliteBeadsEnv, "")

	if !nativeDoltliteBeadsEnabled() {
		t.Fatal("native DoltLite Beads should be enabled by default for native builds")
	}
}

func TestNativeDoltliteBeadsEnabledCanBeDisabled(t *testing.T) {
	t.Setenv(nativeDoltliteBeadsEnv, "false")

	if nativeDoltliteBeadsEnabled() {
		t.Fatal("native DoltLite Beads should honor explicit false override")
	}
}

func TestNativeDoltliteBeadsEnabledRejectsInvalidOverride(t *testing.T) {
	t.Setenv(nativeDoltliteBeadsEnv, "not-a-bool")

	if nativeDoltliteBeadsEnabled() {
		t.Fatal("native DoltLite Beads should reject invalid boolean override")
	}
}
