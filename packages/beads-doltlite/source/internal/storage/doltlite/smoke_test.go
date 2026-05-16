//go:build cgo

package doltlite_test

import (
	"fmt"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/steveyegge/beads/internal/storage"
	"github.com/steveyegge/beads/internal/storage/doltlite"
	"github.com/steveyegge/beads/internal/types"
)

func TestSmokeCreateGetCommit(t *testing.T) {
	ctx := t.Context()
	store, err := doltlite.New(ctx, filepath.Join(t.TempDir(), ".beads"), "beads", "main")
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })

	if err := store.SetConfig(ctx, "issue_prefix", "bd"); err != nil {
		t.Fatalf("SetConfig: %v", err)
	}

	now := time.Now().UTC()
	issue := &types.Issue{
		ID:          "bd-test",
		Title:       "doltlite smoke",
		Description: "verify doltlite backend",
		Status:      types.StatusOpen,
		Priority:    2,
		IssueType:   types.TypeTask,
		CreatedAt:   now,
		UpdatedAt:   now,
	}
	if err := store.CreateIssue(ctx, issue, "test"); err != nil {
		t.Fatalf("CreateIssue: %v", err)
	}

	got, err := store.GetIssue(ctx, issue.ID)
	if err != nil {
		t.Fatalf("GetIssue: %v", err)
	}
	if got.Title != issue.Title {
		t.Fatalf("title = %q, want %q", got.Title, issue.Title)
	}

	if err := store.Commit(ctx, "test: doltlite smoke"); err != nil {
		t.Fatalf("Commit: %v", err)
	}
}

func TestSmokeLabels(t *testing.T) {
	ctx := t.Context()
	store, err := doltlite.New(ctx, filepath.Join(t.TempDir(), ".beads"), "beads", "main")
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })

	if err := store.SetConfig(ctx, "issue_prefix", "bd"); err != nil {
		t.Fatalf("SetConfig: %v", err)
	}

	now := time.Now().UTC()
	issue := &types.Issue{
		ID:        "bd-label",
		Title:     "doltlite labels",
		Status:    types.StatusOpen,
		Priority:  2,
		IssueType: types.TypeTask,
		CreatedAt: now,
		UpdatedAt: now,
		Labels:    []string{"gc:session"},
	}
	if err := store.CreateIssue(ctx, issue, "test"); err != nil {
		t.Fatalf("CreateIssue: %v", err)
	}
	if err := store.AddLabel(ctx, issue.ID, "agent:worker", "test"); err != nil {
		t.Fatalf("AddLabel: %v", err)
	}
	labels, err := store.GetLabels(ctx, issue.ID)
	if err != nil {
		t.Fatalf("GetLabels: %v", err)
	}
	got := map[string]bool{}
	for _, label := range labels {
		got[label] = true
	}
	for _, want := range []string{"gc:session", "agent:worker"} {
		if !got[want] {
			t.Fatalf("labels = %v, missing %q", labels, want)
		}
	}
}

func TestSmokeChildIDAndDependencyUseSQLiteDialect(t *testing.T) {
	ctx := t.Context()
	store, err := doltlite.New(ctx, filepath.Join(t.TempDir(), ".beads"), "beads", "main")
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })

	if err := store.SetConfig(ctx, "issue_prefix", "bd"); err != nil {
		t.Fatalf("SetConfig: %v", err)
	}

	now := time.Now().UTC()
	parent := &types.Issue{
		ID:        "bd-parent",
		Title:     "parent",
		Status:    types.StatusOpen,
		Priority:  2,
		IssueType: types.TypeTask,
		CreatedAt: now,
		UpdatedAt: now,
	}
	child := &types.Issue{
		ID:        "bd-parent.1",
		Title:     "child",
		Status:    types.StatusOpen,
		Priority:  2,
		IssueType: types.TypeTask,
		CreatedAt: now,
		UpdatedAt: now,
	}
	if err := store.CreateIssue(ctx, parent, "test"); err != nil {
		t.Fatalf("CreateIssue parent: %v", err)
	}
	if err := store.CreateIssue(ctx, child, "test"); err != nil {
		t.Fatalf("CreateIssue child: %v", err)
	}

	next, err := store.GetNextChildID(ctx, parent.ID)
	if err != nil {
		t.Fatalf("GetNextChildID: %v", err)
	}
	if next != "bd-parent.2" {
		t.Fatalf("next child ID = %q, want bd-parent.2", next)
	}

	dep := &types.Dependency{
		IssueID:     child.ID,
		DependsOnID: parent.ID,
		Type:        types.DepParentChild,
	}
	if err := store.AddDependency(ctx, dep, "test"); err != nil {
		t.Fatalf("AddDependency: %v", err)
	}
	deps, err := store.GetDependencyRecords(ctx, child.ID)
	if err != nil {
		t.Fatalf("GetDependencyRecords: %v", err)
	}
	if len(deps) != 1 || deps[0].DependsOnID != parent.ID || deps[0].Type != types.DepParentChild {
		t.Fatalf("deps = %#v, want parent-child to %s", deps, parent.ID)
	}
}

func TestRunInTransactionCreateIssuesAndDependency(t *testing.T) {
	ctx := t.Context()
	store, err := doltlite.New(ctx, filepath.Join(t.TempDir(), ".beads"), "beads", "main")
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })

	if err := store.SetConfig(ctx, "issue_prefix", "bd"); err != nil {
		t.Fatalf("SetConfig: %v", err)
	}

	now := time.Now().UTC()
	first := &types.Issue{
		Title:     "graph first",
		Status:    types.StatusOpen,
		Priority:  2,
		IssueType: types.TypeTask,
		CreatedAt: now,
		UpdatedAt: now,
	}
	second := &types.Issue{
		Title:     "graph second",
		Status:    types.StatusOpen,
		Priority:  2,
		IssueType: types.TypeTask,
		CreatedAt: now,
		UpdatedAt: now,
	}

	if err := store.RunInTransaction(ctx, "test: graph transaction", func(tx storage.Transaction) error {
		if err := tx.CreateIssues(ctx, []*types.Issue{first, second}, "test"); err != nil {
			return err
		}
		return tx.AddDependency(ctx, &types.Dependency{
			IssueID:     first.ID,
			DependsOnID: second.ID,
			Type:        types.DepBlocks,
		}, "test")
	}); err != nil {
		t.Fatalf("RunInTransaction: %v", err)
	}

	deps, err := store.GetDependencyRecords(ctx, first.ID)
	if err != nil {
		t.Fatalf("GetDependencyRecords: %v", err)
	}
	if len(deps) != 1 || deps[0].DependsOnID != second.ID || deps[0].Type != types.DepBlocks {
		t.Fatalf("deps = %#v, want blocks to %s", deps, second.ID)
	}
}

func TestConcurrentWritersSerializeLabels(t *testing.T) {
	ctx := t.Context()
	beadsDir := filepath.Join(t.TempDir(), ".beads")
	store, err := doltlite.New(ctx, beadsDir, "beads", "main")
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })

	if err := store.SetConfig(ctx, "issue_prefix", "bd"); err != nil {
		t.Fatalf("SetConfig: %v", err)
	}

	now := time.Now().UTC()
	issue := &types.Issue{
		ID:        "bd-label-lock",
		Title:     "label lock regression",
		Status:    types.StatusOpen,
		Priority:  2,
		IssueType: types.TypeTask,
		CreatedAt: now,
		UpdatedAt: now,
	}
	if err := store.CreateIssue(ctx, issue, "test"); err != nil {
		t.Fatalf("CreateIssue: %v", err)
	}

	const writers = 4
	var wg sync.WaitGroup
	errs := make(chan error, writers)
	for i := 0; i < writers; i++ {
		i := i
		wg.Add(1)
		go func() {
			defer wg.Done()
			st, err := doltlite.New(ctx, beadsDir, "beads", "main")
			if err != nil {
				errs <- fmt.Errorf("writer %d open: %w", i, err)
				return
			}
			defer st.Close()
			if err := st.AddLabel(ctx, issue.ID, fmt.Sprintf("label-%d", i), "test"); err != nil {
				errs <- fmt.Errorf("writer %d AddLabel: %w", i, err)
			}
		}()
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		if err != nil {
			t.Fatal(err)
		}
	}

	labels, err := store.GetLabels(ctx, issue.ID)
	if err != nil {
		t.Fatalf("GetLabels: %v", err)
	}
	got := map[string]bool{}
	for _, label := range labels {
		got[label] = true
	}
	for i := 0; i < writers; i++ {
		want := fmt.Sprintf("label-%d", i)
		if !got[want] {
			t.Fatalf("labels = %v, missing %q", labels, want)
		}
	}
}

func TestConcurrentStoresCreateWithLabels(t *testing.T) {
	ctx := t.Context()
	beadsDir := filepath.Join(t.TempDir(), ".beads")
	store, err := doltlite.New(ctx, beadsDir, "beads", "main")
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	if err := store.SetConfig(ctx, "issue_prefix", "bd"); err != nil {
		t.Fatalf("SetConfig: %v", err)
	}
	if err := store.Close(); err != nil {
		t.Fatalf("Close: %v", err)
	}

	const writers = 4
	var wg sync.WaitGroup
	errs := make(chan error, writers)
	ids := make(chan string, writers)
	for i := 0; i < writers; i++ {
		i := i
		wg.Add(1)
		go func() {
			defer wg.Done()
			st, err := doltlite.New(ctx, beadsDir, "beads", "main")
			if err != nil {
				errs <- fmt.Errorf("writer %d open: %w", i, err)
				return
			}
			defer st.Close()
			now := time.Now().UTC()
			issue := &types.Issue{
				Title:     fmt.Sprintf("concurrent create %d", i),
				Status:    types.StatusOpen,
				Priority:  2,
				IssueType: types.TypeTask,
				CreatedAt: now,
				UpdatedAt: now,
			}
			if err := st.RunInTransaction(ctx, "test: create with labels", func(tx storage.Transaction) error {
				if err := tx.CreateIssue(ctx, issue, "test"); err != nil {
					return err
				}
				if err := tx.AddLabel(ctx, issue.ID, "alpha", "test"); err != nil {
					return err
				}
				return tx.AddLabel(ctx, issue.ID, "beta", "test")
			}); err != nil {
				errs <- fmt.Errorf("writer %d create: %w", i, err)
				return
			}
			ids <- issue.ID
		}()
	}
	wg.Wait()
	close(errs)
	close(ids)
	for err := range errs {
		if err != nil {
			t.Fatal(err)
		}
	}

	check, err := doltlite.New(ctx, beadsDir, "beads", "main")
	if err != nil {
		t.Fatalf("New check store: %v", err)
	}
	t.Cleanup(func() { _ = check.Close() })
	for id := range ids {
		labels, err := check.GetLabels(ctx, id)
		if err != nil {
			t.Fatalf("GetLabels(%s): %v", id, err)
		}
		got := map[string]bool{}
		for _, label := range labels {
			got[label] = true
		}
		if !got["alpha"] || !got["beta"] {
			t.Fatalf("labels for %s = %v, want alpha and beta", id, labels)
		}
	}
}

func TestSmokeVersionControl(t *testing.T) {
	ctx := t.Context()
	store, err := doltlite.New(ctx, filepath.Join(t.TempDir(), ".beads"), "beads", "main")
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })

	if err := store.SetConfig(ctx, "issue_prefix", "bd"); err != nil {
		t.Fatalf("SetConfig: %v", err)
	}
	if err := store.Commit(ctx, "test: config"); err != nil {
		t.Fatalf("Commit config: %v", err)
	}

	branch, err := store.CurrentBranch(ctx)
	if err != nil {
		t.Fatalf("CurrentBranch: %v", err)
	}
	if branch != "main" {
		t.Fatalf("branch = %q, want main", branch)
	}

	if err := store.Branch(ctx, "feature"); err != nil {
		t.Fatalf("Branch: %v", err)
	}
	if err := store.Checkout(ctx, "feature"); err != nil {
		t.Fatalf("Checkout feature: %v", err)
	}
	branch, err = store.CurrentBranch(ctx)
	if err != nil {
		t.Fatalf("CurrentBranch feature: %v", err)
	}
	if branch != "feature" {
		t.Fatalf("branch = %q, want feature", branch)
	}

	branches, err := store.ListBranches(ctx)
	if err != nil {
		t.Fatalf("ListBranches: %v", err)
	}
	if len(branches) < 2 {
		t.Fatalf("branches = %v, want at least main and feature", branches)
	}

	if err := store.Checkout(ctx, "main"); err != nil {
		t.Fatalf("Checkout main: %v", err)
	}
	if err := store.DeleteBranch(ctx, "feature"); err != nil {
		t.Fatalf("DeleteBranch: %v", err)
	}

	if _, err := store.Status(ctx); err != nil {
		t.Fatalf("Status: %v", err)
	}
	if commits, err := store.Log(ctx, 5); err != nil {
		t.Fatalf("Log: %v", err)
	} else if len(commits) == 0 {
		t.Fatal("Log returned no commits")
	}
	if hash, err := store.GetCurrentCommit(ctx); err != nil {
		t.Fatalf("GetCurrentCommit: %v", err)
	} else if hash == "" {
		t.Fatal("GetCurrentCommit returned empty hash")
	}
}
