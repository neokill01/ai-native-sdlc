# AGENT.md

This file gives an agent working in this repo the first-day context it needs. It mirrors the `CLAUDE.md` pattern from the playbook, kept tool-agnostic and to one page.

## What this repo is

A **methodology (not a product)**: the AI-Native SDLC loop (intent → spec → plan → code+tests → PR → incident → back to intent) packaged as reusable artifacts, guards, and evals. Tool-agnostic: works with Claude Code / Codex / DeepSeek Harness (DSH). Think "how to use AI to do any project" — adapting Anthropic's *AI-Native SDLC Playbook* to a solo/small team.

## Structure

- `docs/playbook.md` — the methodology (start here). `docs/adoption.md` — maturity ladder.
- `artifacts/` — committed-artifact templates (intent/spec/plan/review/bands/incident). **The spine.**
- `agents/skills/<name>/SKILL.md` — advisory institutional knowledge. `agents/hooks/*.sh` — deterministic guardrails (exit 0 allow / exit 2 block).
- `evals/` — continuous regression suite. `evals/check.sh` runs it.
- `infra/bands.yaml` — monitoring control bands. `examples/` — worked examples against real projects.

## Commands

- Run evals: `./evals/check.sh` (repo-local must pass; project evals skip if their repo isn't checked out).
- Verify a hook: pipe a JSON op into `./agents/hooks/<name>.sh`, check the exit code.
- Format: keep documents Chinese-primary with key terms in English (per repo convention).

## Key conventions / things agents get wrong

1. **Don't hardcode configurable params** — anything the admin config can tune must read `system_config` (see `agents/skills/configurable-params`). We found a real bug from this.
2. **Preserve the artifact chain** — a stage isn't done until its artifact is committed; the next stage reads it.
3. **Skills advise, Hooks enforce** — advisory knowledge goes in a skill; a policy that must never be violated gets a deterministic hook behind it.
4. **Default-value drift** — `ReviewDefaults` must stay in sync with `AdminService.REVIEW_DEFAULT` (single source, comment-enforced).
5. **Cross-repo coupling** — `evals/*.json` with `"project": "..."` run in that project's own CI, not here. Don't make AINative's CI depend on other repos.

## Common mistakes (add as you hit them)

- Editing the shipped Agent preset install instead of a copy.
- Writing a hook that's slow (must be fast, scoped to changed files).
- Making a change that breaks the default path behavior (must stay identical under defaults).
