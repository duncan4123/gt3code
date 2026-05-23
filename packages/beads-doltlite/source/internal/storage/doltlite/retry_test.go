//go:build cgo

package doltlite

import (
	"errors"
	"testing"
)

func TestIsRetryableConcurrencyErrorIncludesCatalogPrepareRace(t *testing.T) {
	err := errors.New("doltlite commit: failed to prepare catalog")
	if !isRetryableConcurrencyError(err) {
		t.Fatal("failed to prepare catalog should be retried")
	}
}
