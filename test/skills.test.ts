import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { discoverSkills, parseFrontmatter } from "../src/skills.js";
import { encodeExample } from "../src/formats.js";
import { generateDataset } from "../src/generate.js";
import type { Example } from "../src/types.js";

test("parseFrontmatter extracts scalars, inline lists and body", () => {
  const raw = `---
name: paywall-generator
description: "StoreKit 2 paywalls"
tags: [ios, storekit]
---
# Body

hello world
`;
  const { data, body } = parseFrontmatter(raw);
  assert.equal(data.name, "paywall-generator");
  assert.equal(data.description, "StoreKit 2 paywalls");
  assert.deepEqual(data.tags, ["ios", "storekit"]);
  assert.ok(body.startsWith("# Body"));
});

test("parseFrontmatter handles dash lists and no frontmatter", () => {
  const withDash = `---
tags:
  - a
  - b
---
body`;
  assert.deepEqual(parseFrontmatter(withDash).data.tags, ["a", "b"]);
  const plain = "just text";
  assert.deepEqual(parseFrontmatter(plain).data, {});
  assert.equal(parseFrontmatter(plain).body, "just text");
});

test("discoverSkills finds nested SKILL.md files and reference files", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "rd-test-"));
  try {
    const skillDir = path.join(root, "skills", "ios", "paywall");
    await mkdir(skillDir, { recursive: true });
    await writeFile(
      path.join(skillDir, "SKILL.md"),
      "---\nname: paywall-generator\ndescription: builds paywalls\n---\nUse StoreKit 2."
    );
    await writeFile(path.join(skillDir, "notes.md"), "reference notes");
    const skills = await discoverSkills(root);
    assert.equal(skills.length, 1);
    assert.equal(skills[0].name, "paywall-generator");
    assert.equal(skills[0].files["notes.md"], "reference notes");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("generateDataset emits openai/anthropic/universal jsonl", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "rd-gen-"));
  const out = path.join(root, "out");
  try {
    const skillDir = path.join(root, "skills", "alpha");
    await mkdir(skillDir, { recursive: true });
    await writeFile(
      path.join(skillDir, "SKILL.md"),
      "---\nname: alpha\ndescription: test skill\n---\n## Step one\nDo the thing.\n\n## Step two\nThen the other thing."
    );
    const result = await generateDataset({
      skillsDir: path.join(root, "skills"),
      outDir: out,
      format: "openai",
    });
    assert.ok(result.examples > 0);
    const { readFile } = await import("node:fs/promises");
    const train = await readFile(path.join(out, "openai-train.jsonl"), "utf8");
    const first = JSON.parse(train.split("\n")[0]) as { messages: { role: string }[] };
    assert.ok(first.messages.length >= 3);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("encodeExample shapes for all formats", () => {
  const ex: Example = {
    messages: [
      { role: "system", content: "sys" },
      { role: "user", content: "q" },
      { role: "assistant", content: "a" },
    ],
    sourceSkills: ["alpha"],
    strategy: "teach",
  };
  const o = JSON.parse(encodeExample(ex, "openai"));
  assert.equal(o.messages.length, 3);
  const a = JSON.parse(encodeExample(ex, "anthropic"));
  assert.equal(a.system, "sys");
  assert.equal(a.messages.length, 2);
  const u = JSON.parse(encodeExample(ex, "universal"));
  assert.deepEqual(u.meta.skills, ["alpha"]);
});
