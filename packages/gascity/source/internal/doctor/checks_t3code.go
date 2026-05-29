package doctor

import (
	"context"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

// ── t3code-provider ── ports 3773, 4096, 33269 + API health ──────────────────

type T3CodeProviderCheck struct{}

func (c *T3CodeProviderCheck) Name() string          { return "t3code-provider" }
func (c *T3CodeProviderCheck) CanFix() bool           { return false }
func (c *T3CodeProviderCheck) Fix(_ *CheckContext) error { return nil }
func (c *T3CodeProviderCheck) WarmupEligible() bool   { return false }

func (c *T3CodeProviderCheck) Run(_ *CheckContext) *CheckResult {
	r := &CheckResult{Name: c.Name()}
	services := map[string]string{
		"t3code-server":     "3773",
		"opencode-server":   "4096",
		"gc-supervisor-api": "33269",
	}
	var failures []string
	for name, port := range services {
		if !portOpen("127.0.0.1", port, 2*time.Second) {
			failures = append(failures, fmt.Sprintf("%s (port %s)", name, port))
		}
	}
	if len(failures) > 0 {
		r.Status = StatusWarning
		r.Message = fmt.Sprintf("%d of %d services unreachable: %v", len(failures), len(services), failures)
		r.FixHint = "T3 Code dev server: T3CODE_ALLOW_NON_LIVE_DEV=1 bun run dev:server &\nOpenCode server: opencode serve --port 4096 &"
		return r
	}
	if !checkHTTPOK("http://127.0.0.1:33269/health") {
		r.Status = StatusWarning
		r.Message = "GC supervisor API is reachable but /health reports not ready"
		r.FixHint = "Wait for city startup to complete, or run gc restart"
		return r
	}
	r.Status = StatusOK
	r.Message = "T3 Code ←→ Gas City integration: all core services reachable and healthy"
	return r
}

// ── t3code-web ── port 5733 ──────────────────────────────────────────────────

type T3CodeWebCheck struct{}

func (c *T3CodeWebCheck) Name() string          { return "t3code-web" }
func (c *T3CodeWebCheck) CanFix() bool           { return false }
func (c *T3CodeWebCheck) Fix(_ *CheckContext) error { return nil }
func (c *T3CodeWebCheck) WarmupEligible() bool   { return false }

func (c *T3CodeWebCheck) Run(_ *CheckContext) *CheckResult {
	r := &CheckResult{Name: c.Name()}
	if !portOpen("127.0.0.1", "5733", 2*time.Second) {
		r.Status = StatusWarning
		r.Message = "T3 Code web UI (port 5733) not reachable"
		r.FixHint = "T3CODE_ALLOW_NON_LIVE_DEV=1 bun run dev:web &"
		return r
	}
	if !checkHTTPOK("http://localhost:5733/") {
		r.Status = StatusWarning
		r.Message = "T3 Code web UI is reachable but not serving content"
		r.FixHint = "Check Vite dev server logs"
		return r
	}
	r.Status = StatusOK
	r.Message = "T3 Code web UI reachable at http://localhost:5733/"
	return r
}

// ── t3code-opencode-binary ── opencode in PATH ───────────────────────────────

type T3CodeOpenCodeBinaryCheck struct{}

func (c *T3CodeOpenCodeBinaryCheck) Name() string          { return "t3code-opencode-binary" }
func (c *T3CodeOpenCodeBinaryCheck) CanFix() bool           { return false }
func (c *T3CodeOpenCodeBinaryCheck) Fix(_ *CheckContext) error { return nil }
func (c *T3CodeOpenCodeBinaryCheck) WarmupEligible() bool   { return false }

func (c *T3CodeOpenCodeBinaryCheck) Run(_ *CheckContext) *CheckResult {
	r := &CheckResult{Name: c.Name()}
	path, err := exec.LookPath("opencode")
	if err != nil {
		r.Status = StatusWarning
		r.Message = "opencode binary not found in PATH"
		r.FixHint = "Install opencode or add it to PATH"
		return r
	}
	r.Status = StatusOK
	r.Message = fmt.Sprintf("opencode binary found at %s", path)
	return r
}

// ── t3code-gc-api-phase ── check startup phase ───────────────────────────────

type T3CodeGCApiPhaseCheck struct{}

func (c *T3CodeGCApiPhaseCheck) Name() string          { return "t3code-gc-api-phase" }
func (c *T3CodeGCApiPhaseCheck) CanFix() bool           { return false }
func (c *T3CodeGCApiPhaseCheck) Fix(_ *CheckContext) error { return nil }
func (c *T3CodeGCApiPhaseCheck) WarmupEligible() bool   { return false }

type gcHealthResponse struct {
	Startup struct {
		Phase           string   `json:"phase"`
		PhasesCompleted []string `json:"phases_completed"`
	} `json:"startup"`
}

func (c *T3CodeGCApiPhaseCheck) Run(_ *CheckContext) *CheckResult {
	r := &CheckResult{Name: c.Name()}
	body, err := httpGet("http://127.0.0.1:33269/health")
	if err != nil {
		r.Status = StatusWarning
		r.Message = fmt.Sprintf("Cannot reach GC supervisor API: %v", err)
		return r
	}
	var health gcHealthResponse
	if err := json.Unmarshal(body, &health); err != nil {
		r.Status = StatusWarning
		r.Message = fmt.Sprintf("GC /health response unparseable: %v", err)
		return r
	}
	switch health.Startup.Phase {
	case "running":
		r.Status = StatusOK
		r.Message = fmt.Sprintf("GC city startup complete — phase=running, phases=%v", health.Startup.PhasesCompleted)
	case "adopting_sessions":
		r.Status = StatusWarning
		r.Message = "GC city stuck in adopting_sessions — bd list query may be slow (see bead gd-bdop)"
		r.FixHint = "Wait or check bd list performance; see docs/gc-t3code-health-check.md"
	case "":
		r.Status = StatusWarning
		r.Message = "GC city not running — no startup phase reported"
		r.FixHint = "Run: gc register <path> && gc start <path>"
	default:
		r.Status = StatusWarning
		r.Message = fmt.Sprintf("GC city phase=%s (not running yet)", health.Startup.Phase)
	}
	return r
}

// ── t3code-provider-model ── validate GC_MODEL slug ──────────────────────────

type T3CodeProviderModelCheck struct{}

func (c *T3CodeProviderModelCheck) Name() string          { return "t3code-provider-model" }
func (c *T3CodeProviderModelCheck) CanFix() bool           { return false }
func (c *T3CodeProviderModelCheck) Fix(_ *CheckContext) error { return nil }
func (c *T3CodeProviderModelCheck) WarmupEligible() bool   { return false }

func (c *T3CodeProviderModelCheck) Run(ctx *CheckContext) *CheckResult {
	r := &CheckResult{Name: c.Name()}

	packPath := filepath.Join(ctx.CityPath, "pack.toml")
	data, err := os.ReadFile(packPath)
	if err != nil {
		r.Status = StatusOK
		r.Message = "skipped — could not read pack.toml"
		return r
	}
	var model string
	for _, line := range strings.Split(string(data), "\n") {
		trimmed := strings.TrimSpace(line)
		if strings.HasPrefix(trimmed, "GC_MODEL") {
			parts := strings.SplitN(trimmed, "=", 2)
			if len(parts) == 2 {
				model = strings.Trim(strings.TrimSpace(parts[1]), `"`)
			}
		}
	}
	if model == "" {
		r.Status = StatusOK
		r.Message = "no GC_MODEL configured — using opencode default"
		return r
	}

	valid, err := modelExistsInOpenCode(model)
	if err != nil {
		r.Status = StatusWarning
		r.Message = fmt.Sprintf("Cannot verify model slug %q: %v", model, err)
		return r
	}
	if !valid {
		r.Status = StatusError
		r.Message = fmt.Sprintf("Model slug %q not found in opencode model list — check prefix (opencode/ vs deepseek/ vs openrouter/)", model)
		r.FixHint = "Run: opencode models | grep deepseek\nCorrect model paths are deepseek/deepseek-v4-pro, deepseek/deepseek-v4-flash, opencode/deepseek-v4-flash-free"
		return r
	}
	r.Status = StatusOK
	r.Message = fmt.Sprintf("Provider model %q is valid", model)
	return r
}

func modelExistsInOpenCode(slug string) (bool, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, "opencode", "models")
	out, err := cmd.Output()
	if err != nil {
		return false, fmt.Errorf("opencode models: %w", err)
	}
	for _, line := range strings.Split(string(out), "\n") {
		if strings.TrimSpace(line) == slug {
			return true, nil
		}
	}
	return false, nil
}

// ── t3code-state-db ── state files present ───────────────────────────────────

type T3CodeStateDBCheck struct{}

func (c *T3CodeStateDBCheck) Name() string          { return "t3code-state-db" }
func (c *T3CodeStateDBCheck) CanFix() bool           { return false }
func (c *T3CodeStateDBCheck) Fix(_ *CheckContext) error { return nil }
func (c *T3CodeStateDBCheck) WarmupEligible() bool   { return false }

func (c *T3CodeStateDBCheck) Run(ctx *CheckContext) *CheckResult {
	r := &CheckResult{Name: c.Name()}
	// Walk up from city path to find workspace root with .t3-dev/dev/
	// city path: .../packages/gascity-config/config/cities/gastown-dolt
	// workspace: ../../../../..  (5 levels up)
	dir := filepath.Join(ctx.CityPath, "..", "..", "..", "..", "..", ".t3-dev", "dev")
	statePath := filepath.Join(dir, "state.sqlite")
	projPath := filepath.Join(dir, "state-proj.sqlite")
	stateOK := fileExists(statePath)
	projOK := fileExists(projPath)
	if !stateOK && !projOK {
		r.Status = StatusWarning
		r.Message = "T3 Code state DB files not found — T3 server may not have been started"
		r.FixHint = "Start T3 server: T3CODE_ALLOW_NON_LIVE_DEV=1 bun run dev:server &"
		return r
	}
	if !projOK {
		r.Status = StatusWarning
		r.Message = "T3 Code state-proj.sqlite (sidecar) missing — FTS inserts will fail"
		r.FixHint = "Delete state.sqlite and state-proj.sqlite, then restart T3 server to recreate both"
		return r
	}
	if !stateOK {
		r.Status = StatusWarning
		r.Message = "T3 Code state.sqlite missing but sidecar exists — migration state lost"
		r.FixHint = "Delete state-proj.sqlite and restart T3 server to recreate both"
		return r
	}
	r.Status = StatusOK
	r.Message = fmt.Sprintf("T3 Code state DB files present (%s, %s)", statePath, projPath)
	return r
}

// ── t3code-bd-query-health ── bd ready responsiveness ────────────────────────

type T3CodeBdQueryHealthCheck struct{}

func (c *T3CodeBdQueryHealthCheck) Name() string          { return "t3code-bd-query-health" }
func (c *T3CodeBdQueryHealthCheck) CanFix() bool           { return false }
func (c *T3CodeBdQueryHealthCheck) Fix(_ *CheckContext) error { return nil }
func (c *T3CodeBdQueryHealthCheck) WarmupEligible() bool   { return false }

func (c *T3CodeBdQueryHealthCheck) Run(_ *CheckContext) *CheckResult {
	r := &CheckResult{Name: c.Name()}
	start := time.Now()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, "bd", "ready", "--json")
	out, err := cmd.Output()
	elapsed := time.Since(start)
	if err != nil {
		r.Status = StatusWarning
		r.Message = fmt.Sprintf("bd ready failed after %v: %v — query may be stuck", elapsed, err)
		r.FixHint = "bd list query bottleneck — see bead gd-bdop and docs/gc-t3code-health-check.md"
		return r
	}
	if elapsed > 8*time.Second {
		r.Status = StatusWarning
		r.Message = fmt.Sprintf("bd ready took %v (>8s threshold) — query performance degraded", elapsed)
		r.FixHint = "Optimize bd list query (search_counts.go:120-179) — see bead gd-bdop"
		return r
	}
	r.Status = StatusOK
	r.Message = fmt.Sprintf("bd ready responsive (%v, %d bytes)", elapsed, len(out))
	return r
}

// ── helpers ───────────────────────────────────────────────────────────────────

func portOpen(host, port string, timeout time.Duration) bool {
	conn, err := net.DialTimeout("tcp", net.JoinHostPort(host, port), timeout)
	if err != nil {
		return false
	}
	conn.Close()
	return true
}

func checkHTTPOK(url string) bool {
	client := &http.Client{Timeout: 3 * time.Second}
	resp, err := client.Get(url)
	if err != nil {
		return false
	}
	defer resp.Body.Close()
	return resp.StatusCode == 200
}

func httpGet(url string) ([]byte, error) {
	client := &http.Client{Timeout: 3 * time.Second}
	resp, err := client.Get(url)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	body := make([]byte, 4096)
	n, _ := resp.Body.Read(body)
	return body[:n], nil
}

func fileExists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}
