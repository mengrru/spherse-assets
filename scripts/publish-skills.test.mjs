import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import AdmZip from "adm-zip";
import { diffSkills, publish, scanSkills, validateSemver, validateSkillName, zipUrlFor } from "./publish-skills.mjs";

const BASE_URL = "https://download.example.com";

function makeSkillDir(root, name, { description = "A skill", version = "1.0.0", frontmatterName = name } = {}) {
  const dir = path.join(root, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "SKILL.md"),
    `---\nname: ${frontmatterName}\ndescription: ${description}\nversion: ${version}\n---\n\nBody.\n`,
  );
  return dir;
}

function makeTmpRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "spherse-assets-test-"));
}

test("validateSkillName rejects invalid names", () => {
  assert.equal(validateSkillName("ok-name"), null);
  assert.ok(validateSkillName("a/b"));
  assert.ok(validateSkillName("a\\b"));
  assert.ok(validateSkillName("a:b"));
  assert.ok(validateSkillName(".hidden"));
  assert.ok(validateSkillName("  "));
});

test("validateSemver accepts and rejects expected inputs", () => {
  assert.ok(validateSemver("1.2.3"));
  assert.ok(validateSemver("1.0.0-alpha.1"));
  assert.ok(validateSemver("0.0.0"));
  assert.ok(!validateSemver("1.2"));
  assert.ok(!validateSemver("v1.2.3"));
  assert.ok(!validateSemver(""));
  assert.ok(!validateSemver(7));
});

test("scanSkills parses and sorts all skills", async () => {
  const root = makeTmpRoot();
  makeSkillDir(root, "beta-skill");
  makeSkillDir(root, "alpha-skill", { version: "2.0.0" });
  const skills = await scanSkills(root);
  assert.deepEqual(skills.map((s) => s.name), ["alpha-skill", "beta-skill"]);
  assert.equal(skills[1].version, "1.0.0");
});

test("scanSkills rejects name/directory mismatch", async () => {
  const root = makeTmpRoot();
  makeSkillDir(root, "dir-name", { frontmatterName: "other-name" });
  await assert.rejects(() => scanSkills(root), /does not match directory name/);
});

test("scanSkills rejects invalid version", async () => {
  const root = makeTmpRoot();
  makeSkillDir(root, "bad-version", { version: "latest" });
  await assert.rejects(() => scanSkills(root), /valid semver/);
});

test("scanSkills rejects missing description", async () => {
  const root = makeTmpRoot();
  const dir = path.join(root, "no-desc");
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, "SKILL.md"), "---\nname: no-desc\nversion: 1.0.0\n---\nBody");
  await assert.rejects(() => scanSkills(root), /description is required/);
});

test("diffSkills flags new and version-changed entries only", () => {
  const local = [
    { name: "same", version: "1.0.0" },
    { name: "bumped", version: "2.0.0" },
    { name: "fresh", version: "0.1.0" },
  ];
  const remote = { skills: [
    { name: "same", version: "1.0.0" },
    { name: "bumped", version: "1.0.0" },
    { name: "gone", version: "1.0.0" },
  ] };
  assert.deepEqual(diffSkills(local, remote).map((s) => s.name), ["bumped", "fresh"]);
  assert.deepEqual(diffSkills(local, null).map((s) => s.name), ["same", "bumped", "fresh"]);
});

test("zipUrlFor builds the versioned oss url", () => {
  assert.equal(
    zipUrlFor(BASE_URL, "demo", "1.2.0"),
    "https://download.example.com/spherse/skills/demo/1.2.0/demo-1.2.0.zip",
  );
  assert.equal(
    zipUrlFor(`${BASE_URL}/`, "demo", "1.2.0"),
    "https://download.example.com/spherse/skills/demo/1.2.0/demo-1.2.0.zip",
  );
});

test("publish zips only changed skills and writes a full manifest", async () => {
  const root = makeTmpRoot();
  makeSkillDir(root, "unchanged", { version: "1.0.0" });
  makeSkillDir(root, "changed", { version: "2.0.0" });
  makeSkillDir(root, "added", { version: "0.1.0" });

  const distDir = path.join(root, "dist");
  const manifestUrl = `${BASE_URL}/spherse/skills/manifest.json`;
  const remoteManifest = {
    schemaVersion: 1,
    generatedAt: "2026-01-01T00:00:00Z",
    skills: [
      { name: "unchanged", description: "A skill", version: "1.0.0", zipUrl: zipUrlFor(BASE_URL, "unchanged", "1.0.0"), size: 111, updatedAt: "2026-01-01T00:00:00Z" },
      { name: "changed", description: "A skill", version: "1.0.0", zipUrl: zipUrlFor(BASE_URL, "changed", "1.0.0"), size: 222, updatedAt: "2026-01-02T00:00:00Z" },
    ],
  };

  const result = await publish({
    skillsDir: root,
    distDir,
    baseUrl: BASE_URL,
    manifestUrl,
    fetchFn: async () => new Response(JSON.stringify(remoteManifest), { status: 200 }),
    now: () => new Date("2026-08-24T00:00:00Z"),
  });

  assert.deepEqual(result.published.sort(), ["added", "changed"]);

  const zipRoot = path.join(distDir, "spherse", "skills");
  assert.ok(fs.existsSync(path.join(zipRoot, "changed", "2.0.0", "changed-2.0.0.zip")));
  assert.ok(fs.existsSync(path.join(zipRoot, "added", "0.1.0", "added-0.1.0.zip")));
  assert.ok(!fs.existsSync(path.join(zipRoot, "unchanged")));

  const manifest = JSON.parse(fs.readFileSync(path.join(zipRoot, "manifest.json"), "utf-8"));
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.generatedAt, "2026-08-24T00:00:00.000Z");
  assert.equal(manifest.skills.length, 3);

  const unchanged = manifest.skills.find((s) => s.name === "unchanged");
  assert.equal(unchanged.size, 111);
  assert.equal(unchanged.updatedAt, "2026-01-01T00:00:00Z");
  assert.equal(unchanged.zipUrl, zipUrlFor(BASE_URL, "unchanged", "1.0.0"));

  const changed = manifest.skills.find((s) => s.name === "changed");
  assert.equal(changed.size, fs.statSync(path.join(zipRoot, "changed", "2.0.0", "changed-2.0.0.zip")).size);
  assert.equal(changed.updatedAt, "2026-08-24T00:00:00.000Z");
});

test("publish bundles companion files under the skill-name top-level directory", async () => {
  const root = makeTmpRoot();
  const dir = makeSkillDir(root, "with-files");
  fs.mkdirSync(path.join(dir, "references"), { recursive: true });
  fs.writeFileSync(path.join(dir, "references", "guide.md"), "# guide");

  const distDir = path.join(root, "dist");
  await publish({
    skillsDir: root,
    distDir,
    baseUrl: BASE_URL,
    manifestUrl: `${BASE_URL}/spherse/skills/manifest.json`,
    fetchFn: async () => new Response("", { status: 404 }),
  });

  const zipPath = path.join(distDir, "spherse", "skills", "with-files", "1.0.0", "with-files-1.0.0.zip");
  const zip = new AdmZip(zipPath);
  const names = zip.getEntries().map((e) => e.entryName);
  assert.ok(names.includes("with-files/SKILL.md"));
  assert.ok(names.includes("with-files/references/guide.md"));
});

test("publish refuses an empty skills directory", async () => {
  const root = makeTmpRoot();
  await assert.rejects(
    () =>
      publish({
        skillsDir: root,
        distDir: path.join(os.tmpdir(), `spherse-assets-dist-${Date.now()}`),
        baseUrl: BASE_URL,
        manifestUrl: `${BASE_URL}/spherse/skills/manifest.json`,
        fetchFn: async () => new Response("", { status: 404 }),
      }),
    /refusing to publish an empty manifest/,
  );
});
