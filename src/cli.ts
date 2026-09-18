#!/usr/bin/env node
import { generateDataset } from "./generate.js";
import { discoverSkills } from "./skills.js";
import type { DatasetFormat } from "./types.js";

const VERSION = "0.1.0";
const USAGE = `raindance — AI Skill Trainer

Turn skill packs (SKILL.md files) + your prompts into fine-tuning datasets
for ChatGPT (OpenAI) and Claude (Anthropic).

Usage:
  raindance scan <skillsDir>                     List discovered skills
  raindance generate <skillsDir> [options]       Generate a fine-tuning dataset
  raindance validate <skillsDir>                 Check skills are well-formed

Generate options:
  --prompts <dir>        Directory of user prompt files (.md/.txt), one prompt per file.
                         Frontmatter keys: skills: [name, ...], answer: |
  --out <dir>            Output directory (default: out/datasets)
  --format <name>        openai | anthropic | universal (default: openai)
  --strategies <list>    Comma-separated: teach,apply,quiz,multi (default: all)
  --per-skill <n>        Examples per strategy per skill (default: 2)
  --system-prompt <s>    Base system prompt prepended to every example
  --no-shuffle           Keep original ordering (split still applies)

Examples:
  raindance scan ./claude-code-apple-skills/skills
  raindance generate ./claude-code-apple-skills/skills --format openai --per-skill 3
  raindance generate ./skills --prompts ./my-prompts --format anthropic
`;

interface ParsedArgs {
  command?: string;
  positional: string[];
  flags: Record<string, string | boolean>;
}

function parseArgs(argv: string[]): ParsedArgs {
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};
  let command: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") { flags.help = true; continue; }
    if (arg === "--version") { flags.version = true; continue; }
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
      continue;
    }
    if (command === undefined) command = arg;
    else positional.push(arg);
  }
  return { command, positional, flags };
}

function fail(message: string): never {
  console.error(`error: ${message}`);
  console.error(USAGE);
  process.exit(1);
}

async function cmdScan(skillsDir: string): Promise<void> {
  const skills = await discoverSkills(skillsDir);
  if (skills.length === 0) {
    console.log(`No skills found under ${skillsDir} (looked for SKILL.md files).`);
    return;
  }
  console.log(`Found ${skills.length} skill(s) under ${skillsDir}:\n`);
  for (const s of skills) {
    const refs = Object.keys(s.files).length;
    console.log(`  • ${s.name}${s.description ? ` — ${s.description}` : ""}`);
    console.log(`    ${s.dir}${refs ? ` (${refs} reference file(s))` : ""}`);
  }
}

async function cmdValidate(skillsDir: string): Promise<void> {
  const skills = await discoverSkills(skillsDir);
  if (skills.length === 0) {
    console.log(`No skills found under ${skillsDir}.`);
    return;
  }
  let problems = 0;
  for (const s of skills) {
    const issues: string[] = [];
    if (!s.description) issues.push("missing frontmatter 'description'");
    if (s.body.trim().length < 30) issues.push("SKILL.md body is empty or too short");
    if (!s.frontmatter.name) issues.push("missing frontmatter 'name' (falls back to directory name)");
    if (issues.length) {
      problems++;
      console.log(`  ✗ ${s.name}: ${issues.join("; ")}`);
    }
  }
  if (problems === 0) console.log(`All ${skills.length} skill(s) look good.`);
  else console.log(`\n${problems} of ${skills.length} skill(s) have issues.`);
}

async function cmdGenerate(skillsDir: string, flags: Record<string, string | boolean>): Promise<void> {
  const formatRaw = typeof flags.format === "string" ? flags.format : "openai";
  const validFormats: DatasetFormat[] = ["openai", "anthropic", "universal"];
  if (!validFormats.includes(formatRaw as DatasetFormat)) {
    fail(`unknown format "${formatRaw}" (expected one of ${validFormats.join(", ")})`);
  }
  const strategiesRaw = typeof flags.strategies === "string" ? flags.strategies : undefined;
  const strategies = strategiesRaw
    ? strategiesRaw.split(",").map((s) => s.trim()).filter(Boolean)
    : undefined;
  const perSkillRaw = typeof flags["per-skill"] === "string" ? Number(flags["per-skill"]) : 2;
  if (!Number.isFinite(perSkillRaw) || perSkillRaw < 1) fail("--per-skill must be a number >= 1");

  const result = await generateDataset({
    skillsDir,
    promptsDir: typeof flags.prompts === "string" ? flags.prompts : undefined,
    outDir: typeof flags.out === "string" ? flags.out : undefined,
    format: formatRaw as DatasetFormat,
    strategies,
    perSkill: perSkillRaw,
    systemPrompt: typeof flags["system-prompt"] === "string" ? flags["system-prompt"] : undefined,
    shuffle: !flags["no-shuffle"],
  });
  console.log(`Generated ${result.examples} example(s) in ${result.format} format.`);
  console.log(`Manifest: ${result.file}`);
  for (const [strategy, count] of Object.entries(result.byStrategy)) {
    console.log(`  ${strategy}: ${count}`);
  }
  console.log(`Skills used: ${result.skillsUsed.length}`);
}

async function main(): Promise<void> {
  const { command, positional, flags } = parseArgs(process.argv.slice(2));
  if (flags.version) { console.log(`raindance ${VERSION}`); return; }
  if (flags.help || !command) { console.log(USAGE); return; }

  const target = positional[0];
  switch (command) {
    case "scan":
      if (!target) fail("scan requires a skills directory");
      await cmdScan(target);
      break;
    case "validate":
      if (!target) fail("validate requires a skills directory");
      await cmdValidate(target);
      break;
    case "generate":
      if (!target) fail("generate requires a skills directory");
      await cmdGenerate(target, flags);
      break;
    default:
      fail(`unknown command "${command}"`);
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
