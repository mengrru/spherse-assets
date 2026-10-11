#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateName } from "./lib/marketplace-publish.mjs";

export function promptMetaFallbackChain(language) {
  const isZhFamily = language === "zh" || language.startsWith("zh-");
  const chain = [language];
  if (isZhFamily && language !== "zh-cn") chain.push("zh-cn");
  if (!chain.includes("en-us")) chain.push("en-us");
  if (!chain.includes("zh-cn")) chain.push("zh-cn");
  return chain;
}

function readPromptDir(entry, dir) {
  const contents = new Map();
  const metas = new Map();
  for (const file of fs.readdirSync(dir)) {
    if (file === "README.md") continue;
    const contentMatch = file.match(/^([a-z]{2}(?:-[a-z]{2})?)\.md$/);
    if (contentMatch) {
      contents.set(contentMatch[1], fs.readFileSync(path.join(dir, file), "utf-8"));
      continue;
    }
    const metaMatch = file.match(/^meta\.([a-z]{2}(?:-[a-z]{2})?)\.json$/);
    if (metaMatch) {
      let meta;
      try {
        meta = JSON.parse(fs.readFileSync(path.join(dir, file), "utf-8"));
      } catch (err) {
        throw new Error(`prompt ${entry}: ${file} is not valid JSON: ${err.message}`);
      }
      for (const field of ["title", "description", "category"]) {
        if (typeof meta[field] !== "string" || !meta[field].trim()) {
          throw new Error(`prompt ${entry}: ${file} field "${field}" is required and must be a non-empty string`);
        }
      }
      metas.set(metaMatch[1], {
        title: meta.title.trim(),
        description: meta.description.trim(),
        category: meta.category.trim(),
      });
      continue;
    }
    throw new Error(
      `prompt ${entry}: unrecognized file "${file}" (expected <lang>.md, meta.<lang>.json, or README.md)`,
    );
  }
  return { contents, metas };
}

export function scanPrompts(promptsDir) {
  const entries = fs.readdirSync(promptsDir, { withFileTypes: true }).filter((e) => e.isDirectory());
  const prompts = [];
  for (const entry of entries) {
    const nameError = validateName(entry.name);
    if (nameError) throw new Error(`prompt ${entry.name}: ${nameError}`);
    const { contents, metas } = readPromptDir(entry.name, path.join(promptsDir, entry.name));
    if (contents.size === 0) {
      throw new Error(`prompt ${entry.name}: at least one <lang>.md content file is required`);
    }
    if (metas.size === 0) {
      throw new Error(`prompt ${entry.name}: at least one meta.<lang>.json file is required`);
    }
    prompts.push({ id: entry.name, contents, metas });
  }
  prompts.sort((a, b) => a.id.localeCompare(b.id));
  return prompts;
}

export function resolvePromptMeta(prompt, language) {
  for (const candidate of promptMetaFallbackChain(language)) {
    const meta = prompt.metas.get(candidate);
    if (meta) return meta;
  }
  return null;
}

export function buildLanguageManifests(prompts, now = () => new Date()) {
  const languages = new Set();
  for (const prompt of prompts) {
    for (const language of prompt.contents.keys()) languages.add(language);
  }
  const generatedAt = now().toISOString();
  const manifests = new Map();
  for (const language of [...languages].sort()) {
    const entries = [];
    for (const prompt of prompts) {
      const content = prompt.contents.get(language);
      if (content === undefined) continue;
      const meta = resolvePromptMeta(prompt, language);
      if (!meta) {
        throw new Error(
          `prompt ${prompt.id}: no meta resolvable for language "${language}" ` +
            `(provide meta.${language}.json, meta.en-us.json, or meta.zh-cn.json)`,
        );
      }
      entries.push({ id: prompt.id, ...meta, content });
    }
    manifests.set(language, { schemaVersion: 1, generatedAt, language, prompts: entries });
  }
  return manifests;
}

export function publish(options) {
  const { promptsDir, distDir, now = () => new Date() } = options;
  const prompts = scanPrompts(promptsDir);
  if (prompts.length === 0) {
    throw new Error(`no prompts found under ${promptsDir}; delete OSS objects manually for a full takedown`);
  }
  const manifests = buildLanguageManifests(prompts, now);
  const promptsDistRoot = path.join(distDir, "spherse", "prompts");
  fs.rmSync(distDir, { recursive: true, force: true });
  fs.mkdirSync(promptsDistRoot, { recursive: true });
  for (const [language, manifest] of manifests) {
    fs.writeFileSync(
      path.join(promptsDistRoot, `${language}.json`),
      JSON.stringify(manifest, null, 2) + "\n",
    );
  }
  return { manifests, languages: [...manifests.keys()] };
}

async function main() {
  const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
  try {
    const result = publish({
      promptsDir: path.join(root, "prompts"),
      distDir: path.join(root, "dist"),
    });
    for (const language of result.languages) {
      const manifest = result.manifests.get(language);
      console.log(`built: dist/spherse/prompts/${language}.json (${manifest.prompts.length} prompt(s))`);
    }
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}

const isDirectRun =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  await main();
}
