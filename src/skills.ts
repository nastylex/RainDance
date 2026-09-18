import { promises as fs } from "node:fs";
import path from "node:path";

import type { Skill } from "./types.js";

const SKILL_FILE = "SKILL.md";
/** Directories we never descend into while scanning. */
const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "out",
  "build",
  ".claude",
  "__pycache__",
]);

/**
 * Parse a minimal YAML frontmatter block: `key: value`, one level of
 * nesting (`parent:\n  child: value` -> "parent.child"), inline lists
 * `[a, b]` and dash lists. Good enough for SKILL.md files, which use a
 * small, regular subset of YAML.
 */
export function parseFrontmatter(raw: string): {
  data: Record<string, string | string[]>;
  body: string;
} {
  const data: Record<string, string | string[]> = {};
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(raw);
  if (!match) return { data, body: raw };
  const body = raw.slice(match[0].length);
  let currentKey: string | null = null;
  for (const line of match[1].split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith("#")) continue;
    const listItem = /^\s+-\s+(.*)$/.exec(line);
    if (listItem && currentKey) {
      const existing = data[currentKey];
      const arr = Array.isArray(existing) ? existing : existing ? [existing] : [];
      const item = cleanScalar(listItem[1]);
      if (typeof item === "string") arr.push(item);
      data[currentKey] = arr;
      continue;
    }
    const kv = /^([A-Za-z0-9_.-]+):\s*(.*)$/.exec(line);
    if (!kv) continue;
    const [, rawKey, rawVal] = kv;
    const key = rawKey.includes(".") ? rawKey : rawKey.trim();
    if (rawVal === "") {
      // Either a nested map or a list follows; remember the key either way.
      currentKey = key;
      data[key] = [];
      continue;
    }
    currentKey = null;
    data[key] = cleanScalar(rawVal);
  }
  return { data, body };
}

function cleanScalar(v: string): string | string[] {
  const t = v.trim();
  // Inline list: [a, b, c]
  if (t.startsWith("[") && t.endsWith("]")) {
    return t
      .slice(1, -1)
      .split(",")
      .map((s) => unquote(s.trim()))
      .filter(Boolean);
  }
  return unquote(t);
}

function unquote(s: string): string {
  if (
    (s.startsWith('"') && s.endsWith('"') && s.length >= 2) ||
    (s.startsWith("'") && s.endsWith("'") && s.length >= 2)
  ) {
    return s.slice(1, -1);
  }
  return s;
}

async function walk(dir: string, visitor: (p: string, s: StatsLike) => Promise<void>) {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return; // unreadable/missing dir — skip
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      await walk(full, visitor);
    } else if (entry.isFile()) {
      await visitor(full, entry);
    }
  }
}

interface StatsLike {
  isFile(): boolean;
}

/** Heuristic size cap so a stray huge file doesn't blow up a dataset. */
const MAX_REF_FILE_BYTES = 256 * 1024;

async function loadSkillFromDir(dir: string): Promise<Skill | null> {
  const skillMdPath = path.join(dir, SKILL_FILE);
  let raw: string;
  try {
    raw = await fs.readFile(skillMdPath, "utf8");
  } catch {
    return null; // not a skill directory
  }
  const { data, body } = parseFrontmatter(raw);
  const files: Record<string, string> = {};
  await walk(dir, async (p) => {
    if (p === skillMdPath) return;
    const rel = path.relative(dir, p).replaceAll("\\", "/");
    try {
      const stat = await fs.stat(p);
      if (stat.size > MAX_REF_FILE_BYTES) return;
      if (stat.size === 0) return;
      files[rel] = await fs.readFile(p, "utf8");
    } catch {
      /* unreadable — skip */
    }
  });
  const name = typeof data.name === "string" ? data.name : path.basename(dir);
  const description = typeof data.description === "string" ? data.description : "";
  return { dir, skillMdPath, name, description, frontmatter: data, body, files };
}

/**
 * Discover skills under `root`: any directory (at any depth) containing a
 * SKILL.md file. Reference files inside each skill dir are loaded as well.
 */
export async function discoverSkills(root: string): Promise<Skill[]> {
  const skills: Skill[] = [];
  const seen = new Set<string>();

  // A root that itself contains SKILL.md is a single-skill pack.
  try {
    await fs.access(path.join(root, SKILL_FILE));
    const single = await loadSkillFromDir(root);
    if (single) return [single];
  } catch {
    /* not a single skill — scan the tree */
  }

  await walk(root, async (p) => {
    if (path.basename(p) !== SKILL_FILE) return;
    const dir = path.dirname(p);
    if (seen.has(dir)) return;
    seen.add(dir);
    const skill = await loadSkillFromDir(dir);
    if (skill) skills.push(skill);
  });
  skills.sort((a, b) => a.name.localeCompare(b.name));
  return skills;
}
