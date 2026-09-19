import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import AdmZip from "adm-zip";
import { diffProjects, projectZipFilter, publish, scanProjects, zipUrlFor } from "./publish-projects.mjs";

const BASE_URL = "https://download.example.com";

function makeProjectDir(
  root,
  name,
  {
    description = "A project",
    version = "1.0.0",
    category = "游戏",
    metaName = name,
    withMetaJson = true,
  } = {},
) {
  const dir = path.join(root, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "AGENTS.md"), `# ${name}\n`);
  fs.mkdirSync(path.join(dir, "world"), { recursive: true });
  fs.writeFileSync(path.join(dir, "world", "scene.json"), "{}");
  if (withMetaJson) {
    fs.writeFileSync(
      path.join(dir, "meta.json"),
      JSON.stringify({ name: metaName, description, version, category }),
    );
  }
  return dir;
}

function makeTmpRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "spherse-assets-projects-test-"));
}

test("scanProjects parses, validates and sorts all projects", async () => {
  const root = makeTmpRoot();
  makeProjectDir(root, "beta-world");
  makeProjectDir(root, "alpha-world", { version: "2.0.0", category: "工具" });
  const projects = await scanProjects(root);
  assert.deepEqual(projects.map((p) => p.name), ["alpha-world", "beta-world"]);
  assert.equal(projects[0].category, "工具");
  assert.equal(projects[1].version, "1.0.0");
});

test("scanProjects rejects missing meta.json", async () => {
  const root = makeTmpRoot();
  makeProjectDir(root, "no-meta", { withMetaJson: false });
  await assert.rejects(() => scanProjects(root), /missing meta\.json/);
});

test("scanProjects rejects name/directory mismatch", async () => {
  const root = makeTmpRoot();
  makeProjectDir(root, "dir-name", { metaName: "other-name" });
  await assert.rejects(() => scanProjects(root), /does not match directory name/);
});

test("scanProjects rejects invalid version", async () => {
  const root = makeTmpRoot();
  makeProjectDir(root, "bad-version", { version: "latest" });
  await assert.rejects(() => scanProjects(root), /valid semver/);
});

test("scanProjects rejects missing category", async () => {
  const root = makeTmpRoot();
  makeProjectDir(root, "no-category", { category: "" });
  await assert.rejects(() => scanProjects(root), /category is required/);
});

test("scanProjects rejects invalid meta.json", async () => {
  const root = makeTmpRoot();
  const dir = path.join(root, "broken");
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, "meta.json"), "{not json");
  await assert.rejects(() => scanProjects(root), /not valid JSON/);
});

test("diffProjects flags new and version-changed entries only", () => {
  const local = [
    { name: "same", version: "1.0.0" },
    { name: "bumped", version: "2.0.0" },
    { name: "fresh", version: "0.1.0" },
  ];
  const remote = { projects: [
    { name: "same", version: "1.0.0" },
    { name: "bumped", version: "1.0.0" },
    { name: "gone", version: "1.0.0" },
  ] };
  assert.deepEqual(diffProjects(local, remote).map((p) => p.name), ["bumped", "fresh"]);
  assert.deepEqual(diffProjects(local, null).map((p) => p.name), ["same", "bumped", "fresh"]);
});

test("zipUrlFor builds the versioned oss url", () => {
  assert.equal(
    zipUrlFor(BASE_URL, "demo", "1.2.0"),
    "https://download.example.com/spherse/projects/demo/1.2.0/demo-1.2.0.zip",
  );
  assert.equal(
    zipUrlFor(`${BASE_URL}/`, "demo", "1.2.0"),
    "https://download.example.com/spherse/projects/demo/1.2.0/demo-1.2.0.zip",
  );
});

test("projectZipFilter excludes only the top-level meta.json entry", () => {
  const filter = projectZipFilter("demo");
  assert.equal(filter("demo/meta.json"), false);
  assert.equal(filter("demo/world/meta.json"), true);
  assert.equal(filter("demo/AGENTS.md"), true);
  assert.equal(filter("other/meta.json"), true);
});

test("publish zips only changed projects and writes a full manifest", async () => {
  const root = makeTmpRoot();
  makeProjectDir(root, "unchanged", { version: "1.0.0" });
  makeProjectDir(root, "changed", { version: "2.0.0" });
  makeProjectDir(root, "added", { version: "0.1.0" });

  const distDir = path.join(root, "dist");
  const manifestUrl = `${BASE_URL}/spherse/projects/manifest.json`;
  const remoteManifest = {
    schemaVersion: 1,
    generatedAt: "2026-01-01T00:00:00Z",
    projects: [
      { name: "unchanged", description: "A project", version: "1.0.0", category: "游戏", zipUrl: zipUrlFor(BASE_URL, "unchanged", "1.0.0"), size: 111, updatedAt: "2026-01-01T00:00:00Z" },
      { name: "changed", description: "A project", version: "1.0.0", category: "游戏", zipUrl: zipUrlFor(BASE_URL, "changed", "1.0.0"), size: 222, updatedAt: "2026-01-02T00:00:00Z" },
    ],
  };

  const result = await publish({
    projectsDir: root,
    distDir,
    baseUrl: BASE_URL,
    manifestUrl,
    fetchFn: async () => new Response(JSON.stringify(remoteManifest), { status: 200 }),
    now: () => new Date("2026-09-19T00:00:00Z"),
  });

  assert.deepEqual(result.published.sort(), ["added", "changed"]);

  const zipRoot = path.join(distDir, "spherse", "projects");
  assert.ok(fs.existsSync(path.join(zipRoot, "changed", "2.0.0", "changed-2.0.0.zip")));
  assert.ok(fs.existsSync(path.join(zipRoot, "added", "0.1.0", "added-0.1.0.zip")));
  assert.ok(!fs.existsSync(path.join(zipRoot, "unchanged")));

  const manifest = JSON.parse(fs.readFileSync(path.join(zipRoot, "manifest.json"), "utf-8"));
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.generatedAt, "2026-09-19T00:00:00.000Z");
  assert.equal(manifest.projects.length, 3);

  const unchanged = manifest.projects.find((p) => p.name === "unchanged");
  assert.equal(unchanged.size, 111);
  assert.equal(unchanged.updatedAt, "2026-01-01T00:00:00Z");
  assert.equal(unchanged.zipUrl, zipUrlFor(BASE_URL, "unchanged", "1.0.0"));

  const changed = manifest.projects.find((p) => p.name === "changed");
  assert.equal(changed.size, fs.statSync(path.join(zipRoot, "changed", "2.0.0", "changed-2.0.0.zip")).size);
  assert.equal(changed.updatedAt, "2026-09-19T00:00:00.000Z");
});

test("publish excludes top-level meta.json but keeps nested ones", async () => {
  const root = makeTmpRoot();
  makeProjectDir(root, "with-nested-meta");
  fs.writeFileSync(path.join(root, "with-nested-meta", "world", "meta.json"), "{}");

  const distDir = path.join(root, "dist");
  await publish({
    projectsDir: root,
    distDir,
    baseUrl: BASE_URL,
    manifestUrl: `${BASE_URL}/spherse/projects/manifest.json`,
    fetchFn: async () => new Response("", { status: 404 }),
  });

  const zipPath = path.join(distDir, "spherse", "projects", "with-nested-meta", "1.0.0", "with-nested-meta-1.0.0.zip");
  const zip = new AdmZip(zipPath);
  const names = zip.getEntries().map((e) => e.entryName);
  assert.ok(!names.includes("with-nested-meta/meta.json"));
  assert.ok(names.includes("with-nested-meta/world/meta.json"));
  assert.ok(names.includes("with-nested-meta/AGENTS.md"));
});

test("publish refuses when both the projects directory and the marketplace are empty", async () => {
  const root = makeTmpRoot();
  await assert.rejects(
    () =>
      publish({
        projectsDir: root,
        distDir: path.join(os.tmpdir(), `spherse-assets-projects-dist-${Date.now()}`),
        baseUrl: BASE_URL,
        manifestUrl: `${BASE_URL}/spherse/projects/manifest.json`,
        fetchFn: async () => new Response("", { status: 404 }),
      }),
    /already empty; nothing to publish/,
  );
});

test("publish removes marketplace entries when the projects directory is emptied", async () => {
  const root = makeTmpRoot();
  const distDir = path.join(root, "dist");
  const result = await publish({
    projectsDir: root,
    distDir,
    baseUrl: BASE_URL,
    manifestUrl: `${BASE_URL}/spherse/projects/manifest.json`,
    fetchFn: async () =>
      new Response(
        JSON.stringify({
          schemaVersion: 1,
          generatedAt: "2026-01-01T00:00:00Z",
          projects: [
            { name: "old", description: "Old", version: "1.0.0", category: "游戏", zipUrl: zipUrlFor(BASE_URL, "old", "1.0.0"), size: 100, updatedAt: "2026-01-01T00:00:00Z" },
          ],
        }),
        { status: 200 },
      ),
  });

  assert.deepEqual(result.published, []);
  const manifest = JSON.parse(
    fs.readFileSync(path.join(distDir, "spherse", "projects", "manifest.json"), "utf-8"),
  );
  assert.deepEqual(manifest.projects, []);
});
