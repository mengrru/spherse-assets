import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  buildLanguageManifests,
  promptMetaFallbackChain,
  publish,
  resolvePromptMeta,
  scanPrompts,
} from "./publish-prompts.mjs";

function makeTmpRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "spherse-assets-prompts-test-"));
}

function makePromptDir(
  root,
  id,
  { contents = { "zh-cn": "中文正文" }, metas = { "zh-cn": { title: "模板", description: "简介", category: "创作" } } } = {},
) {
  const dir = path.join(root, id);
  fs.mkdirSync(dir, { recursive: true });
  for (const [lang, content] of Object.entries(contents)) {
    fs.writeFileSync(path.join(dir, `${lang}.md`), content);
  }
  for (const [lang, meta] of Object.entries(metas)) {
    fs.writeFileSync(path.join(dir, `meta.${lang}.json`), JSON.stringify(meta));
  }
  return dir;
}

test("promptMetaFallbackChain orders zh-family fallbacks ahead of en-us", () => {
  assert.deepEqual(promptMetaFallbackChain("zh-cn"), ["zh-cn", "en-us"]);
  assert.deepEqual(promptMetaFallbackChain("zh-tw"), ["zh-tw", "zh-cn", "en-us"]);
  assert.deepEqual(promptMetaFallbackChain("zh"), ["zh", "zh-cn", "en-us"]);
  assert.deepEqual(promptMetaFallbackChain("en-us"), ["en-us", "zh-cn"]);
  assert.deepEqual(promptMetaFallbackChain("ja-jp"), ["ja-jp", "en-us", "zh-cn"]);
});

test("scanPrompts parses contents and metas, sorted by id", () => {
  const root = makeTmpRoot();
  makePromptDir(root, "beta");
  makePromptDir(root, "alpha", {
    contents: { "zh-cn": "a", "en-us": "b" },
    metas: {
      "zh-cn": { title: "甲", description: "d", category: "c" },
      "en-us": { title: "A", description: "d", category: "c" },
    },
  });
  const prompts = scanPrompts(root);
  assert.deepEqual(prompts.map((p) => p.id), ["alpha", "beta"]);
  assert.deepEqual([...prompts[0].contents.keys()].sort(), ["en-us", "zh-cn"]);
  assert.equal(prompts[0].metas.get("en-us").title, "A");
});

test("scanPrompts rejects prompt directories without content files", () => {
  const root = makeTmpRoot();
  makePromptDir(root, "meta-only", { contents: {} });
  assert.throws(() => scanPrompts(root), /at least one <lang>\.md/);
});

test("scanPrompts rejects prompt directories without any meta", () => {
  const root = makeTmpRoot();
  makePromptDir(root, "content-only", { metas: {} });
  assert.throws(() => scanPrompts(root), /at least one meta\.<lang>\.json/);
});

test("scanPrompts rejects invalid directory names", () => {
  const root = makeTmpRoot();
  makePromptDir(root, ".hidden");
  assert.throws(() => scanPrompts(root), /must not start with '\.'/);
});

test("scanPrompts rejects unrecognized files", () => {
  const root = makeTmpRoot();
  const dir = makePromptDir(root, "stray");
  fs.writeFileSync(path.join(dir, "notes.txt"), "x");
  assert.throws(() => scanPrompts(root), /unrecognized file "notes\.txt"/);
});

test("scanPrompts ignores README.md companion files", () => {
  const root = makeTmpRoot();
  const dir = makePromptDir(root, "with-readme");
  fs.writeFileSync(path.join(dir, "README.md"), "maintenance notes");
  const prompts = scanPrompts(root);
  assert.equal(prompts.length, 1);
});

test("scanPrompts rejects meta with missing required fields", () => {
  const root = makeTmpRoot();
  makePromptDir(root, "bad-meta", {
    metas: { "zh-cn": { title: "  ", description: "d", category: "c" } },
  });
  assert.throws(() => scanPrompts(root), /field "title" is required/);
});

test("scanPrompts rejects malformed meta json", () => {
  const root = makeTmpRoot();
  const dir = makePromptDir(root, "bad-json");
  fs.writeFileSync(path.join(dir, "meta.zh-cn.json"), "{not json");
  assert.throws(() => scanPrompts(root), /is not valid JSON/);
});

test("buildLanguageManifests includes only prompts owning the language version", () => {
  const root = makeTmpRoot();
  makePromptDir(root, "bilingual", {
    contents: { "zh-cn": "中文", "en-us": "english" },
    metas: {
      "zh-cn": { title: "双语", description: "d", category: "c" },
      "en-us": { title: "Bilingual", description: "d", category: "c" },
    },
  });
  makePromptDir(root, "chinese-only");
  const manifests = buildLanguageManifests(scanPrompts(root));
  assert.deepEqual([...manifests.keys()].sort(), ["en-us", "zh-cn"]);
  assert.equal(manifests.get("en-us").prompts.length, 1);
  assert.equal(manifests.get("zh-cn").prompts.length, 2);
  assert.equal(manifests.get("en-us").prompts[0].content, "english");
  assert.equal(manifests.get("zh-cn").prompts[0].id, "bilingual");
});

test("buildLanguageManifests resolves meta through the fallback chain", () => {
  const root = makeTmpRoot();
  makePromptDir(root, "no-en-meta", {
    contents: { "zh-cn": "中文", "en-us": "english" },
    metas: { "zh-cn": { title: "中文标题", description: "d", category: "c" } },
  });
  const prompts = scanPrompts(root);
  const enMeta = resolvePromptMeta(prompts[0], "en-us");
  assert.equal(enMeta.title, "中文标题");
  const manifests = buildLanguageManifests(prompts);
  assert.equal(manifests.get("en-us").prompts[0].title, "中文标题");
});

test("buildLanguageManifests resolves zh-family meta through zh-cn before en-us", () => {
  const root = makeTmpRoot();
  makePromptDir(root, "zh-tw-prompt", {
    contents: { "zh-tw": "繁體" },
    metas: {
      "zh-cn": { title: "简体标题", description: "d", category: "c" },
      "en-us": { title: "English title", description: "d", category: "c" },
    },
  });
  const prompts = scanPrompts(root);
  assert.equal(resolvePromptMeta(prompts[0], "zh-tw").title, "简体标题");
});

test("buildLanguageManifests errors when the meta chain is exhausted", () => {
  const root = makeTmpRoot();
  makePromptDir(root, "orphan-meta", {
    contents: { "zh-cn": "中文" },
    metas: { "ja-jp": { title: "日文", description: "d", category: "c" } },
  });
  assert.throws(() => buildLanguageManifests(scanPrompts(root)), /no meta resolvable for language "zh-cn"/);
});

test("publish writes one json per language and errors on empty prompts dir", () => {
  const root = makeTmpRoot();
  makePromptDir(root, "beta");
  makePromptDir(root, "alpha", {
    contents: { "zh-cn": "a中文", "en-us": "a english" },
    metas: {
      "zh-cn": { title: "甲", description: "d", category: "c" },
      "en-us": { title: "A", description: "d", category: "c" },
    },
  });
  const distDir = path.join(root, "dist");
  const result = publish({ promptsDir: root, distDir });
  assert.deepEqual(result.languages, ["en-us", "zh-cn"]);
  const zhCn = JSON.parse(fs.readFileSync(path.join(distDir, "spherse", "prompts", "zh-cn.json"), "utf-8"));
  assert.equal(zhCn.schemaVersion, 1);
  assert.equal(zhCn.language, "zh-cn");
  assert.equal(zhCn.prompts.length, 2);
  assert.equal(zhCn.prompts[0].id, "alpha");
  const enUs = JSON.parse(fs.readFileSync(path.join(distDir, "spherse", "prompts", "en-us.json"), "utf-8"));
  assert.equal(enUs.prompts.length, 1);
  assert.equal(enUs.prompts[0].id, "alpha");

  const emptyRoot = makeTmpRoot();
  fs.mkdirSync(path.join(emptyRoot, "prompts"), { recursive: true });
  assert.throws(
    () => publish({ promptsDir: path.join(emptyRoot, "prompts"), distDir: path.join(emptyRoot, "dist") }),
    /no prompts found/,
  );
});
