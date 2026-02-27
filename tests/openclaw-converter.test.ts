import { describe, expect, test, spyOn } from "bun:test"
import {
  convertClaudeToOpenClaw,
  transformContentForOpenClaw,
} from "../src/converters/claude-to-openclaw"
import { parseFrontmatter } from "../src/utils/frontmatter"
import type { ClaudePlugin } from "../src/types/claude"

const fixturePlugin: ClaudePlugin = {
  root: "/tmp/plugin",
  manifest: { name: "fixture", version: "1.0.0" },
  agents: [
    {
      name: "Security Reviewer",
      description: "Security-focused code review agent",
      capabilities: ["Threat modeling", "OWASP"],
      model: "claude-sonnet-4-20250514",
      body: "Focus on vulnerabilities.",
      sourcePath: "/tmp/plugin/agents/security-reviewer.md",
    },
  ],
  commands: [
    {
      name: "workflows:plan",
      description: "Planning command",
      argumentHint: "[FOCUS]",
      model: "inherit",
      allowedTools: ["Read"],
      body: "Plan the work.",
      sourcePath: "/tmp/plugin/commands/workflows/plan.md",
    },
  ],
  skills: [
    {
      name: "existing-skill",
      description: "Existing skill",
      sourceDir: "/tmp/plugin/skills/existing-skill",
      skillPath: "/tmp/plugin/skills/existing-skill/SKILL.md",
    },
  ],
  hooks: undefined,
  mcpServers: undefined,
}

const defaultOptions = {
  agentMode: "subagent" as const,
  inferTemperature: false,
  permissions: "none" as const,
}

describe("convertClaudeToOpenClaw", () => {
  test("converts agents to skills with SKILL.md frontmatter", () => {
    const bundle = convertClaudeToOpenClaw(fixturePlugin, defaultOptions)

    // Commands come first, then agents
    const agentSkill = bundle.generatedSkills.find((s) => s.name === "security-reviewer")
    expect(agentSkill).toBeDefined()

    const parsed = parseFrontmatter(agentSkill!.content)
    expect(parsed.data.name).toBe("security-reviewer")
    expect(parsed.data.description).toBe("Security-focused code review agent")
    expect(parsed.data["user-invocable"]).toBe(true)
    expect(parsed.body).toContain("Capabilities")
    expect(parsed.body).toContain("Threat modeling")
    expect(parsed.body).toContain("Focus on vulnerabilities.")
  })

  test("agent with empty description gets default", () => {
    const plugin: ClaudePlugin = {
      ...fixturePlugin,
      agents: [
        {
          name: "basic-agent",
          body: "Do things.",
          sourcePath: "/tmp/plugin/agents/basic.md",
        },
      ],
      commands: [],
      skills: [],
    }

    const bundle = convertClaudeToOpenClaw(plugin, defaultOptions)
    const parsed = parseFrontmatter(bundle.generatedSkills[0].content)
    expect(parsed.data.description).toBe("Converted from Claude agent basic-agent")
  })

  test("agent with empty body gets default body", () => {
    const plugin: ClaudePlugin = {
      ...fixturePlugin,
      agents: [
        {
          name: "empty-agent",
          description: "Empty agent",
          body: "",
          sourcePath: "/tmp/plugin/agents/empty.md",
        },
      ],
      commands: [],
      skills: [],
    }

    const bundle = convertClaudeToOpenClaw(plugin, defaultOptions)
    const parsed = parseFrontmatter(bundle.generatedSkills[0].content)
    expect(parsed.body).toContain("Instructions converted from the empty-agent agent.")
  })

  test("agent capabilities are prepended to body", () => {
    const bundle = convertClaudeToOpenClaw(fixturePlugin, defaultOptions)
    const agentSkill = bundle.generatedSkills.find((s) => s.name === "security-reviewer")!
    const parsed = parseFrontmatter(agentSkill.content)
    expect(parsed.body).toMatch(/## Capabilities\n- Threat modeling\n- OWASP/)
  })

  test("agent model field is silently dropped", () => {
    const bundle = convertClaudeToOpenClaw(fixturePlugin, defaultOptions)
    const agentSkill = bundle.generatedSkills.find((s) => s.name === "security-reviewer")!
    const parsed = parseFrontmatter(agentSkill.content)
    expect(parsed.data.model).toBeUndefined()
  })

  test("converts invocable commands to skills", () => {
    const bundle = convertClaudeToOpenClaw(fixturePlugin, defaultOptions)

    const commandSkill = bundle.generatedSkills.find((s) => s.name === "plan")
    expect(commandSkill).toBeDefined()

    const parsed = parseFrontmatter(commandSkill!.content)
    expect(parsed.data.name).toBe("plan")
    expect(parsed.data.description).toBe("Planning command")
    expect(parsed.data["user-invocable"]).toBe(true)
    expect(parsed.body).toContain("Plan the work.")
  })

  test("flattens namespaced command names", () => {
    const bundle = convertClaudeToOpenClaw(fixturePlugin, defaultOptions)
    const commandSkill = bundle.generatedSkills.find((s) => s.name === "plan")
    expect(commandSkill).toBeDefined()
  })

  test("command with argument-hint gets Arguments section", () => {
    const bundle = convertClaudeToOpenClaw(fixturePlugin, defaultOptions)
    const commandSkill = bundle.generatedSkills.find((s) => s.name === "plan")!
    const parsed = parseFrontmatter(commandSkill.content)
    expect(parsed.body).toContain("## Arguments")
    expect(parsed.body).toContain("[FOCUS]")
  })

  test("command with disable-model-invocation is excluded", () => {
    const plugin: ClaudePlugin = {
      ...fixturePlugin,
      commands: [
        {
          name: "setup",
          description: "Setup command",
          disableModelInvocation: true,
          body: "Setup body.",
          sourcePath: "/tmp/plugin/commands/setup.md",
        },
      ],
      agents: [],
      skills: [],
    }

    const bundle = convertClaudeToOpenClaw(plugin, defaultOptions)
    expect(bundle.generatedSkills).toHaveLength(0)
  })

  test("command allowedTools is silently dropped", () => {
    const bundle = convertClaudeToOpenClaw(fixturePlugin, defaultOptions)
    const commandSkill = bundle.generatedSkills.find((s) => s.name === "plan")!
    expect(commandSkill.content).not.toContain("allowedTools")
  })

  test("passes through skill directories", () => {
    const bundle = convertClaudeToOpenClaw(fixturePlugin, defaultOptions)

    expect(bundle.skillDirs).toHaveLength(1)
    expect(bundle.skillDirs[0].name).toBe("existing-skill")
    expect(bundle.skillDirs[0].sourceDir).toBe("/tmp/plugin/skills/existing-skill")
  })

  test("skills names are reserved — agents with same name get suffix", () => {
    const plugin: ClaudePlugin = {
      ...fixturePlugin,
      agents: [
        {
          name: "existing-skill",
          description: "Agent with same name as skill",
          body: "Agent body.",
          sourcePath: "/tmp/plugin/agents/existing-skill.md",
        },
      ],
      commands: [],
    }

    const warnSpy = spyOn(console, "warn").mockImplementation(() => {})
    const bundle = convertClaudeToOpenClaw(plugin, defaultOptions)

    const agentSkill = bundle.generatedSkills.find((s) => s.name === "existing-skill-2")
    expect(agentSkill).toBeDefined()

    warnSpy.mockRestore()
  })

  test("command name collision after flattening is deduplicated", () => {
    const warnSpy = spyOn(console, "warn").mockImplementation(() => {})

    const plugin: ClaudePlugin = {
      ...fixturePlugin,
      commands: [
        {
          name: "workflows:plan",
          description: "Workflow plan",
          body: "Plan body.",
          sourcePath: "/tmp/plugin/commands/workflows/plan.md",
        },
        {
          name: "plan",
          description: "Top-level plan",
          body: "Top plan body.",
          sourcePath: "/tmp/plugin/commands/plan.md",
        },
      ],
      agents: [],
      skills: [],
    }

    const bundle = convertClaudeToOpenClaw(plugin, defaultOptions)
    const names = bundle.generatedSkills.map((s) => s.name)
    expect(names).toEqual(["plan", "plan-2"])

    warnSpy.mockRestore()
  })

  test("warns when hooks are present", () => {
    const warnSpy = spyOn(console, "warn").mockImplementation(() => {})

    const plugin: ClaudePlugin = {
      ...fixturePlugin,
      agents: [],
      commands: [],
      skills: [],
      hooks: {
        hooks: {
          PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "echo test" }] }],
        },
      },
    }

    convertClaudeToOpenClaw(plugin, defaultOptions)
    expect(warnSpy).toHaveBeenCalledWith(
      "Warning: OpenClaw does not support hooks. Hooks were skipped during conversion.",
    )

    warnSpy.mockRestore()
  })

  test("warns when MCP servers are present", () => {
    const warnSpy = spyOn(console, "warn").mockImplementation(() => {})

    const plugin: ClaudePlugin = {
      ...fixturePlugin,
      agents: [],
      commands: [],
      skills: [],
      mcpServers: {
        playwright: {
          command: "npx",
          args: ["-y", "@anthropic/mcp-playwright"],
        },
      },
    }

    convertClaudeToOpenClaw(plugin, defaultOptions)
    expect(warnSpy).toHaveBeenCalledWith(
      "Warning: OpenClaw does not support MCP servers natively. MCP servers were skipped during conversion.",
    )

    warnSpy.mockRestore()
  })

  test("no warning when hooks and MCP are absent", () => {
    const warnSpy = spyOn(console, "warn").mockImplementation(() => {})

    convertClaudeToOpenClaw(fixturePlugin, defaultOptions)
    expect(warnSpy).not.toHaveBeenCalled()

    warnSpy.mockRestore()
  })

  test("plugin with zero agents produces only command skills", () => {
    const plugin: ClaudePlugin = {
      ...fixturePlugin,
      agents: [],
    }

    const bundle = convertClaudeToOpenClaw(plugin, defaultOptions)
    expect(bundle.generatedSkills).toHaveLength(1)
    expect(bundle.generatedSkills[0].name).toBe("plan")
  })

  test("empty plugin produces empty bundle", () => {
    const plugin: ClaudePlugin = {
      ...fixturePlugin,
      agents: [],
      commands: [],
      skills: [],
    }

    const bundle = convertClaudeToOpenClaw(plugin, defaultOptions)
    expect(bundle.generatedSkills).toHaveLength(0)
    expect(bundle.skillDirs).toHaveLength(0)
  })

  test("infers review emoji for reviewer agents", () => {
    const bundle = convertClaudeToOpenClaw(fixturePlugin, defaultOptions)
    const agentSkill = bundle.generatedSkills.find((s) => s.name === "security-reviewer")!
    const parsed = parseFrontmatter(agentSkill.content)
    expect(parsed.data.emoji).toBe("🔍")
  })

  test("commands get wrench emoji", () => {
    const bundle = convertClaudeToOpenClaw(fixturePlugin, defaultOptions)
    const commandSkill = bundle.generatedSkills.find((s) => s.name === "plan")!
    const parsed = parseFrontmatter(commandSkill.content)
    expect(parsed.data.emoji).toBe("🔧")
  })

  test("agent without category match gets default robot emoji", () => {
    const plugin: ClaudePlugin = {
      ...fixturePlugin,
      agents: [
        {
          name: "generic-agent",
          description: "A generic agent",
          body: "Do stuff.",
          sourcePath: "/tmp/plugin/agents/generic.md",
        },
      ],
      commands: [],
      skills: [],
    }

    const bundle = convertClaudeToOpenClaw(plugin, defaultOptions)
    const parsed = parseFrontmatter(bundle.generatedSkills[0].content)
    expect(parsed.data.emoji).toBe("🤖")
  })
})

describe("transformContentForOpenClaw", () => {
  test("rewrites .claude/ paths to .openclaw/", () => {
    const input = "Read `.claude/compound-engineering.local.md` for config."
    const result = transformContentForOpenClaw(input)
    expect(result).toContain(".openclaw/compound-engineering.local.md")
    expect(result).not.toContain(".claude/")
  })

  test("rewrites ~/.claude/ paths to ~/.openclaw/", () => {
    const input = "Global config at ~/.claude/settings.json"
    const result = transformContentForOpenClaw(input)
    expect(result).toContain("~/.openclaw/settings.json")
    expect(result).not.toContain("~/.claude/")
  })

  test("transforms Task agent calls to sub-session spawns", () => {
    const input = `Run agents:

- Task repo-research-analyst(feature_description)
- Task learnings-researcher(feature_description)

Task best-practices-researcher(topic)`

    const result = transformContentForOpenClaw(input)
    expect(result).toContain('Spawn a sub-session with skill="repo-research-analyst" to: feature_description')
    expect(result).toContain('Spawn a sub-session with skill="learnings-researcher" to: feature_description')
    expect(result).toContain('Spawn a sub-session with skill="best-practices-researcher" to: topic')
    expect(result).not.toContain("Task repo-research-analyst(")
  })

  test("flattens slash commands", () => {
    const input = `1. Run /deepen-plan to enhance
2. Start /workflows:work to implement
3. File at /tmp/output.md`

    const result = transformContentForOpenClaw(input)
    expect(result).toContain("/deepen-plan")
    expect(result).toContain("/work")
    expect(result).not.toContain("/workflows:work")
    // File paths preserved
    expect(result).toContain("/tmp/output.md")
  })

  test("transforms @agent references to skill references", () => {
    const input = "Have @security-sentinel and @dhh-rails-reviewer check the code."
    const result = transformContentForOpenClaw(input)
    expect(result).toContain("the security-sentinel skill")
    expect(result).toContain("the dhh-rails-reviewer skill")
    expect(result).not.toContain("@security-sentinel")
  })

  test("rewrites PascalCase tool names to OpenClaw equivalents", () => {
    const input = "Use Bash to run commands. Read the file. Write the output. Edit inline. Use Grep to search."
    const result = transformContentForOpenClaw(input)
    expect(result).toContain("Use exec to run commands")
    expect(result).toContain("read the file")
    expect(result).toContain("write the output")
    expect(result).toContain("edit inline")
    expect(result).toContain("Use exec with grep to search")
  })

  test("rewrites MultiEdit to edit", () => {
    const input = "Use MultiEdit to batch changes."
    const result = transformContentForOpenClaw(input)
    expect(result).toContain("Use edit to batch changes")
  })

  test("rewrites Glob to exec with find", () => {
    const input = "Use Glob to find files."
    const result = transformContentForOpenClaw(input)
    expect(result).toContain("Use exec with find to find files")
  })

  test("rewrites WebFetch and WebSearch", () => {
    const input = "Use WebFetch to download and WebSearch to look up."
    const result = transformContentForOpenClaw(input)
    expect(result).toContain("web_fetch")
    expect(result).toContain("web_search")
  })

  test("rewrites AskUserQuestion to prose", () => {
    const input = "Use AskUserQuestion to get user input."
    const result = transformContentForOpenClaw(input)
    expect(result).toContain("prompt the user")
    expect(result).not.toContain("AskUserQuestion")
  })

  test("rewrites TodoWrite and TodoRead to prose", () => {
    const input = "Use TodoWrite to track progress. Check TodoRead for status."
    const result = transformContentForOpenClaw(input)
    expect(result).toContain("update the task list")
    expect(result).toContain("check the task list")
    expect(result).not.toContain("TodoWrite")
    expect(result).not.toContain("TodoRead")
  })

  test("preserves non-command file paths", () => {
    const input = "Check /dev/null and /usr/bin/env"
    const result = transformContentForOpenClaw(input)
    expect(result).toContain("/dev/null")
    expect(result).toContain("/usr/bin/env")
  })

  test("expanded @agent suffix list works", () => {
    const input = "Ask @data-integrity-guardian and @schema-drift-detector and @ankane-readme-writer."
    const result = transformContentForOpenClaw(input)
    expect(result).toContain("the data-integrity-guardian skill")
    expect(result).toContain("the schema-drift-detector skill")
    expect(result).toContain("the ankane-readme-writer skill")
  })
})
