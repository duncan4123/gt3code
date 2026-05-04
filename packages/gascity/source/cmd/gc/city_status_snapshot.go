package main

import (
	"fmt"
	"io"
	"os"
	"strings"
	"time"

	"github.com/gastownhall/gascity/internal/agent"
	"github.com/gastownhall/gascity/internal/beads"
	"github.com/gastownhall/gascity/internal/config"
	"github.com/gastownhall/gascity/internal/runtime"
	"github.com/gastownhall/gascity/internal/session"
	"github.com/gastownhall/gascity/internal/worker"
)

type cityStatusSnapshot struct {
	CityName        string
	CityPath        string
	EffectiveAPIURL string
	Controller      ControllerJSON
	Suspended       bool
	Agents          []cityStatusAgentRow
	Rigs            []StatusRigJSON
	NamedSessions   []cityStatusNamedSession
	Summary         StatusSummaryJSON
}

type cityStatusAgentRow struct {
	Agent       StatusAgentJSON
	SessionName string
	GroupName   string
	ScaleLabel  string
	Expanded    bool
}

type cityStatusNamedSession struct {
	Identity string
	Status   string
	Mode     string
}

type rigStatusCounts struct {
	Total     int
	Suspended int
}

type statusAgentSessionResolver interface {
	SessionNameForAgent(string) (string, bool)
}

func observeStatusSession(
	cmdName string,
	cityPath string,
	store beads.Store,
	sp runtime.Provider,
	cfg *config.City,
	target string,
	stderr io.Writer,
) worker.LiveObservation {
	providerObs := observeProviderStatusSession(sp, target)
	if providerObs.Running || providerObs.Alive || providerObs.Attached || providerObs.LastActivity != nil {
		return providerObs
	}
	return observeSessionTargetWithWarning(cmdName, cityPath, store, sp, cfg, target, stderr)
}

func observeProviderStatusSession(sp runtime.Provider, target string) worker.LiveObservation {
	running := sp.IsRunning(target)
	obs := worker.LiveObservation{
		Running:     running,
		Alive:       running,
		Attached:    sp.IsAttached(target),
		SessionName: target,
	}
	if last, err := sp.GetLastActivity(target); err == nil && !last.IsZero() {
		last = last.UTC().Truncate(time.Millisecond)
		obs.LastActivity = &last
	}
	if obs.Running || obs.Alive || obs.Attached {
		obs.RuntimeSessionID = target
	}
	return obs
}

func openCityStatusStore(cityPath string, stderr io.Writer) (beads.Store, int) {
	if cityPath == "" {
		return nil, 0
	}
	opened, err := openCityStoreAtForStatus(cityPath)
	if err != nil {
		fmt.Fprintf(stderr, "gc status: opening bead store: %v\n", err) //nolint:errcheck // best-effort stderr
		return nil, 1
	}
	return opened, 0
}

func collectCityStatusSnapshot(sp runtime.Provider, cfg *config.City, cityPath string, store beads.Store, stderr io.Writer) cityStatusSnapshot {
	suspended := os.Getenv("GC_SUSPENDED") == "1"
	if cfg != nil {
		suspended = citySuspended(cfg)
	}
	snapshot := cityStatusSnapshot{
		CityPath:        cityPath,
		EffectiveAPIURL: resolveEffectiveAPIURL(cityPath, cfg),
		Controller:      controllerStatusForCity(cityPath),
		Suspended:       suspended,
	}
	snapshot.CityName = loadedCityName(cfg, cityPath)
	if cfg == nil {
		return snapshot
	}

	var sessionBeads *sessionBeadSnapshot
	if store != nil {
		if loaded, err := loadSessionBeadSnapshot(store); err == nil {
			sessionBeads = loaded
		} else if stderr != nil {
			fmt.Fprintf(stderr, "gc status: loading session bead snapshot: %v\n", err) //nolint:errcheck // best-effort stderr
		}
	}
	statusSessionName := func(qualifiedName string) string {
		if resolver, ok := sp.(statusAgentSessionResolver); ok {
			if sn, found := resolver.SessionNameForAgent(qualifiedName); found {
				return sn
			}
		}
		if sessionBeads != nil {
			if sn := sessionBeads.FindSessionNameByTemplate(qualifiedName); sn != "" {
				return sn
			}
		}
		return agent.SessionNameFor(snapshot.CityName, qualifiedName, cfg.Workspace.SessionTemplate)
	}

	suspendedRigs := make(map[string]bool, len(cfg.Rigs))
	for _, r := range cfg.Rigs {
		if r.Suspended {
			suspendedRigs[r.Name] = true
		}
	}

	rigCounts := make(map[string]*rigStatusCounts, len(cfg.Rigs))
	addRigCount := func(rigName string, rowSuspended bool) {
		if rigName == "" {
			return
		}
		tally := rigCounts[rigName]
		if tally == nil {
			tally = &rigStatusCounts{}
			rigCounts[rigName] = tally
		}
		tally.Total++
		if rowSuspended {
			tally.Suspended++
		}
	}

	for _, a := range cfg.Agents {
		suspended := a.Suspended || (a.Dir != "" && suspendedRigs[a.Dir])
		sp0 := scaleParamsFor(&a)
		scope := "city"
		if a.Dir != "" {
			scope = "rig"
		}

		if a.SupportsInstanceExpansion() {
			maxDisplay := fmt.Sprintf("max=%d", sp0.Max)
			if sp0.Max < 0 {
				maxDisplay = "max=unlimited"
			}
			scaleLabel := fmt.Sprintf("scaled (min=%d, %s)", sp0.Min, maxDisplay)
			headerShown := false
			for _, qualifiedInstance := range discoverPoolInstances(a.Name, a.Dir, sp0, &a, snapshot.CityName, cfg.Workspace.SessionTemplate, sp) {
				sn := statusSessionName(qualifiedInstance)
				obs := observeStatusSession("gc status", cityPath, nil, sp, cfg, sn, stderr)
				_, instanceName := config.ParseQualifiedName(qualifiedInstance)
				row := cityStatusAgentRow{
					Agent: StatusAgentJSON{
						Name:          instanceName,
						QualifiedName: qualifiedInstance,
						Scope:         scope,
						Running:       obs.Running,
						Suspended:     suspended || obs.Suspended,
						Pool:          nil,
					},
					SessionName: sn,
					GroupName:   a.QualifiedName(),
					Expanded:    true,
				}
				if !headerShown {
					row.ScaleLabel = scaleLabel
					headerShown = true
				}
				snapshot.Agents = append(snapshot.Agents, row)
				snapshot.Summary.TotalAgents++
				if obs.Running {
					snapshot.Summary.RunningAgents++
				}
				addRigCount(a.Dir, suspended || obs.Suspended)
			}
			continue
		}

		sn := statusSessionName(a.QualifiedName())
		obs := observeStatusSession("gc status", cityPath, nil, sp, cfg, sn, stderr)
		snapshot.Agents = append(snapshot.Agents, cityStatusAgentRow{
			Agent: StatusAgentJSON{
				Name:          a.Name,
				QualifiedName: a.QualifiedName(),
				Scope:         scope,
				Running:       obs.Running,
				Suspended:     suspended || obs.Suspended,
			},
			SessionName: sn,
			GroupName:   a.QualifiedName(),
			Expanded:    false,
		})
		snapshot.Summary.TotalAgents++
		if obs.Running {
			snapshot.Summary.RunningAgents++
		}
		addRigCount(a.Dir, suspended || obs.Suspended)
	}

	for _, r := range cfg.Rigs {
		suspended := r.Suspended
		if !suspended {
			if tally := rigCounts[r.Name]; tally != nil && tally.Total > 0 && tally.Total == tally.Suspended {
				suspended = true
			}
		}
		snapshot.Rigs = append(snapshot.Rigs, StatusRigJSON{
			Name:      r.Name,
			Path:      r.Path,
			Suspended: suspended,
		})
	}

	for _, ns := range cfg.NamedSessions {
		identity := ns.QualifiedName()
		mode := ns.ModeOrDefault()
		status := namedSessionStatusForCity(cfg, sessionBeads, snapshot.CityName, identity, mode, suspendedRigs)
		snapshot.NamedSessions = append(snapshot.NamedSessions, cityStatusNamedSession{
			Identity: identity,
			Status:   status,
			Mode:     mode,
		})
	}

	return snapshot
}

func namedSessionStatusForCity(
	cfg *config.City,
	sessionBeads *sessionBeadSnapshot,
	cityName string,
	identity string,
	mode string,
	suspendedRigs map[string]bool,
) string {
	status := "reserved-unmaterialized"
	spec, hasSpec := findNamedSessionSpec(cfg, cityName, identity)
	if hasSpec {
		if mode == "always" && namedSessionBlockedBySuspension(cfg, spec.Agent, suspendedRigs) {
			status = "degraded blocked"
		}
	}
	if sessionBeads == nil || !hasSpec {
		return status
	}
	if bead, ok := findCanonicalNamedSessionBead(sessionBeads, spec); ok {
		return namedSessionStatusFromBead(bead)
	}
	for _, bead := range sessionBeads.Open() {
		if strings.TrimSpace(bead.Metadata["session_name"]) == strings.TrimSpace(spec.SessionName) {
			return namedSessionStatusFromBead(bead)
		}
	}
	return status
}

func namedSessionStatusFromBead(bead beads.Bead) string {
	if state := strings.TrimSpace(bead.Metadata["state"]); state != "" {
		return state
	}
	return "materialized"
}

func collectCitySessionCounts(cityPath string, store beads.Store, sp runtime.Provider, cfg *config.City) (StatusSummaryJSON, error) {
	summary := StatusSummaryJSON{}
	if store == nil {
		return summary, nil
	}
	if cityPath != "" {
		if _, err := os.Stat(cityPath); err != nil {
			return summary, nil
		}
	}
	if store == nil {
		return summary, nil
	}
	catalog, err := workerSessionCatalogWithConfig(cityPath, store, sp, cfg)
	if err != nil {
		return summary, err
	}
	sessions, err := catalog.List("", "")
	if err != nil {
		return summary, err
	}
	for _, s := range sessions {
		switch s.State {
		case session.StateActive:
			summary.ActiveSessions++
		case session.StateSuspended:
			summary.SuspendedSessions++
		}
	}
	return summary, nil
}

func cityStatusJSONFromSnapshot(snapshot cityStatusSnapshot, summary StatusSummaryJSON) StatusJSON {
	var agents []StatusAgentJSON
	for _, row := range snapshot.Agents {
		agents = append(agents, row.Agent)
	}
	return StatusJSON{
		CityName:        snapshot.CityName,
		CityPath:        snapshot.CityPath,
		EffectiveAPIURL: snapshot.EffectiveAPIURL,
		Controller:      snapshot.Controller,
		Suspended:       snapshot.Suspended,
		Agents:          agents,
		Rigs:            snapshot.Rigs,
		Summary:         summary,
	}
}

func renderCityStatusText(snapshot cityStatusSnapshot, dops drainOps, stdout io.Writer) {
	fmt.Fprintf(stdout, "%s  %s\n", snapshot.CityName, snapshot.CityPath)                //nolint:errcheck // best-effort stdout
	fmt.Fprintf(stdout, "  Controller: %s\n", controllerStatusLine(snapshot.Controller)) //nolint:errcheck // best-effort stdout
	for _, line := range controllerStatusGuidance(snapshot.Controller, snapshot.CityPath) {
		fmt.Fprintf(stdout, "  %s\n", line) //nolint:errcheck // best-effort stdout
	}

	if snapshot.Suspended {
		fmt.Fprintf(stdout, "  Suspended:  yes\n") //nolint:errcheck // best-effort stdout
	} else {
		fmt.Fprintf(stdout, "  Suspended:  no\n") //nolint:errcheck // best-effort stdout
	}

	if len(snapshot.Agents) > 0 {
		fmt.Fprintln(stdout) //nolint:errcheck // best-effort stdout
		fmt.Fprintln(stdout, "Agents:")
		for _, row := range snapshot.Agents {
			if row.ScaleLabel != "" {
				fmt.Fprintf(stdout, "  %-24s%s\n", row.GroupName, row.ScaleLabel) //nolint:errcheck // best-effort stdout
			}
			status := agentStatusLine(row.Agent.Running, dops, row.SessionName, row.Agent.Suspended)
			if row.Expanded {
				fmt.Fprintf(stdout, "    %-22s%s\n", row.Agent.QualifiedName, status) //nolint:errcheck // best-effort stdout
			} else {
				fmt.Fprintf(stdout, "  %-24s%s\n", row.Agent.QualifiedName, status) //nolint:errcheck // best-effort stdout
			}
		}
		fmt.Fprintln(stdout)                                                                                        //nolint:errcheck // best-effort stdout
		fmt.Fprintf(stdout, "%d/%d agents running\n", snapshot.Summary.RunningAgents, snapshot.Summary.TotalAgents) //nolint:errcheck // best-effort stdout
	}

	if len(snapshot.NamedSessions) > 0 {
		fmt.Fprintln(stdout) //nolint:errcheck // best-effort stdout
		fmt.Fprintln(stdout, "Named sessions:")
		for _, named := range snapshot.NamedSessions {
			fmt.Fprintf(stdout, "  %-24s%s (%s)\n", named.Identity, named.Status, named.Mode) //nolint:errcheck // best-effort stdout
		}
	}

	if len(snapshot.Rigs) > 0 {
		fmt.Fprintln(stdout) //nolint:errcheck // best-effort stdout
		fmt.Fprintln(stdout, "Rigs:")
		for _, r := range snapshot.Rigs {
			annotation := ""
			if r.Suspended {
				annotation = "  (suspended)"
			}
			fmt.Fprintf(stdout, "  %-24s%s%s\n", r.Name, r.Path, annotation) //nolint:errcheck // best-effort stdout
		}
	}
}
