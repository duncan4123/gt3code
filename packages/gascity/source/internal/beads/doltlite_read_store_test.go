//go:build cgo && libsqlite3

package beads

import (
	"context"
	"database/sql"
	"os"
	"path/filepath"
	"slices"
	"testing"
	"time"

	gcbeads "github.com/steveyegge/beads/gascitystore"
)

func TestDoltliteReadStoreListsSessionBeads(t *testing.T) {
	store, closeStore := newTestDoltliteReadStore(t)
	defer closeStore()

	rows, err := store.List(ListQuery{
		Label: "gc:session",
		Sort:  SortCreatedDesc,
	})
	if err != nil {
		t.Fatalf("List session beads: %v", err)
	}
	if len(rows) != 1 {
		t.Fatalf("session rows = %d, want 1", len(rows))
	}
	got := rows[0]
	if got.ID != "gc-session" || got.Type != "session" || got.Metadata["session_name"] != "session-1" {
		t.Fatalf("session bead = %#v", got)
	}
	if !slices.Contains(got.Labels, "gc:session") {
		t.Fatalf("labels = %v, missing gc:session", got.Labels)
	}
}

func TestDoltliteReadStoreSkipLabels(t *testing.T) {
	store, closeStore := newTestDoltliteReadStore(t)
	defer closeStore()

	rows, err := store.List(ListQuery{
		Label:      "gc:session",
		SkipLabels: true,
	})
	if err != nil {
		t.Fatalf("List session beads: %v", err)
	}
	if len(rows) != 1 {
		t.Fatalf("session rows = %d, want 1", len(rows))
	}
	if len(rows[0].Labels) != 0 {
		t.Fatalf("labels hydrated with SkipLabels=true: %v", rows[0].Labels)
	}
}

func TestDoltliteReadStoreSkipParent(t *testing.T) {
	store, closeStore := newTestDoltliteReadStore(t)
	defer closeStore()

	withParent, err := store.List(ListQuery{Type: "task", Sort: SortCreatedAsc})
	if err != nil {
		t.Fatalf("List tasks with parent: %v", err)
	}
	child := findTestBead(t, withParent, "gc-child")
	if child.ParentID != "gc-parent" {
		t.Fatalf("child parent = %q, want gc-parent", child.ParentID)
	}

	withoutParent, err := store.List(ListQuery{
		Type:       "task",
		SkipParent: true,
		Sort:       SortCreatedAsc,
	})
	if err != nil {
		t.Fatalf("List tasks without parent: %v", err)
	}
	child = findTestBead(t, withoutParent, "gc-child")
	if child.ParentID != "" {
		t.Fatalf("child parent hydrated with SkipParent=true: %q", child.ParentID)
	}
}

func TestDoltliteReadStoreTypeFallbackCanSkipLabels(t *testing.T) {
	store, closeStore := newTestDoltliteReadStore(t)
	defer closeStore()

	rows, err := store.List(ListQuery{
		Type:       "session",
		SkipLabels: true,
		SkipParent: true,
	})
	if err != nil {
		t.Fatalf("List type=session: %v", err)
	}
	if len(rows) != 1 {
		t.Fatalf("type=session rows = %d, want 1", len(rows))
	}
	if rows[0].ID != "gc-session" {
		t.Fatalf("type=session row = %s, want gc-session", rows[0].ID)
	}
	if len(rows[0].Labels) != 0 || rows[0].ParentID != "" {
		t.Fatalf("unexpected hydrated fields: labels=%v parent=%q", rows[0].Labels, rows[0].ParentID)
	}
}

func TestDoltliteReadStoreReadyUsesDoltlite(t *testing.T) {
	store, closeStore := newTestDoltliteReadStore(t)
	defer closeStore()

	rows, err := store.Ready()
	if err != nil {
		t.Fatalf("Ready: %v", err)
	}
	if !hasTestBead(rows, "gc-ready") {
		t.Fatalf("Ready missing gc-ready: %#v", rows)
	}
	if hasTestBead(rows, "gc-session") {
		t.Fatalf("Ready included session bead: %#v", rows)
	}
	if hasTestBead(rows, "gc-blocked") {
		t.Fatalf("Ready included blocked bead: %#v", rows)
	}
}

func TestDoltliteReadStorePoolDemandCount(t *testing.T) {
	store, closeStore := newTestDoltliteReadStore(t)
	defer closeStore()

	count, err := store.PoolDemandCount("rig/polecat")
	if err != nil {
		t.Fatalf("PoolDemandCount: %v", err)
	}
	if count != 1 {
		t.Fatalf("PoolDemandCount = %d, want 1", count)
	}
}

func TestDoltliteReadStoreDefaultWorkQueryHasReadyWork(t *testing.T) {
	store, closeStore := newTestDoltliteReadStore(t)
	defer closeStore()

	found, err := store.DefaultWorkQueryHasReadyWork(nil, []string{"rig/worker"}, false)
	if err != nil {
		t.Fatalf("DefaultWorkQueryHasReadyWork assigned in-progress: %v", err)
	}
	if !found {
		t.Fatal("assigned in-progress work not found")
	}

	found, err = store.DefaultWorkQueryHasReadyWork(nil, []string{"rig/ready-worker"}, false)
	if err != nil {
		t.Fatalf("DefaultWorkQueryHasReadyWork assigned ready: %v", err)
	}
	if !found {
		t.Fatal("assigned ready work not found")
	}

	found, err = store.DefaultWorkQueryHasReadyWork([]string{"rig/polecat"}, nil, false)
	if err != nil {
		t.Fatalf("DefaultWorkQueryHasReadyWork routed disabled: %v", err)
	}
	if found {
		t.Fatal("routed work found with includeRouted=false")
	}

	found, err = store.DefaultWorkQueryHasReadyWork([]string{"rig/polecat"}, nil, true)
	if err != nil {
		t.Fatalf("DefaultWorkQueryHasReadyWork routed enabled: %v", err)
	}
	if !found {
		t.Fatal("routed ready work not found")
	}
}

func TestDoltliteCachingStoreSkipParentDoesNotEraseDependencyCache(t *testing.T) {
	store, closeStore := newTestDoltliteReadStore(t)
	defer closeStore()

	cache := NewCachingStoreForTest(store, nil)
	if err := cache.Prime(context.Background()); err != nil {
		t.Fatalf("Prime: %v", err)
	}
	before, err := cache.DepList("gc-child", "down")
	if err != nil {
		t.Fatalf("DepList before fast read: %v", err)
	}
	if len(before) != 1 || before[0].DependsOnID != "gc-parent" {
		t.Fatalf("deps before fast read = %#v, want parent gc-parent", before)
	}

	if _, err := cache.List(ListQuery{
		Type:       "task",
		Live:       true,
		SkipLabels: true,
		SkipParent: true,
	}); err != nil {
		t.Fatalf("fast live List: %v", err)
	}

	after, err := cache.DepList("gc-child", "down")
	if err != nil {
		t.Fatalf("DepList after fast read: %v", err)
	}
	if len(after) != 1 || after[0].DependsOnID != "gc-parent" {
		t.Fatalf("deps after fast read = %#v, want parent gc-parent", after)
	}
}

func newTestDoltliteReadStore(t *testing.T) (*DoltliteReadStore, func()) {
	t.Helper()
	dir := t.TempDir()
	beadsDir := filepath.Join(dir, ".beads")
	if err := os.MkdirAll(beadsDir, 0o755); err != nil {
		t.Fatalf("mkdir beads dir: %v", err)
	}
	meta := []byte(`{"backend":"doltlite","database":"doltlite","dolt_database":"hq"}`)
	if err := os.WriteFile(filepath.Join(beadsDir, "metadata.json"), meta, 0o600); err != nil {
		t.Fatalf("write metadata: %v", err)
	}

	native, err := gcbeads.Open(context.Background(), dir, "gascity-test")
	if err != nil {
		t.Fatalf("open native doltlite store: %v", err)
	}
	if err := native.Close(); err != nil {
		t.Fatalf("close schema init store: %v", err)
	}
	setTestDoltliteConfig(t, filepath.Join(beadsDir, "doltlite", "hq.db"))
	native, err = gcbeads.Open(context.Background(), dir, "gascity-test")
	if err != nil {
		t.Fatalf("reopen native doltlite store: %v", err)
	}
	defer native.Close() //nolint:errcheck // test cleanup

	now := time.Now().UTC()
	created := []gcbeads.Issue{
		{
			ID:          "gc-session",
			Title:       "session",
			Status:      "open",
			IssueType:   "session",
			CreatedAt:   now,
			Labels:      []string{"gc:session", "agent:test"},
			Metadata:    map[string]string{"session_name": "session-1"},
			Description: "session bead",
		},
		{
			ID:        "gc-parent",
			Title:     "parent",
			Status:    "open",
			IssueType: "task",
			CreatedAt: now,
		},
		{
			ID:        "gc-child",
			Title:     "child",
			Status:    "open",
			IssueType: "task",
			CreatedAt: now,
			ParentID:  "gc-parent",
		},
		{
			ID:        "gc-ready",
			Title:     "ready",
			Status:    "open",
			IssueType: "task",
			CreatedAt: now,
		},
		{
			ID:        "gc-assigned-progress",
			Title:     "assigned progress",
			Status:    "in_progress",
			IssueType: "task",
			CreatedAt: now,
			Assignee:  "rig/worker",
		},
		{
			ID:        "gc-assigned-ready",
			Title:     "assigned ready",
			Status:    "open",
			IssueType: "task",
			CreatedAt: now,
			Assignee:  "rig/ready-worker",
		},
		{
			ID:        "gc-routed",
			Title:     "routed",
			Status:    "open",
			IssueType: "task",
			CreatedAt: now,
			Metadata:  map[string]string{"gc.routed_to": "rig/polecat"},
		},
		{
			ID:        "gc-blocker",
			Title:     "blocker",
			Status:    "open",
			IssueType: "task",
			CreatedAt: now,
		},
		{
			ID:        "gc-blocked",
			Title:     "blocked",
			Status:    "open",
			IssueType: "task",
			CreatedAt: now,
			Dependencies: []gcbeads.Dependency{{
				DependsOnID: "gc-blocker",
				Type:        "blocks",
			}},
		},
	}
	for _, issue := range created {
		if _, err := native.Create(context.Background(), issue); err != nil {
			t.Fatalf("create %s: %v", issue.ID, err)
		}
	}

	backing := NewBdStore(dir, func(string, string, ...string) ([]byte, error) {
		t.Fatal("backing bd runner should not be called by doltlite read tests")
		return nil, nil
	})
	store, err := NewDoltliteReadStore(dir, backing)
	if err != nil {
		t.Fatalf("NewDoltliteReadStore: %v", err)
	}
	return store, func() { _ = store.CloseStore() }
}

func findTestBead(t *testing.T, rows []Bead, id string) Bead {
	t.Helper()
	for _, row := range rows {
		if row.ID == id {
			return row
		}
	}
	t.Fatalf("missing bead %s in %#v", id, rows)
	return Bead{}
}

func hasTestBead(rows []Bead, id string) bool {
	for _, row := range rows {
		if row.ID == id {
			return true
		}
	}
	return false
}

func setTestDoltliteConfig(t *testing.T, dbPath string) {
	t.Helper()
	db, err := sql.Open("sqlite3", dbPath+"?_busy_timeout=10000")
	if err != nil {
		t.Fatalf("open doltlite db for config: %v", err)
	}
	defer db.Close() //nolint:errcheck // test cleanup
	if _, err := db.Exec("INSERT OR REPLACE INTO config (`key`, value) VALUES ('issue_prefix', 'gc')"); err != nil {
		t.Fatalf("set issue_prefix config: %v", err)
	}
	if _, err := db.Exec("INSERT OR REPLACE INTO config (`key`, value) VALUES ('types.custom', 'session,agent,role,rig,message,convoy,molecule,gate,merge-request')"); err != nil {
		t.Fatalf("set custom types config: %v", err)
	}
}
