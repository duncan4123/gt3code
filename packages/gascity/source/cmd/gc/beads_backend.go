package main

import (
	"fmt"
	"io"
	"os/exec"
	"strings"

	"github.com/gastownhall/gascity/internal/beads"
	beadsexec "github.com/gastownhall/gascity/internal/beads/exec"
)

type beadsBackendRequest struct {
	Provider        string
	RuntimeCityPath string
	ScopeRoot       string
}

type beadsBackendOpener func(beadsBackendRequest) (beads.Store, error)
type beadsBackendOptimizer func(beadsBackendRequest, beads.Store) (beads.Store, bool)

var (
	beadsBackendOpeners      = map[string]beadsBackendOpener{}
	bdBeadsBackendOptimizers []beadsBackendOptimizer
)

func init() {
	registerBeadsBackendOpener("bd", openBdBeadsBackend)
	registerBeadsBackendOpener("file", openFileBeadsBackend)
}

func registerBeadsBackendOpener(provider string, opener beadsBackendOpener) {
	provider = strings.TrimSpace(provider)
	if provider == "" || opener == nil {
		return
	}
	beadsBackendOpeners[provider] = opener
}

func registerBdBeadsBackendOptimizer(optimizer beadsBackendOptimizer) {
	if optimizer != nil {
		bdBeadsBackendOptimizers = append(bdBeadsBackendOptimizers, optimizer)
	}
}

func openBeadsBackendStore(req beadsBackendRequest) (beads.Store, error) {
	provider := strings.TrimSpace(req.Provider)
	if strings.HasPrefix(provider, "exec:") {
		return openExecBeadsBackend(req)
	}
	if opener, ok := beadsBackendOpeners[provider]; ok {
		return opener(req)
	}
	return openBdBeadsBackend(req)
}

func openExecBeadsBackend(req beadsBackendRequest) (beads.Store, error) {
	target, err := resolveConfiguredExecStoreTarget(req.RuntimeCityPath, req.ScopeRoot)
	if err != nil {
		return nil, err
	}
	env := gcExecStoreEnv(req.RuntimeCityPath, target, req.Provider)
	if execProviderNeedsScopedDoltStoreEnv(req.Provider) {
		if target.ScopeKind == "rig" {
			cfg, err := loadCityConfig(req.RuntimeCityPath, io.Discard)
			if err != nil {
				return nil, err
			}
			projected, err := bdRuntimeEnvForRigWithError(req.RuntimeCityPath, cfg, target.ScopeRoot)
			if err != nil {
				return nil, err
			}
			copyExecProjectedBackendEnv(env, projected)
		} else {
			projected, err := bdRuntimeEnvWithError(req.RuntimeCityPath)
			if err != nil {
				return nil, err
			}
			copyExecProjectedBackendEnv(env, projected)
		}
	}
	store := beadsexec.NewStore(strings.TrimPrefix(req.Provider, "exec:"))
	store.SetEnv(env)
	return store, nil
}

func openFileBeadsBackend(req beadsBackendRequest) (beads.Store, error) {
	return openCompatibleFileStore(req.ScopeRoot, req.RuntimeCityPath)
}

func openBdBeadsBackend(req beadsBackendRequest) (beads.Store, error) {
	if _, err := exec.LookPath("bd"); err != nil {
		return nil, fmt.Errorf("bd not found in PATH (install beads or set GC_BEADS=file)")
	}
	store, err := openBdStoreAt(req.ScopeRoot, req.RuntimeCityPath)
	if err != nil {
		return nil, err
	}
	for _, optimizer := range bdBeadsBackendOptimizers {
		if optimized, ok := optimizer(req, store); ok {
			return optimized, nil
		}
	}
	return store, nil
}
