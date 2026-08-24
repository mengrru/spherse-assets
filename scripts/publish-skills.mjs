#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import AdmZip from "adm-zip";
import matter from "gray-matter";

const INVALID_SKILL_NAME_RE = /[/\\:]/;
const SEMVER_RE =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z.-]+))?$/;

export function validateSkillName(name) {
  const trimmed = name.trim();
  if (!trimmed) return "skill name is required";
  if (INVALID_SKILL_NAME_RE.test(trimmed)) return `skill name must not contain '/', '\\', or ':': ${name}`;
  if (trimmed.startsWith(".")) return `skill name must not start with '.': ${name}`;
  return null;
}

export function validateSemver(version) {
  return typeof version === "string" && SEMVER_RE.test(version.trim());
}

export async function scanSkills(skillsDir) {
  const entries = fs.readdirSync(skillsDir, { withFileTypes: true }).filter((e) => e.isDirectory());
  const skills = [];
  for (const entry of entries) {
    const dir = path.join(skillsDir, entry.name);
    const skillMdPath = path.join(dir, "SKILL.md");
    if (!fs.existsSync(skillMdPath)) {
      throw new Error(`skill directory is missing SKILL.md: ${entry.name}`);
    }
    const parsed = matter(fs.readFileSync(skillMdPath, "utf-8"));
    const name = parsed.data.name;
    const description = parsed.data.description;
    const version = typeof parsed.data.version === "string" ? parsed.data.version.trim() : "";
    const nameError = validateSkillName(typeof name === "string" ? name : "");
    if (nameError) throw new Error(`skill ${entry.name}: ${nameError}`);
    if (name !== entry.name) {
      throw new Error(`skill frontmatter name "${name}" does not match directory name "${entry.name}"`);
    }
    if (typeof description !== "string" || !description.trim()) {
      throw new Error(`skill ${entry.name}: description is required`);
    }
    if (!validateSemver(version)) {
      throw new Error(`skill ${entry.name}: frontmatter version must be a valid semver string (got: ${JSON.stringify(version)})`);
    }
    skills.push({ name, description: description.trim(), version, dir });
  }
  skills.sort((a, b) => a.name.localeCompare(b.name));
  return skills;
}

export function zipUrlFor(baseUrl, name, version) {
  return `${baseUrl.replace(/\/+$/, "")}/spherse/skills/${name}/${version}/${name}-${version}.zip`;
}

export function diffSkills(localSkills, remoteManifest) {
  const remoteByName = new Map((remoteManifest?.skills ?? []).map((s) => [s.name, s]));
  return localSkills.filter((skill) => {
    const remote = remoteByName.get(skill.name);
    return !remote || remote.version !== skill.version;
  });
}

async function fetchRemoteManifest(manifestUrl, fetchFn) {
  let res;
  try {
    res = await fetchFn(manifestUrl);
  } catch (err) {
    throw new Error(`failed to fetch current manifest at ${manifestUrl}: ${err.message}`);
  }
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`current manifest at ${manifestUrl} responded HTTP ${res.status}`);
  }
  return res.json();
}

export async function publish(options) {
  const {
    skillsDir,
    distDir,
    baseUrl,
    manifestUrl,
    fetchFn = (url, init) => fetch(url, init),
    now = () => new Date(),
  } = options;

  const skills = await scanSkills(skillsDir);
  const remote = await fetchRemoteManifest(manifestUrl, fetchFn);
  if (skills.length === 0) {
    const remoteCount = remote?.skills?.length ?? 0;
    if (remoteCount === 0) {
      throw new Error(`no skills found under ${skillsDir} and the marketplace is already empty; nothing to publish`);
    }
    console.warn(`warning: skills directory is empty; publishing a manifest that removes ${remoteCount} marketplace entr${remoteCount === 1 ? "y" : "ies"}`);
  }

  const remoteByName = new Map((remote?.skills ?? []).map((s) => [s.name, s]));
  const toPublish = diffSkills(skills, remote);

  const skillsDistRoot = path.join(distDir, "spherse", "skills");
  fs.rmSync(distDir, { recursive: true, force: true });
  fs.mkdirSync(skillsDistRoot, { recursive: true });

  const publishedAt = now().toISOString();
  const sizes = new Map();
  for (const skill of toPublish) {
    const zip = new AdmZip();
    zip.addLocalFolder(skill.dir, skill.name);
    const zipDir = path.join(skillsDistRoot, skill.name, skill.version);
    fs.mkdirSync(zipDir, { recursive: true });
    const zipPath = path.join(zipDir, `${skill.name}-${skill.version}.zip`);
    zip.writeZip(zipPath);
    sizes.set(skill.name, fs.statSync(zipPath).size);
  }

  const manifest = {
    schemaVersion: 1,
    generatedAt: publishedAt,
    skills: skills.map((skill) => {
      const isPublished = sizes.has(skill.name);
      const remoteEntry = remoteByName.get(skill.name);
      return {
        name: skill.name,
        description: skill.description,
        version: skill.version,
        zipUrl: zipUrlFor(baseUrl, skill.name, skill.version),
        size: isPublished ? sizes.get(skill.name) : (remoteEntry?.size ?? 0),
        updatedAt: isPublished ? publishedAt : (remoteEntry?.updatedAt ?? publishedAt),
      };
    }),
  };
  fs.writeFileSync(path.join(skillsDistRoot, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");

  return { manifest, published: toPublish.map((s) => s.name) };
}

async function main() {
  const baseUrl = process.env.OSS_PUBLIC_BASE_URL;
  if (!baseUrl) {
    console.error("OSS_PUBLIC_BASE_URL is required (e.g. https://download.example.com)");
    process.exit(1);
  }
  const manifestUrl =
    process.env.SPHERSE_SKILLS_MANIFEST_URL ??
    `${baseUrl.replace(/\/+$/, "")}/spherse/skills/manifest.json`;
  const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
  try {
    const result = await publish({
      skillsDir: path.join(root, "skills"),
      distDir: path.join(root, "dist"),
      baseUrl,
      manifestUrl,
    });
    console.log(`manifest: ${result.manifest.skills.length} skill(s) total`);
    if (result.published.length === 0) {
      console.log("no version changes; nothing to upload except manifest");
    } else {
      for (const name of result.published) console.log(`to upload: ${name}`);
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
