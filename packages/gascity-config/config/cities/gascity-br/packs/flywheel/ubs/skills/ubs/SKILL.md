---
name: ubs
description: Run Ultimate Bug Scanner on staged or changed code before commits and risky handoffs.
---

# Ultimate Bug Scanner

Use `ubs` as a pre-commit and high-risk-change scan:

```bash
ubs --staged --format=json
ubs --format=json <path>
```

Treat findings as review input. Fix true positives before committing; document
false positives in the bead notes or handoff.
