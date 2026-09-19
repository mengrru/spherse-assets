#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import AdmZip from "adm-zip";
import {
  backfillManifestFields,
  checkEmptyPublish,
  diffBy,
  fetchRemoteManifest,
  trimBaseUrl,
  validateName,
  validateSemver,
} from "./lib/marketplace-publish.mjs";

export async function scanProjects(projectsDir) {
  const entries = fs.readdirSync(projectsDir, { withFileTypes: true }).filter((e) => e.isDirectory());
  const projects = [];
  for (const entry of entries) {
    const dir = path.join(projectsDir, entry.name);
    const metaPath = path.join(dir, "meta.json");
    if (!fs.existsSync(metaPath)) {
      throw new Error(`project directory is missing meta.json: ${entry.name}`);
    }
    let meta;
    try {
      meta = JSON.parse(fs.readFileSync(metaPath, "utf-8"));
    } catch (err) {
      throw new Error(`project ${entry.name}: meta.json is not valid JSON: ${err.message}`);
    }
    const name = typeof meta.name === "string" ? meta.name : "";
    const nameError = validateName(name);
    if (nameError) throw new Error(`project ${entry.name}: ${nameError}`);
    if (name !== entry.name) {
      throw new Error(`project meta.json name "${name}" does not match directory name "${entry.name}"`);
    }
    if (typeof meta.description !== "string" || !meta.description.trim()) {
      throw new Error(`project ${entry.name}: description is required`);
    }
    const version = typeof meta.version === "string" ? meta.version.trim() : "";
    if (!validateSemver(version)) {
      throw new Error(
        `project ${entry.name}: meta.json version must be a valid semver string (got: ${JSON.stringify(version)})`,
      );
    }
    if (typeof meta.category !== "string" || !meta.category.trim()) {
      throw new Error(`project ${entry.name}: category is required`);
    }
    projects.push({
      name,
      description: meta.description.trim(),
      version,
      category: meta.category.trim(),
      dir,
    });
  }
  projects.sort((a, b) => a.name.localeCompare(b.name));
  return projects;
}

export function zipUrlFor(baseUrl, name, version) {
  return `${trimBaseUrl(baseUrl)}/spherse/projects/${name}/${version}/${name}-${version}.zip`;
}

export function projectZipFilter(projectName) {
  const topLevelMeta = `${projectName}/meta.json`;
  return (entryName) => entryName !== topLevelMeta;
}

export function diffProjects(localProjects, remoteManifest) {
  return diffBy("projects", localProjects, remoteManifest);
}

export async function publish(options) {
  const {
    projectsDir,
    distDir,
    baseUrl,
    manifestUrl,
    fetchFn = (url, init) => fetch(url, init),
    now = () => new Date(),
  } = options;

  const projects = await scanProjects(projectsDir);
  const remote = await fetchRemoteManifest(manifestUrl, fetchFn);
  checkEmptyPublish({
    localCount: projects.length,
    remoteCount: remote?.projects?.length ?? 0,
    resourceLabel: "projects",
    dirPath: projectsDir,
  });

  const remoteByName = new Map((remote?.projects ?? []).map((p) => [p.name, p]));
  const toPublish = diffProjects(projects, remote);

  const projectsDistRoot = path.join(distDir, "spherse", "projects");
  fs.rmSync(distDir, { recursive: true, force: true });
  fs.mkdirSync(projectsDistRoot, { recursive: true });

  const publishedAt = now().toISOString();
  const sizes = new Map();
  for (const project of toPublish) {
    const zip = new AdmZip();
    zip.addLocalFolder(project.dir, project.name, projectZipFilter(project.name));
    const zipDir = path.join(projectsDistRoot, project.name, project.version);
    fs.mkdirSync(zipDir, { recursive: true });
    const zipPath = path.join(zipDir, `${project.name}-${project.version}.zip`);
    zip.writeZip(zipPath);
    sizes.set(project.name, fs.statSync(zipPath).size);
  }

  const manifest = {
    schemaVersion: 1,
    generatedAt: publishedAt,
    projects: projects.map((project) => ({
      name: project.name,
      description: project.description,
      version: project.version,
      category: project.category,
      zipUrl: zipUrlFor(baseUrl, project.name, project.version),
      ...backfillManifestFields({
        isPublished: sizes.has(project.name),
        size: sizes.get(project.name) ?? 0,
        publishedAt,
        remoteEntry: remoteByName.get(project.name),
      }),
    })),
  };
  fs.writeFileSync(path.join(projectsDistRoot, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");

  return { manifest, published: toPublish.map((p) => p.name) };
}

async function main() {
  const baseUrl = process.env.OSS_PUBLIC_BASE_URL;
  if (!baseUrl) {
    console.error("OSS_PUBLIC_BASE_URL is required (e.g. https://download.example.com)");
    process.exit(1);
  }
  const manifestUrl =
    process.env.SPHERSE_PROJECTS_MANIFEST_URL ??
    `${trimBaseUrl(baseUrl)}/spherse/projects/manifest.json`;
  const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
  try {
    const result = await publish({
      projectsDir: path.join(root, "projects"),
      distDir: path.join(root, "dist"),
      baseUrl,
      manifestUrl,
    });
    console.log(`manifest: ${result.manifest.projects.length} project(s) total`);
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
