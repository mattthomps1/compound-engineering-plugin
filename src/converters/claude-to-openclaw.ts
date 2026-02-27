import { formatFrontmatter } from "../utils/frontmatter"
import type { ClaudeAgent, ClaudeCommand, ClaudePlugin } from "../types/claude"
import type { OpenClawBundle, OpenClawSkill } from "../types/openclaw"
import type { ClaudeToOpenCodeOptions } from "./claude-to-opencode"

export type ClaudeToOpenClawOptions = ClaudeToOpenCodeOptions

const OPENCLAW_DESCRIPTION_MAX_LENGTH = 1024
const OPENCLAW_NAME_MAX_LENGTH = 64

/**
 * Tool name map: Claude Code PascalCase tool names → OpenClaw equivalents.
 * Compiled into a single regex for performance.
 */
const TOOL_NAME_MAP: Record<string, string> = {
  Bash: "exec",
  Read: "read",
  Write: "write",
  Edit: "edit",
  MultiEdit: "edit",
  Glob: "exec with find",
  Grep: "exec with grep",
  WebFetch: "web_fetch",
  WebSearch: "web_search",
}

const TOOL_NAME_REGEX = new RegExp(`\\b(${Object.keys(TOOL_NAME_MAP).join("|")})\\b`, "g")

/**
 * Emoji lookup by agent category prefix.
 */
const CATEGORY_EMOJI: Record<string, string> = {
  review: "🔍",
  research: "🔬",
  design: "🎨",
  workflow: "⚙️",
  docs: "📖",
}

export function convertClaudeToOpenClaw(
  plugin: ClaudePlugin,
  _options: ClaudeToOpenClawOptions,
): OpenClawBundle {
  // Skills loaded first — they have supporting subdirectories that would break if renamed
  const usedNames = new Set<string>(plugin.skills.map((skill) => normalizeName(skill.name)))

  // Commands second (invocable only)
  const commandSkills = plugin.commands
    .filter((command) => !command.disableModelInvocation)
    .map((command) => convertCommandToSkill(command, usedNames))

  // Agents third
  const agentSkills = plugin.agents.map((agent) => convertAgentToSkill(agent, usedNames))

  const generatedSkills = [...commandSkills, ...agentSkills]

  const skillDirs = plugin.skills.map((skill) => ({
    name: skill.name,
    sourceDir: skill.sourceDir,
  }))

  if (plugin.hooks && Object.keys(plugin.hooks.hooks).length > 0) {
    console.warn("Warning: OpenClaw does not support hooks. Hooks were skipped during conversion.")
  }

  if (plugin.mcpServers && Object.keys(plugin.mcpServers).length > 0) {
    console.warn(
      "Warning: OpenClaw does not support MCP servers natively. MCP servers were skipped during conversion.",
    )
  }

  return { generatedSkills, skillDirs }
}

function convertAgentToSkill(agent: ClaudeAgent, usedNames: Set<string>): OpenClawSkill {
  const name = uniqueName(normalizeName(agent.name), usedNames)

  const description = sanitizeDescription(
    agent.description ?? `Converted from Claude agent ${agent.name}`,
  )

  const emoji = inferEmoji(agent.name)

  const frontmatter: Record<string, unknown> = {
    name,
    description,
    "user-invocable": true,
    emoji,
  }

  const sections: string[] = []
  if (agent.capabilities && agent.capabilities.length > 0) {
    sections.push(
      `## Capabilities\n${agent.capabilities.map((c) => `- ${c}`).join("\n")}`,
    )
  }

  const body = [
    ...sections,
    agent.body.trim().length > 0
      ? transformContentForOpenClaw(agent.body.trim())
      : `Instructions converted from the ${agent.name} agent.`,
  ].join("\n\n")

  return {
    name,
    content: formatFrontmatter(frontmatter, body),
  }
}

function convertCommandToSkill(command: ClaudeCommand, usedNames: Set<string>): OpenClawSkill {
  const name = uniqueName(flattenCommandName(command.name), usedNames)

  const description = sanitizeDescription(
    command.description ?? `Converted from Claude command ${command.name}`,
  )

  const frontmatter: Record<string, unknown> = {
    name,
    description,
    "user-invocable": true,
    emoji: "🔧",
  }

  const sections: string[] = []

  if (command.argumentHint) {
    sections.push(`## Arguments\n${command.argumentHint}`)
  }

  const transformedBody = transformContentForOpenClaw(command.body.trim())
  sections.push(transformedBody)

  const body = sections.filter(Boolean).join("\n\n").trim()

  return {
    name,
    content: formatFrontmatter(frontmatter, body),
  }
}

/**
 * Transform Claude Code content to OpenClaw-compatible content.
 *
 * Named pipeline of transforms applied in sequence:
 * 1. toolNames  — PascalCase tool names → OpenClaw equivalents
 * 2. taskCalls  — Task agent(args) → spawn sub-session
 * 3. paths      — .claude/ → .openclaw/
 * 4. slashCommands — flatten namespace
 * 5. agentRefs  — @agent-name → the agent-name skill
 * 6. inlineTools — AskUserQuestion/TodoWrite → prose
 */
export function transformContentForOpenClaw(body: string): string {
  let result = body
  result = rewriteToolNames(result)
  result = rewriteTaskCalls(result)
  result = rewritePaths(result)
  result = rewriteSlashCommands(result)
  result = rewriteAgentRefs(result)
  result = rewriteInlineTools(result)
  return result
}

function rewriteToolNames(body: string): string {
  return body.replace(TOOL_NAME_REGEX, (match) => TOOL_NAME_MAP[match] ?? match)
}

function rewriteTaskCalls(body: string): string {
  const taskPattern = /^(\s*-?\s*)Task\s+([a-z][a-z0-9-]*)\(([^)]+)\)/gm
  return body.replace(taskPattern, (_match, prefix: string, agentName: string, args: string) => {
    const skillName = normalizeName(agentName)
    return `${prefix}Spawn a sub-session with skill="${skillName}" to: ${args.trim()}`
  })
}

function rewritePaths(body: string): string {
  return body
    .replace(/~\/\.claude\//g, "~/.openclaw/")
    .replace(/\.claude\//g, ".openclaw/")
}

function rewriteSlashCommands(body: string): string {
  const slashCommandPattern = /(?<![:\w])\/([a-z][a-z0-9_:-]*?)(?=[\s,."')\]}`]|$)/gi
  return body.replace(slashCommandPattern, (match, commandName: string) => {
    if (commandName.includes("/")) return match
    if (["dev", "tmp", "etc", "usr", "var", "bin", "home"].includes(commandName)) return match
    const flattened = flattenCommandName(commandName)
    return `/${flattened}`
  })
}

function rewriteAgentRefs(body: string): string {
  const agentRefPattern =
    /@([a-z][a-z0-9-]*-(?:agent|reviewer|researcher|analyst|specialist|oracle|sentinel|guardian|strategist|detector|expert|writer|editor))/gi
  return body.replace(agentRefPattern, (_match, agentName: string) => {
    return `the ${normalizeName(agentName)} skill`
  })
}

function rewriteInlineTools(body: string): string {
  let result = body
  result = result.replace(/\bAskUserQuestion\b/g, "prompt the user")
  result = result.replace(/\bTodoWrite\b/g, "update the task list")
  result = result.replace(/\bTodoRead\b/g, "check the task list")
  return result
}

function inferEmoji(agentName: string): string {
  const lower = agentName.toLowerCase()
  for (const [category, emoji] of Object.entries(CATEGORY_EMOJI)) {
    if (lower.includes(category)) return emoji
  }
  return "🤖"
}

function flattenCommandName(name: string): string {
  const colonIndex = name.lastIndexOf(":")
  const base = colonIndex >= 0 ? name.slice(colonIndex + 1) : name
  return normalizeName(base)
}

function normalizeName(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return "item"
  let normalized = trimmed
    .toLowerCase()
    .replace(/[\\/]+/g, "-")
    .replace(/[:\s]+/g, "-")
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
  if (normalized.length > OPENCLAW_NAME_MAX_LENGTH) {
    normalized = normalized.slice(0, OPENCLAW_NAME_MAX_LENGTH).replace(/-+$/, "")
  }
  return normalized || "item"
}

function sanitizeDescription(value: string, maxLength = OPENCLAW_DESCRIPTION_MAX_LENGTH): string {
  const normalized = value.replace(/\s+/g, " ").trim()
  if (normalized.length <= maxLength) return normalized
  const ellipsis = "..."
  return normalized.slice(0, Math.max(0, maxLength - ellipsis.length)).trimEnd() + ellipsis
}

function uniqueName(base: string, used: Set<string>): string {
  if (!used.has(base)) {
    used.add(base)
    return base
  }
  let index = 2
  while (used.has(`${base}-${index}`)) {
    index += 1
  }
  const name = `${base}-${index}`
  used.add(name)
  console.warn(`Warning: Name collision — "${base}" renamed to "${name}".`)
  return name
}
