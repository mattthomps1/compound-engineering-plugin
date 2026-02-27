import path from "path"
import { copyDir, ensureDir, pathExists, readText, writeText } from "../utils/files"
import { parseFrontmatter, formatFrontmatter } from "../utils/frontmatter"
import { transformContentForOpenClaw } from "../converters/claude-to-openclaw"
import type { OpenClawBundle } from "../types/openclaw"

export async function writeOpenClawBundle(
  outputRoot: string,
  bundle: OpenClawBundle,
): Promise<void> {
  const root = resolveOutputRoot(outputRoot)
  await ensureDir(root)

  // Write generated skills (from agents + commands) in parallel
  await Promise.all(
    bundle.generatedSkills.map(async (skill) => {
      const skillDir = path.join(root, skill.name)
      await ensureDir(skillDir)
      await writeText(path.join(skillDir, "SKILL.md"), skill.content + "\n")
    }),
  )

  // Copy pass-through skill directories and rewrite their SKILL.md bodies
  await Promise.all(
    bundle.skillDirs.map(async (skill) => {
      const targetDir = path.join(root, skill.name)
      await copyDir(skill.sourceDir, targetDir)
      await rewriteSkillBody(targetDir)
    }),
  )
}

/**
 * Double-nesting guard: if outputRoot already ends with "skills",
 * write directly into it. Otherwise nest under "skills/".
 */
function resolveOutputRoot(outputRoot: string): string {
  const base = path.basename(outputRoot)
  if (base === "skills") return outputRoot
  return path.join(outputRoot, "skills")
}

/**
 * Rewrite the SKILL.md body inside a copied skill directory
 * using the OpenClaw content transformer. Preserves frontmatter.
 */
async function rewriteSkillBody(skillDir: string): Promise<void> {
  const skillPath = path.join(skillDir, "SKILL.md")
  if (!(await pathExists(skillPath))) return

  const raw = await readText(skillPath)
  const { data, body } = parseFrontmatter(raw)
  const rewritten = transformContentForOpenClaw(body)
  await writeText(skillPath, formatFrontmatter(data, rewritten) + "\n")
}
