//go:build cgo

package doltlite_test

import (
	"context"
	"errors"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/steveyegge/beads/internal/storage/doltlite"
)

func TestNewTimesOutWhenBootstrapLockHeld(t *testing.T) {
	beadsDir := filepath.Join(t.TempDir(), ".beads")
	dataDir := filepath.Join(beadsDir, "doltlite")

	lock, err := doltlite.WaitLock(t.Context(), dataDir)
	if err != nil {
		t.Fatalf("acquire bootstrap lock: %v", err)
	}
	defer lock.Unlock()

	ctx, cancel := context.WithTimeout(t.Context(), 50*time.Millisecond)
	defer cancel()

	_, err = doltlite.New(ctx, beadsDir, "beads", "main")
	if err == nil {
		t.Fatal("expected New to fail when bootstrap lock is held")
	}
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("expected deadline exceeded, got: %v", err)
	}
	if !strings.Contains(err.Error(), "timed out waiting for startup lock") {
		t.Fatalf("expected startup lock timeout hint, got: %v", err)
	}
}
