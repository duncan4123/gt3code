package main

import (
	"encoding/json"
	"testing"
)

func TestBuildStartupEnvelope_UsesTemplateForGroupingAgent(t *testing.T) {
	tp := TemplateParams{
		TemplateName: "t3code/polecat",
		InstanceName: "t3code/polecat-1",
		SessionName:  "t3code--polecat-1",
		WorkDir:      "/data/projects/gc/.gc/worktrees/t3code/polecat/furiosa",
		Command:      "codex",
		Env: map[string]string{
			"GC_CITY_PATH":    "/data/projects/gc",
			"GC_PROVIDER":     "codex",
			"GC_AGENT":        "t3code/polecat-1",
			"GC_TEMPLATE":     "t3code/polecat",
			"GC_SESSION_NAME": "t3code--polecat-1",
		},
	}

	raw := buildStartupEnvelope(tp, "prime")
	var envelope map[string]any
	if err := json.Unmarshal(raw, &envelope); err != nil {
		t.Fatalf("unmarshal envelope: %v", err)
	}

	gc, ok := envelope["gc"].(map[string]any)
	if !ok {
		t.Fatalf("gc section missing: %#v", envelope["gc"])
	}
	if got := gc["agent"]; got != "t3code/polecat" {
		t.Fatalf("gc.agent = %#v, want t3code/polecat", got)
	}
	if got := gc["template"]; got != "t3code/polecat" {
		t.Fatalf("gc.template = %#v, want t3code/polecat", got)
	}
	if got := gc["sessionName"]; got != "t3code--polecat-1" {
		t.Fatalf("gc.sessionName = %#v, want t3code--polecat-1", got)
	}
}

func TestBuildStartupEnvelope_NamedSessionPublishesQualifiedTemplateIdentity(t *testing.T) {
	tp := TemplateParams{
		TemplateName:             "t3code/gastown.crew",
		InstanceName:             "t3code/gastown.crew",
		Alias:                    "t3code/gastown.crew",
		SessionName:              "t3code--gastown__crew",
		EffectiveSessionProvider: "t3bridge",
		WorkDir:                  "/data/projects/gc/.gc/worktrees/t3code/crew/gastown.crew",
		Command:                  "codex",
		Env: map[string]string{
			"GC_CITY_PATH":    "/data/projects/gc",
			"GC_PROVIDER":     "codex",
			"GC_AGENT":        "t3code/gastown.crew",
			"GC_TEMPLATE":     "t3code/gastown.crew",
			"GC_SESSION_NAME": "t3code--gastown__crew",
		},
	}

	raw := buildStartupEnvelope(tp, "prime")
	var envelope map[string]any
	if err := json.Unmarshal(raw, &envelope); err != nil {
		t.Fatalf("unmarshal envelope: %v", err)
	}

	gc, ok := envelope["gc"].(map[string]any)
	if !ok {
		t.Fatalf("gc section missing: %#v", envelope["gc"])
	}
	if got := gc["template"]; got != "t3code/gastown.crew" {
		t.Fatalf("gc.template = %#v, want t3code/gastown.crew", got)
	}
}

func TestBuildStartupEnvelope_FreshWakeDisablesThreadReuse(t *testing.T) {
	tp := TemplateParams{
		TemplateName:             "context-mode/crew",
		InstanceName:             "context-mode/crew",
		SessionName:              "context-mode--crew-mcp",
		EffectiveSessionProvider: "t3bridge",
		WakeMode:                 "fresh",
		WorkDir:                  "/home/ubuntu/.t3/worktrees/gascity/context-mode/crew/crew-mcp",
		Command:                  "codex",
		Env: map[string]string{
			"GC_CITY_PATH":    "/data/projects/t3code/packages/gascity-config/config",
			"GC_PROVIDER":     "codex",
			"GC_AGENT":        "context-mode/crew-mcp",
			"GC_TEMPLATE":     "context-mode/crew",
			"GC_SESSION_NAME": "context-mode--crew-mcp",
		},
	}

	raw := buildStartupEnvelope(tp, "prime")
	var envelope map[string]any
	if err := json.Unmarshal(raw, &envelope); err != nil {
		t.Fatalf("unmarshal envelope: %v", err)
	}
	resume, ok := envelope["resume"].(map[string]any)
	if !ok {
		t.Fatalf("resume section missing: %#v", envelope["resume"])
	}
	if got := resume["allowThreadReuse"]; got != false {
		t.Fatalf("resume.allowThreadReuse = %#v, want false", got)
	}
}
