package t3bridge

import "testing"

func TestAllowThreadReuse_NamedFreshCreatesNewThread(t *testing.T) {
	if allowThreadReuse(AgentKindNamed, "fresh") {
		t.Fatal("named fresh sessions should create a new T3 thread")
	}
}

func TestAllowThreadReuse_NamedResumeReusesThread(t *testing.T) {
	if !allowThreadReuse(AgentKindNamed, "resume") {
		t.Fatal("named resume sessions should reuse their T3 thread")
	}
}

func TestAllowThreadReuse_PoolDoesNotReuseThread(t *testing.T) {
	if allowThreadReuse(AgentKindPool, "sticky") {
		t.Fatal("pool sessions should not reuse one shared T3 thread")
	}
}
