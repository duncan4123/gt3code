{{ define "ubs-scan" }}

## Ultimate Bug Scanner

Before committing code or handing off risky edits, run:

```bash
ubs --staged --format=json || true
```

Fix true positives. If `ubs` is unavailable or returns a tooling failure, note
that in the bead or handoff and continue with normal review.
{{ end }}
