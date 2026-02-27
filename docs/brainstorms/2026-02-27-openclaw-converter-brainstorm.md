# Brainstorm: OpenClaw Converter Target

**Date:** 2026-02-27
**Status:** Ready for planning
**Feature:** Add OpenClaw as a converter target in the CLI tool

## What We're Building

A new converter target (`openclaw`) for the existing CLI tool that converts the Compound Engineering Claude Code plugin into OpenClaw's skill and agent format. This follows the established three-file pattern (`src/types/openclaw.ts`, `src/converters/claude-to-openclaw.ts`, `src/targets/openclaw.ts`) used by all other converter targets.

OpenClaw (https://openclaw.ai, https://github.com/openclaw/openclaw) is an open-source personal AI assistant that runs locally and connects via messaging channels (WhatsApp, Telegram, Slack, etc.). It has a skill system nearly identical to Claude Code's SKILL.md format, making it a natural conversion target.

### Goal

All benefits of the Compound Engineering plugin — structured workflows, specialist agents, sub-agent orchestration — should be fully usable within OpenClaw. The converter must be extensible so as the plugin grows, the converter continues to work without manual updates.

## Why This Approach

### Agents → Skills (not OpenClaw Agents)

Claude Code agents (30 single `.md` files with specialist system prompts) will be converted to OpenClaw skills with `user-invocable: true`, not OpenClaw agent configurations. Rationale:

- **Format compatibility**: OpenClaw's SKILL.md format is nearly identical to Claude Code's — YAML frontmatter + Markdown body. Minimal transformation needed.
- **Scalability**: OpenClaw's multi-agent system is designed for 2-5 agents, not 30 peers. Skills scale naturally — adding a new Claude agent just means a new skill directory.
- **Selective loading**: Skills are loaded contextually per conversation, not all 30 at once. Avoids context window bloat.
- **Sub-agent patterns**: Workflow orchestration that spawns specialist agents (e.g., `/review` spawning 5 reviewer agents) maps to OpenClaw's `sessions_spawn` tool running skills in parallel sub-agents.

Alternatives considered:
- **Merge into AGENTS.md**: Would bloat context with all 30 agent prompts at once. Not selective.
- **One agent per identity**: OpenClaw supports max 2-level nesting. 30 separate agents would overwhelm the system.

### Commands → User-Invocable Skills

Claude Code commands (slash commands like `/workflows:plan`) become OpenClaw skills with `user-invocable: true`. The namespace flattening pattern from other converters applies: `workflows:plan` → `plan` or `workflows-plan`.

### Full Content Rewrite

All internal references will be fully rewritten to OpenClaw equivalents:

| Claude Code | OpenClaw |
|-------------|----------|
| `Task agent(...)` | `sessions_spawn` instructions |
| `Bash` tool | `exec` tool |
| `Read` tool | `read` tool |
| `Write` tool | `write` tool |
| `Edit` tool | `edit` tool |
| `Glob` / `Grep` | `exec` with find/grep |
| `WebFetch` / `WebSearch` | `web_fetch` / `web_search` |
| `~/.claude/` paths | `~/.openclaw/` paths |
| `.claude/` paths | `.openclaw/` paths |
| `/workflows:name` references | `/name` or skill references |
| `@agent-name` references | skill name references |

### Skip MCP Servers

OpenClaw does not use the MCP protocol — it has built-in Gateway tools and a plugin system. MCP servers (currently just context7) will be skipped with a note in the output indicating what was not converted.

### Inferred Metadata

The converter will generate OpenClaw's extended skill metadata by inference:
- **Emoji**: Inferred from agent/skill type (e.g., review agents get a magnifying glass, workflow skills get a gear)
- **Required binaries**: Detected from skill content (e.g., if a skill references `git`, add `bins: ["git"]`)
- **OS restrictions**: Set only if platform-specific content is detected
- **Environment variables**: Extracted if skill content references specific API keys

## Key Decisions

1. **Claude agents become OpenClaw skills** with `user-invocable: true` — not OpenClaw agent configurations
2. **Claude commands become OpenClaw skills** with `user-invocable: true` and namespace flattening
3. **Claude skills pass through** with OpenClaw metadata extensions added to frontmatter
4. **Full content rewrite** — all tool names, paths, and orchestration patterns rewritten to OpenClaw equivalents
5. **MCP servers are skipped** — documented as not converted
6. **Metadata is inferred** — emoji, binary requirements, env vars detected from content
7. **Follows the three-file pattern** — types, converter, target writer, registered in `src/targets/index.ts`

## Component Mapping Summary

| Claude Plugin Component | OpenClaw Output | Location |
|------------------------|-----------------|----------|
| `agents/*.md` | Skills (user-invocable) | `skills/{name}/SKILL.md` |
| `commands/*.md` | Skills (user-invocable) | `skills/{name}/SKILL.md` |
| `skills/*/` | Skills (pass-through + metadata) | `skills/{name}/SKILL.md` |
| MCP servers | Skipped (documented) | — |
| `CLAUDE.md` | Not converted (agent workspace files are user-managed) | — |

## Output Structure

```
~/.openclaw/skills/          # or workspace skills/
├── kieran-rails-reviewer/
│   └── SKILL.md             # From agent: kieran-rails-reviewer.md
├── performance-oracle/
│   └── SKILL.md             # From agent: performance-oracle.md
├── plan/
│   └── SKILL.md             # From command: workflows:plan
├── review/
│   └── SKILL.md             # From command: workflows:review
├── brainstorm/
│   └── SKILL.md             # From command: workflows:brainstorm
├── gemini-imagegen/
│   ├── SKILL.md             # Pass-through from skill
│   └── scripts/             # Copied from original
└── ...
```

## SKILL.md Output Format

```markdown
---
name: kieran-rails-reviewer
description: "Reviews Rails code with an extremely high quality bar for conventions, clarity, and maintainability."
user-invocable: true
metadata:
  openclaw:
    emoji: "🔍"
    requires:
      bins: ["ruby"]
---

# Kieran Rails Reviewer

[Rewritten agent body with OpenClaw tool references]
```

## Open Questions

None — all key decisions have been resolved through the brainstorming dialogue.
