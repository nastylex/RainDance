/** A discovered skill (a directory containing a SKILL.md). */
export interface Skill {
  /** Absolute path of the skill directory. */
  dir: string;
  /** Path of the SKILL.md file. */
  skillMdPath: string;
  /** Skill name (from frontmatter `name`, else directory name). */
  name: string;
  /** Skill description (from frontmatter `description`). */
  description: string;
  /** Full parsed frontmatter map (string keys, string or string[] values). */
  frontmatter: Record<string, string | string[]>;
  /** The markdown body of SKILL.md (frontmatter stripped). */
  body: string;
  /** Reference files shipped inside the skill directory (relative path -> content). */
  files: Record<string, string>;
}

/** One training example in internal (universal) representation. */
export interface Example {
  /** Role of each message in the conversation. */
  messages: Message[];
  /** Names of the skills this example was derived from (traceability). */
  sourceSkills: string[];
  /** The synthesis strategy that produced this example. */
  strategy: string;
}

export interface Message {
  role: "system" | "user" | "assistant";
  content: string;
}

export type DatasetFormat = "openai" | "anthropic" | "universal";

export interface GenerateOptions {
  /** Path to a skills root directory (e.g. a checked-out skills repo). */
  skillsDir: string;
  /** Optional directory of user-provided prompt files (.md/.txt). */
  promptsDir?: string;
  /** Output directory for the dataset (default: out/datasets). */
  outDir?: string;
  /** Dataset format. Default: openai. */
  format?: DatasetFormat;
  /** Synthesis strategies to run. Default: all. */
  strategies?: string[];
  /** Limit number of examples per strategy per skill. Default: 2. */
  perSkill?: number;
  /** Base system prompt injected into every example. */
  systemPrompt?: string;
  /** Shuffle examples before writing. */
  shuffle?: boolean;
}

export interface GenerateResult {
  file: string;
  format: DatasetFormat;
  examples: number;
  skillsUsed: string[];
  strategiesRun: string[];
  byStrategy: Record<string, number>;
}
