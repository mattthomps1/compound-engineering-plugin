---
title: "feat: Add OpenClaw Converter Target"
type: feat
status: active
date: 2026-02-27
---

# feat: Add OpenClaw Converter Target

## Enhancement Summary

**Deepened on:** 2026-02-27
**Sections enhanced:** 8
**Research agents used:** Pi converter deep analysis, Gemini converter patterns, Architecture review, Performance review, Code simplicity review, Learnings relevance check, OpenClaw skill best practices, TypeScript converter patterns

### Key Improvements

1. **Simplified metadata inference** — Defer full metadata inference to v2; v1 generates only emoji (trivial lookup). Reduces ~60 LOC of scanning logic and eliminates false-positive risk for `requires.bins` and `requires.env`.
2. **Reduced tool map to proven entries** — Cut speculative mappings (NotebookEdit, NotebookRead, ExitPlanMode, LS, Bash(pattern:*), Skill(name)) that don't appear in actual agent/command bodies. Keeps 10 core mappings.
3. **Added regression test** — New acceptance criterion: scan all output SKILL.md files for residual Claude-specific patterns (`/Claude|\.claude|Bash|Read tool|Write tool/`) to catch missed transformations.
4. **Parallelize file I/O** — Writer uses `Promise.all` for generated skill writes and skill directory copies.
5. **OpenClaw validation rules documented** — Skill names must match `^[a-z0-9][a-z0-9-]*$` (max 64 chars), descriptions max 1024 chars, SKILL.md should stay under 500 lines.

### New Considerations Discovered

- OpenClaw has a soft limit of 100 user-invocable skills (Telegram channel constraint). Current plugin produces ~62 skills — safe but worth monitoring.
- OpenClaw skills reference tools in natural language prose, not formal `ToolName(args)` syntax. Content transformer should produce prose-style references.
- The `resolveOpenClawPaths()` function is unnecessary — output is flat. Remove it.

---

## Overview

Add OpenClaw (https://openclaw.ai) as a new converter target in the Compound Engineering CLI tool. OpenClaw is an open-source personal AI assistant that uses a SKILL.md format nearly identical to Claude Code's. The converter transforms Claude Code agents, commands, and skills into OpenClaw-compatible skills, following the established three-file pattern used by all 6 existing targets.

## Problem Statement / Motivation

The Compound Engineering plugin provides 30 agents, 23 commands, and 22 skills that encode valuable workflow patterns (structured code review, planning, brainstorming, research). OpenClaw users currently cannot leverage these workflows. Since OpenClaw's skill format is close to Claude Code's SKILL.md, a converter can bridge the gap with manageable effort while following the proven converter architecture.

## Proposed Solution

### Component Mapping

| Claude Plugin Component | OpenClaw Output | Output Path |
|------------------------|-----------------|-------------|
| `agents/*.md` (30) | Skills (`user-invocable: true`) | `skills/{name}/SKILL.md` |
| `commands/*.md` (invocable, ~10) | Skills (`user-invocable: true`) | `skills/{name}/SKILL.md` |
| `commands/*.md` (non-invocable, ~13) | **Skipped** (matches Pi/Codex precedent) | — |
| `skills/*/` (22) | Pass-through + metadata + body rewrite | `skills/{name}/SKILL.md` + subdirs |
| MCP servers | **Skipped** (documented) | — |
| Hooks | **Skipped** with warning (matches Cursor precedent) | — |

### Research Insights: Component Mapping

**OpenClaw Validation Rules:**
- Skill names must match `^[a-z0-9][a-z0-9-]*$`, max 64 characters
- Skill descriptions max 1024 characters (truncate with ellipsis if exceeded)
- SKILL.md files should stay under 500 lines for optimal context loading
- `user-invocable` defaults to `true` in OpenClaw — only set explicitly for clarity
- Total user-invocable skill limit: ~100 (Telegram channel constraint). Current plugin produces ~62 — safe headroom

**Pi Converter Precedent:**
- Pi's `convertAgentToSkill()` maps directly: agent body becomes skill body, frontmatter fields are selectively preserved/transformed. OpenClaw converter should follow the same pattern.
- Pi filters non-invocable commands with: `plugin.commands.filter((c) => !c.disableModelInvocation)` — reuse this exact filter.

### Content Transformation

Full rewrite of all Claude Code-specific references to OpenClaw equivalents.

**Tool Name Mapping (10 core entries):**

| Claude Code Tool | OpenClaw Equivalent |
|-----------------|---------------------|
| `Bash` | `exec` |
| `Read` | `read` |
| `Write` | `write` |
| `Edit` | `edit` |
| `MultiEdit` | `edit` |
| `Glob` | `exec` with `find` |
| `Grep` | `exec` with `grep` |
| `WebFetch` | `web_fetch` |
| `WebSearch` | `web_search` |
| `Task` (sub-agent calls) | `sessions_spawn` |

**Handled inline (no map entry needed):**
- `AskUserQuestion` → Rewrite to inline prompt instruction in prose
- `TodoWrite` / `TodoRead` → Rewrite to inline task tracking instruction in prose
- `NotebookEdit` / `NotebookRead` → Drop (no equivalent, not referenced in agent bodies)
- `ExitPlanMode` → Drop (not referenced in agent bodies)

**Path Rewriting:**

| Pattern | Replacement |
|---------|-------------|
| `~/.claude/` | `~/.openclaw/` |
| `.claude/` | `.openclaw/` |
| `/workflows:name` | `/name` |
| `@agent-name` (known suffixes only) | `the agent-name skill` |

**`@` Reference Safety:** Only transform `@` references matching known agent role suffixes (`-reviewer`, `-researcher`, `-analyst`, `-specialist`, `-guardian`, `-oracle`, `-sentinel`, `-strategist`, `-detector`, `-expert`, `-writer`, `-editor`). This prevents false positives on DOM refs (`@e1`), Python decorators (`@property`), and email addresses.

**Slash Command Safety:** Exclude known non-command patterns: XML closing tags (`</`), Unix paths (`/dev`, `/tmp`, `/usr`, `/etc`, `/var`, `/bin`, `/home`), and paths starting with `./` or `../`.

### Research Insights: Content Transformation

**Prose-Style Tool References:**
OpenClaw skills reference tools in natural language, not formal `ToolName(args)` syntax. The content transformer should produce prose-style references. For example:
- `Use the Read tool` → `Use the read tool` (lowercase, natural)
- `Call Task with subagent_type="Explore"` → `Spawn a sub-session to explore`
- `Use Glob to find files` → `Use exec with find to locate files`

**Transform Pipeline Pattern (from TypeScript best practices):**
Structure the content transformer as a named pipeline of transforms applied in sequence. Each transform is a pure function `(content: string) => string`. This makes it easy to add/remove/reorder transforms and test each independently.

```
const TRANSFORMS: Array<[string, (s: string) => string]> = [
  ['toolNames', rewriteToolNames],
  ['taskCalls', rewriteTaskCalls],
  ['paths', rewritePaths],
  ['slashCommands', rewriteSlashCommands],
  ['agentRefs', rewriteAgentRefs],
]
```

**Regex Performance:**
Compile the 10 tool name replacements into a single regex alternation (`/\b(Bash|Read|Write|...)\b/g`) with a lookup map, rather than 10 separate `replace()` calls. This is both faster and easier to maintain.

### Frontmatter Handling

**Preserved fields:** `name`, `description`

**Transformed fields:**
- `user-invocable:` → preserved (set to `true` for agents/commands)
- `disable-model-invocation:` → mapped to `disable-model-invocation: true` in OpenClaw frontmatter

**Dropped fields:** `tools:`, `allowed-tools:`, `model:`, `argument-hint:` (no OpenClaw equivalent)

**Added fields (v1 — emoji only):**
```yaml
metadata:
  openclaw:
    emoji: "🔍"           # Inferred from category
```

### Research Insights: Frontmatter Handling

**V1 Simplification (YAGNI):**
No other converter in the codebase does binary or env var inference. Defer `requires.bins`, `requires.env`, and `os` to v2. For v1, only add the emoji field — it's a trivial category lookup with zero false-positive risk. This cuts ~60 LOC and all metadata inference tests.

**V2 Metadata (future):**
```yaml
metadata:
  openclaw:
    emoji: "🔍"
    requires:
      bins: ["ruby"]      # Inferred from content
      env: ["API_KEY"]    # Inferred from content
    os: ["darwin", "linux"] # Only if platform-specific
```

**Description Truncation:**
OpenClaw enforces max 1024 chars for descriptions. Add `sanitizeDescription()` (already exists in Pi converter — reuse it) with a 1024-char truncation.

### Inferred Metadata Rules (V1: Emoji Only)

**Emoji by source category:**

| Source | Emoji |
|--------|-------|
| Agent: review category | 🔍 |
| Agent: research category | 🔬 |
| Agent: design category | 🎨 |
| Agent: workflow category | ⚙️ |
| Agent: docs category | 📖 |
| Command (any) | 🔧 |
| Skill (pass-through) | 🧩 |

### Name Collision Resolution

Agents and commands both become skills, creating potential name collisions. Resolution order:

1. Skills are loaded first into the `usedNames` set (they have supporting subdirectories that would break if renamed)
2. Commands are loaded second
3. Agents are loaded third
4. Collisions get a `-2`, `-3` suffix via `uniqueName()`
5. A warning is logged for each collision

Known collision: `every-style-editor` exists as both an agent and a skill. The skill keeps its name; the agent becomes `every-style-editor-2`.

### Research Insights: Name Collision Resolution

**Name Validation:**
Before adding to `usedNames`, validate that the name matches OpenClaw's pattern: `^[a-z0-9][a-z0-9-]*$` and is at most 64 characters. If `normalizeName()` produces an invalid result, log a warning and skip the component.

**Collision Logging:**
Match the Pi converter's pattern — log collisions at `console.warn` level with both the original and suffixed names so users can identify renamed skills.

### Output Structure

```
~/.openclaw/skills/              # Default output root
├── kieran-rails-reviewer/
│   └── SKILL.md                 # From agent
├── performance-oracle/
│   └── SKILL.md                 # From agent
├── plan/
│   └── SKILL.md                 # From command: workflows:plan
├── review/
│   └── SKILL.md                 # From command: workflows:review
├── brainstorm/
│   └── SKILL.md                 # From command: workflows:brainstorm
├── gemini-imagegen/
│   ├── SKILL.md                 # Pass-through (body rewritten)
│   └── scripts/                 # Copied as-is
├── every-style-editor/
│   ├── SKILL.md                 # From skill (priority)
│   └── references/              # Copied as-is
├── every-style-editor-2/
│   └── SKILL.md                 # From agent (collision suffix)
└── ...
```

### CLI Integration

**`src/commands/convert.ts` changes:**
- Add `openclaw` to the `--to` description string
- Add `--openclaw-home` optional flag (default: `~/.openclaw/skills/`)
- Add `openclaw` case to `resolveTargetOutputRoot()`: `path.join(openclawHome)` (skills go directly into the home path, no nesting)

**`src/commands/install.ts` changes:**
- Add `openclaw` to the `--to` description string

### Research Insights: CLI Integration

**Version Discipline (from learnings):**
When adding OpenClaw as a target, update all version references per the plugin versioning checklist:
- Bump version in `plugins/compound-engineering/.claude-plugin/plugin.json`
- Bump version in `.claude-plugin/marketplace.json`
- Update CHANGELOG.md
- Run `/release-docs` to regenerate documentation

## Technical Approach

### Implementation Phases

#### Phase 1: Types and Converter Core

**Files to create:**

- [ ] `src/types/openclaw.ts` — Define `OpenClawSkill`, `OpenClawSkillDir`, `OpenClawBundle`
- [ ] `src/converters/claude-to-openclaw.ts` — Converter with content transformer

**`src/types/openclaw.ts`:**

```typescript
export type OpenClawSkill = {
  name: string
  content: string  // Full SKILL.md content (frontmatter + body)
}

export type OpenClawSkillDir = {
  name: string
  sourceDir: string
}

export type OpenClawBundle = {
  generatedSkills: OpenClawSkill[]  // From agents + commands
  skillDirs: OpenClawSkillDir[]      // Pass-through skills
}
```

**`src/converters/claude-to-openclaw.ts` key functions:**

```
convertClaudeToOpenClaw(plugin, options) → OpenClawBundle
convertAgentToSkill(agent, usedNames) → OpenClawSkill
convertCommandToSkill(command, usedNames) → OpenClawSkill
transformContentForOpenClaw(content) → string
inferEmoji(category?) → string
flattenCommandName(name) → string
normalizeName(name) → string
uniqueName(name, usedNames) → string
```

**Content transformer (`transformContentForOpenClaw`):**

Structured as a named pipeline of pure transforms:

```typescript
const TRANSFORMS: Array<[string, (s: string) => string]> = [
  ['toolNames', rewriteToolNames],      // Single regex alternation for all 10 tools
  ['taskCalls', rewriteTaskCalls],       // Task subagent_type → sessions_spawn
  ['paths', rewritePaths],              // .claude/ → .openclaw/
  ['slashCommands', rewriteSlashCommands], // /workflows:plan → /plan
  ['agentRefs', rewriteAgentRefs],      // @agent-name → the agent-name skill
]

export function transformContentForOpenClaw(content: string): string {
  return TRANSFORMS.reduce((c, [, fn]) => fn(c), content)
}
```

**Emoji inference (`inferEmoji`):**
- Simple category → emoji lookup (7 entries)
- Returns default `🤖` if no category match
- No content scanning needed — category comes from agent directory name or skill type

### Research Insights: Phase 1

**Copy the Cursor Converter's Transform Pattern:**
The Cursor converter (`src/converters/claude-to-cursor.ts`) is the simplest at 167 lines with exactly the 4 content transforms we need (Task calls, slash commands, path rewriting, @agent refs). Use it as the structural template, then add the tool name mapping.

**Pi Converter's Agent→Skill Pattern:**
Copy Pi's `convertAgentToSkill()` which handles: extracting frontmatter, building new frontmatter with preserved fields, filtering dropped fields, combining body with metadata. The OpenClaw version just changes the output format slightly (SKILL.md instead of .pi format).

**Test Pattern:**
Follow `tests/cursor-converter.test.ts` fixture structure: create a minimal `ClaudePlugin` fixture object with 1-2 agents, 1 invocable command, 1 non-invocable command, and 1 skill. Each test function tests one behavior against this fixture.

#### Phase 2: Writer and Registration

**Files to create:**

- [ ] `src/targets/openclaw.ts` — Writer (flat output, no path resolution needed)

**Files to modify:**

- [ ] `src/targets/index.ts` — Register OpenClaw target
- [ ] `src/commands/convert.ts` — Add `openclaw` to CLI args, add `--openclaw-home` flag, update `resolveTargetOutputRoot()`
- [ ] `src/commands/install.ts` — Add `openclaw` to CLI args

**`src/targets/openclaw.ts` key function:**

```
writeOpenClawBundle(outputRoot, bundle) → Promise<void>
```

Writer behavior:
- Generated skills: `Promise.all` over `ensureDir` + `writeText` to `{root}/{name}/SKILL.md`
- Skill dirs: `Promise.all` over `copyDir` from source, then read+rewrite+write SKILL.md body
- Double-nesting guard: if `outputRoot` ends with `skills/`, don't nest further

### Research Insights: Phase 2

**Parallel File I/O:**
Use `Promise.all` for both generated skill writes and skill directory copies. The Pi converter writes sequentially — this is an improvement. Pre-create all directories in a single pass before writing any files.

**No `resolveOpenClawPaths()` Needed:**
The output is flat (`{root}/{name}/SKILL.md`). The `resolveOpenClawPaths()` function proposed in the original plan is unnecessary — just use `path.join(outputRoot, name, 'SKILL.md')` directly.

#### Phase 3: Tests

**Files to create:**

- [ ] `tests/openclaw-converter.test.ts` — Converter + content transformer tests
- [ ] `tests/openclaw-writer.test.ts` — Writer + path resolution tests

**Converter test cases:**
- Agent → skill conversion (frontmatter, description, emoji)
- Command → skill conversion (namespace flattening, description)
- Non-invocable command skipping
- Skill pass-through tracking
- Name collision handling (agent + skill same name)
- MCP server skipping
- Hooks warning
- Empty plugin handling
- Model field dropped
- `tools:` / `allowed-tools:` fields dropped

**Content transformer test cases:**
- Tool name mapping (all 10 core tools via single regex)
- `Task agent(args)` → `sessions_spawn` rewrite
- Path rewriting (`.claude/` → `.openclaw/`)
- Slash command flattening with safety (skip XML, Unix paths)
- `@agent-name` rewriting with safety (skip DOM refs, decorators)
- Combined transformation (multiple patterns in one body)

**Writer test cases:**
- File structure (generated skills in directories)
- Skill dir copying
- SKILL.md body rewrite in pass-through skills
- Double-nesting prevention
- Empty bundle handling
- Multiple skills in one bundle

**Regression test (new):**
- Scan all output SKILL.md files for residual Claude-specific patterns
- Pattern: `/\bClaude Code\b|\b\.claude\/|\bBash tool\b|\bRead tool\b|\bWrite tool\b|\bEdit tool\b|\bGlob tool\b|\bGrep tool\b/`
- Fail if any match found

### Research Insights: Phase 3

**Snapshot Tests:**
Consider adding 1-2 snapshot tests that capture the full SKILL.md output for a representative agent and command. These catch unexpected regressions in formatting, frontmatter order, and content transformation that unit tests might miss.

**Fixture Reuse:**
Create a shared fixture file (`tests/fixtures/openclaw-plugin.ts`) with a minimal `ClaudePlugin` object. Both converter and writer tests import from it. This matches the pattern in `tests/cursor-converter.test.ts`.

## Acceptance Criteria

### Functional Requirements

- [ ] `compound convert ./plugins/compound-engineering --to openclaw` produces valid OpenClaw skills
- [ ] All 30 agents are converted to skills with `user-invocable: true`
- [ ] Invocable commands (~10) are converted to skills with namespace flattening
- [ ] Non-invocable commands (~13) are skipped
- [ ] Skills pass through with emoji metadata and body rewrites
- [ ] MCP servers are skipped with a console note
- [ ] Hooks are skipped with a console warning
- [ ] No Claude Code tool names remain in output SKILL.md files
- [ ] No `.claude/` paths remain in output SKILL.md files
- [ ] Name collisions produce `-2` suffixes with warnings
- [ ] `--openclaw-home` flag works for custom output path
- [ ] `--also openclaw` works for multi-target conversion
- [ ] Existing `compound list` shows `openclaw` as available
- [ ] Skill names match `^[a-z0-9][a-z0-9-]*$` and are at most 64 chars
- [ ] Descriptions are truncated to 1024 chars when needed

### Quality Gates

- [ ] All converter tests pass
- [ ] All writer tests pass
- [ ] Content transformer tests cover all 10 core tool mappings
- [ ] Name collision edge case tested
- [ ] `@` reference false positives tested (DOM refs, decorators)
- [ ] Slash command false positives tested (XML tags, Unix paths)
- [ ] Regression test: no Claude-specific patterns in output SKILL.md files

## Dependencies & Prerequisites

- Existing converter infrastructure (types, utils, CLI framework) — all in place
- Understanding of OpenClaw SKILL.md format — documented in brainstorm

## Risk Analysis & Mitigation

| Risk | Impact | Mitigation |
|------|--------|------------|
| Content rewrite misses a Claude-specific pattern | Skills reference non-existent tools | Regression test scanning all output for Claude-specific patterns |
| `@` reference false positives corrupt content | DOM refs in design agents broken | Suffix-based matching, tested with known false positive cases |
| Name collision causes data loss | Skill overwrites another | Priority ordering (skills > commands > agents) + uniqueName() |
| OpenClaw format changes | Converter output becomes invalid | Pin to current SKILL.md format; updates follow same three-file pattern |
| Skill count approaches 100 limit | Telegram users can't invoke all skills | Monitor count (~62 currently); document limit in README |
| SKILL.md exceeds 500 lines | Poor context loading in OpenClaw | Log warning for large skills; consider splitting in future |

## Future Considerations

- **V2 Metadata:** Add `requires.bins`, `requires.env`, `os` inference with whole-word binary detection and API key pattern matching
- **Sync command:** Add `src/sync/openclaw.ts` for lighter-weight `~/.claude/` skill syncing (symlinks)
- **Plugin manifest:** Generate `openclaw.plugin.json` for full plugin distribution via ClawHub
- **Sub-agent orchestration:** Enhance workflow skills to use `sessions_spawn` more idiomatically for parallel review/research patterns
- **Hooks → Event system:** If OpenClaw adds events, map Claude hooks to OpenClaw event handlers
- **Shared transform pipeline:** Extract TOOL_MAP and agent suffix list to `src/utils/transforms.ts` if other converters need them

## References & Research

### Internal References

- Brainstorm: `docs/brainstorms/2026-02-27-openclaw-converter-brainstorm.md`
- Reference converter (Cursor): `src/converters/claude-to-cursor.ts` (structural template — 167 lines, 4 transforms)
- Reference converter (Pi): `src/converters/claude-to-pi.ts` (closest analog — agent→skill, content transform, metadata)
- Reference converter (Gemini): `src/converters/claude-to-gemini.ts` (generatedSkills pattern, namespace handling)
- Type definitions: `src/types/claude.ts`
- Target registration: `src/targets/index.ts`
- CLI dispatch: `src/commands/convert.ts`
- Shared utilities: `src/utils/frontmatter.ts`, `src/utils/files.ts`
- Test reference: `tests/cursor-converter.test.ts`, `tests/cursor-writer.test.ts`
- Relevant learning: `docs/solutions/plugin-versioning-requirements.md` (multi-file update discipline)

### External References

- OpenClaw repository: https://github.com/openclaw/openclaw
- OpenClaw skill format: SKILL.md with YAML frontmatter + Markdown body
- OpenClaw tool system: Built-in Gateway tools (exec, read, write, edit, web_fetch, web_search, sessions_spawn, browser)
- OpenClaw config: `~/.openclaw/openclaw.json` (JSON5)
- OpenClaw skill validation: names `^[a-z0-9][a-z0-9-]*$` (max 64), descriptions max 1024 chars, SKILL.md under 500 lines
