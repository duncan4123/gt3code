# Basic Test Plan

## Purpose

Provide a simple, repeatable checklist for validating changes before they are considered done.

## Scope

- Unit tests for changed code paths
- Integration tests for affected modules or services
- Manual smoke testing for the user-facing flow, if applicable
- Build, lint, and type-check validation

## Test Approach

1. Identify the files, features, or modules touched by the change.
2. Run the smallest relevant automated tests first.
3. Expand to nearby integration or end-to-end coverage if the change crosses boundaries.
4. Perform a short manual check of the main user flow when UI or behavior changes are involved.
5. Confirm the project passes required quality checks.

## Pass Criteria

- Relevant tests pass without failures
- No new type errors
- No lint or formatting issues
- Main workflow behaves as expected
- Any regressions are understood and documented

## Suggested Commands

- `bun run test`
- `bun fmt`
- `bun lint`
- `bun typecheck`

## Notes

- Keep the plan lightweight and focused on the change being made.
- Add project-specific cases here as the codebase grows.
