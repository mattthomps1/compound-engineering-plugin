import { describe, expect, test, spyOn } from "bun:test"
import { promises as fs } from "fs"
import path from "path"
import os from "os"
import { writeOpenClawBundle } from "../src/targets/openclaw"
import type { OpenClawBundle } from "../src/types/openclaw"

async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

describe("writeOpenClawBundle", () => {
  test("writes generated skills as name/SKILL.md", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-test-"))
    const bundle: OpenClawBundle = {
      generatedSkills: [
        {
          name: "security-reviewer",
          content: "---\nname: security-reviewer\ndescription: Security review\n---\n\nReview code.",
        },
        {
          name: "plan",
          content: "---\nname: plan\ndescription: Planning command\n---\n\nPlan the work.",
        },
      ],
      skillDirs: [],
    }

    await writeOpenClawBundle(tempRoot, bundle)

    const skillsDir = path.join(tempRoot, "skills")
    expect(await exists(path.join(skillsDir, "security-reviewer", "SKILL.md"))).toBe(true)
    expect(await exists(path.join(skillsDir, "plan", "SKILL.md"))).toBe(true)

    const content = await fs.readFile(
      path.join(skillsDir, "security-reviewer", "SKILL.md"),
      "utf8",
    )
    expect(content).toContain("Review code.")
    expect(content).toContain("name: security-reviewer")
  })

  test("copies skill directories and rewrites SKILL.md body", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-skill-"))

    // Create a source skill directory with a SKILL.md
    const sourceDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-source-"))
    const skillMd = `---
name: test-skill
description: A test skill
---

Use Bash to run commands. Read the file at .claude/config.`
    await fs.writeFile(path.join(sourceDir, "SKILL.md"), skillMd)
    await fs.mkdir(path.join(sourceDir, "scripts"), { recursive: true })
    await fs.writeFile(path.join(sourceDir, "scripts", "helper.sh"), "#!/bin/bash\necho hi")

    const bundle: OpenClawBundle = {
      generatedSkills: [],
      skillDirs: [{ name: "test-skill", sourceDir }],
    }

    await writeOpenClawBundle(tempRoot, bundle)

    const skillsDir = path.join(tempRoot, "skills")
    expect(await exists(path.join(skillsDir, "test-skill", "SKILL.md"))).toBe(true)
    expect(await exists(path.join(skillsDir, "test-skill", "scripts", "helper.sh"))).toBe(true)

    const rewritten = await fs.readFile(
      path.join(skillsDir, "test-skill", "SKILL.md"),
      "utf8",
    )
    // Body should be rewritten
    expect(rewritten).toContain("exec")
    expect(rewritten).toContain(".openclaw/config")
    expect(rewritten).not.toContain(".claude/config")
    // Frontmatter should be preserved
    expect(rewritten).toContain("name: test-skill")
  })

  test("writes directly into a 'skills' output root without double-nesting", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-home-"))
    const skillsRoot = path.join(tempRoot, "skills")
    await fs.mkdir(skillsRoot, { recursive: true })

    const bundle: OpenClawBundle = {
      generatedSkills: [
        {
          name: "reviewer",
          content: "---\nname: reviewer\n---\n\nReviewer content.",
        },
      ],
      skillDirs: [],
    }

    await writeOpenClawBundle(skillsRoot, bundle)

    // Should write directly into skillsRoot, not skillsRoot/skills
    expect(await exists(path.join(skillsRoot, "reviewer", "SKILL.md"))).toBe(true)
    expect(await exists(path.join(skillsRoot, "skills"))).toBe(false)
  })

  test("handles empty bundles gracefully", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-empty-"))
    const bundle: OpenClawBundle = {
      generatedSkills: [],
      skillDirs: [],
    }

    await writeOpenClawBundle(tempRoot, bundle)
    expect(await exists(tempRoot)).toBe(true)
  })

  test("rejects skill directories with path traversal names", async () => {
    const warnSpy = spyOn(console, "warn").mockImplementation(() => {})
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-traversal-"))

    const sourceDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-source-"))
    await fs.writeFile(path.join(sourceDir, "SKILL.md"), "---\nname: evil\n---\n\nEvil skill.")

    const bundle: OpenClawBundle = {
      generatedSkills: [],
      skillDirs: [{ name: "../../etc/evil", sourceDir }],
    }

    await writeOpenClawBundle(tempRoot, bundle)

    // Should not have written anything outside root
    const skillsDir = path.join(tempRoot, "skills")
    expect(await exists(path.join(skillsDir, "../../etc/evil", "SKILL.md"))).toBe(false)
    expect(warnSpy).toHaveBeenCalled()

    warnSpy.mockRestore()
  })

  test("writes multiple skills as separate directories", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-multi-"))
    const bundle: OpenClawBundle = {
      generatedSkills: [
        { name: "security-sentinel", content: "---\nname: security-sentinel\n---\n\nSecurity." },
        { name: "performance-oracle", content: "---\nname: performance-oracle\n---\n\nPerformance." },
        { name: "code-simplicity-reviewer", content: "---\nname: code-simplicity-reviewer\n---\n\nSimplicity." },
      ],
      skillDirs: [],
    }

    await writeOpenClawBundle(tempRoot, bundle)

    const skillsDir = path.join(tempRoot, "skills")
    expect(await exists(path.join(skillsDir, "security-sentinel", "SKILL.md"))).toBe(true)
    expect(await exists(path.join(skillsDir, "performance-oracle", "SKILL.md"))).toBe(true)
    expect(await exists(path.join(skillsDir, "code-simplicity-reviewer", "SKILL.md"))).toBe(true)
  })
})
