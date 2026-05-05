package main

import (
	"bytes"
	"strings"
	"testing"
)

func TestRuntimeHelpArgPrintsHelp(t *testing.T) {
	var stdout, stderr bytes.Buffer
	code := run([]string{"runtime", "help"}, &stdout, &stderr)
	if code != 0 {
		t.Fatalf("gc runtime help exited %d: %s", code, stderr.String())
	}
	if got := stdout.String(); !strings.Contains(got, "Process-intrinsic runtime operations") ||
		!strings.Contains(got, "drain-check") {
		t.Fatalf("help output missing runtime details:\n%s", got)
	}
}
