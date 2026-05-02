package main

import (
	"bytes"
	"io"
	"path/filepath"
	"strings"
	"testing"

	"github.com/gastownhall/gascity/internal/beads"
	"github.com/gastownhall/gascity/internal/config"
	"github.com/gastownhall/gascity/internal/runtime"
	"github.com/gastownhall/gascity/internal/session"
)

func TestCityStatusNamedSessionsUseProvidedStore(t *testing.T) {
	sp := runtime.NewFake()
	dops := newFakeDrainOps()
	store := beads.NewMemStore()

	oldOpen := openCityStoreAtForStatus
	openCityStoreAtForStatus = func(string) (beads.Store, error) {
		return store, nil
	}
	t.Cleanup(func() { openCityStoreAtForStatus = oldOpen })

	if _, err := store.Create(beads.Bead{
		Type:   session.BeadType,
		Labels: []string{session.LabelSession},
		Metadata: map[string]string{
			"configured_named_session":  "true",
			"configured_named_identity": "refinery",
			"configured_named_mode":     "on_demand",
		},
	}); err != nil {
		t.Fatalf("Create: %v", err)
	}

	cfg := &config.City{
		Workspace: config.Workspace{Name: "city"},
		Agents:    []config.Agent{{Name: "refinery"}},
		NamedSessions: []config.NamedSession{{
			Template: "refinery",
		}},
	}
	var stdout, stderr bytes.Buffer
	cityPath := filepath.Join(t.TempDir(), "city")
	snapshot := collectCityStatusSnapshot(sp, cfg, cityPath, store, &stderr)
	if len(snapshot.NamedSessions) != 1 {
		t.Fatalf("named sessions = %d, want 1", len(snapshot.NamedSessions))
	}
	if snapshot.NamedSessions[0].Status != "materialized" {
		t.Fatalf("named session status = %q, want materialized", snapshot.NamedSessions[0].Status)
	}
	code := doCityStatus(sp, dops, cfg, cityPath, &stdout, &stderr)
	if code != 0 {
		t.Fatalf("code = %d, want 0; stderr: %s", code, stderr.String())
	}
	out := stdout.String()
	if !strings.Contains(out, "Named sessions:") {
		t.Fatalf("stdout missing named sessions section, got:\n%s", out)
	}
	if !strings.Contains(out, "materialized (on_demand)") {
		t.Fatalf("stdout = %q, want materialized named session status", out)
	}
}

func TestCityStatusSnapshotNilConfigUsesCityPathName(t *testing.T) {
	cityPath := filepath.Join(t.TempDir(), "city")
	snapshot := collectCityStatusSnapshot(runtime.NewFake(), nil, cityPath, nil, io.Discard)
	if snapshot.CityName != "city" {
		t.Fatalf("CityName = %q, want city", snapshot.CityName)
	}
}

func TestCityStatusJSONPreservesNilAgentsWhenEmpty(t *testing.T) {
	status := cityStatusJSONFromSnapshot(cityStatusSnapshot{CityName: "city"}, StatusSummaryJSON{})
	if status.Agents != nil {
		t.Fatalf("Agents = %#v, want nil slice", status.Agents)
	}
}

func TestCityStatusNamedSessionSnapshotMissIsReserved(t *testing.T) {
	sp := runtime.NewFake()
	dops := newFakeDrainOps()
	store := beads.NewMemStore()

	oldOpen := openCityStoreAtForStatus
	openCityStoreAtForStatus = func(string) (beads.Store, error) {
		return store, nil
	}
	t.Cleanup(func() { openCityStoreAtForStatus = oldOpen })

	cfg := &config.City{
		Workspace: config.Workspace{Name: "city"},
		NamedSessions: []config.NamedSession{{
			Template: "refinery",
		}},
	}

	var stdout, stderr bytes.Buffer
	snapshot := collectCityStatusSnapshot(sp, cfg, "/home/user/city", store, &stderr)
	if len(snapshot.NamedSessions) != 1 {
		t.Fatalf("named sessions = %d, want 1", len(snapshot.NamedSessions))
	}
	if got := snapshot.NamedSessions[0].Status; got != "reserved-unmaterialized" {
		t.Fatalf("snapshot named session status = %q, want reserved-unmaterialized", got)
	}

	code := doCityStatus(sp, dops, cfg, "/home/user/city", &stdout, &stderr)
	if code != 0 {
		t.Fatalf("code = %d, want 0; stderr: %s", code, stderr.String())
	}
	out := stdout.String()
	if !strings.Contains(out, "reserved-unmaterialized (on_demand)") {
		t.Fatalf("stdout = %q, want reserved named session status", out)
	}
	if strings.Contains(out, "lookup error:") {
		t.Fatalf("stdout = %q, did not expect lookup error", out)
	}
}
