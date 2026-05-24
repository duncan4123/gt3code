package main

import (
	"context"
	"testing"
	"time"

	"github.com/gastownhall/gascity/internal/runtime"
)

type slowStatusProvider struct {
	runtime.Provider
	delay time.Duration
}

func (p *slowStatusProvider) IsRunning(name string) bool {
	time.Sleep(p.delay)
	return p.Provider.IsRunning(name)
}

func TestStatusProviderAllowsModerateRuntimeLatency(t *testing.T) {
	oldTimeout := statusProviderCallTimeout
	oldWindow := statusProviderDegradeWindow
	statusProviderCallTimeout = 200 * time.Millisecond
	statusProviderDegradeWindow = time.Millisecond
	t.Cleanup(func() {
		statusProviderCallTimeout = oldTimeout
		statusProviderDegradeWindow = oldWindow
	})

	base := runtime.NewFake()
	if err := base.Start(context.Background(), "worker", runtime.Config{Command: "echo"}); err != nil {
		t.Fatalf("Start: %v", err)
	}

	sp := newBoundedStatusProvider(&slowStatusProvider{
		Provider: base,
		delay:    100 * time.Millisecond,
	})
	if !sp.IsRunning("worker") {
		t.Fatal("IsRunning returned false for a running session after moderate runtime latency")
	}
}
