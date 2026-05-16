//go:build cgo

package doltlite

import (
	"context"
	"fmt"

	"github.com/steveyegge/beads/internal/storage/issueops"
)

func buildDoltliteBatchCommitMessage(ctx context.Context, db issueops.SQLQuerier, actor string) string {
	if actor == "" {
		actor = "bd"
	}

	_, _ = ctx, db
	return fmt.Sprintf("bd: batch commit by %s", actor)
}
