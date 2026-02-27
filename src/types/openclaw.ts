export type OpenClawSkill = {
  name: string
  content: string
}

export type OpenClawSkillDir = {
  name: string
  sourceDir: string
}

export type OpenClawBundle = {
  generatedSkills: OpenClawSkill[]
  skillDirs: OpenClawSkillDir[]
}
