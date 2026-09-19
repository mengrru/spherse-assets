const INVALID_NAME_RE = /[/\\:]/;
const SEMVER_RE =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z.-]+))?$/;

export function validateName(name) {
  const trimmed = name.trim();
  if (!trimmed) return "name is required";
  if (INVALID_NAME_RE.test(trimmed)) return `name must not contain '/', '\\', or ':': ${name}`;
  if (trimmed.startsWith(".")) return `name must not start with '.': ${name}`;
  return null;
}

export function validateSemver(version) {
  return typeof version === "string" && SEMVER_RE.test(version.trim());
}

export function trimBaseUrl(url) {
  return url.replace(/\/+$/, "");
}

export function diffBy(listKey, localItems, remoteManifest) {
  const remoteByName = new Map((remoteManifest?.[listKey] ?? []).map((entry) => [entry.name, entry]));
  return localItems.filter((item) => {
    const remote = remoteByName.get(item.name);
    return !remote || remote.version !== item.version;
  });
}

export async function fetchRemoteManifest(manifestUrl, fetchFn) {
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

export function checkEmptyPublish({ localCount, remoteCount, resourceLabel, dirPath }) {
  if (localCount > 0) return;
  if (remoteCount === 0) {
    throw new Error(
      `no ${resourceLabel} found under ${dirPath} and the marketplace is already empty; nothing to publish`,
    );
  }
  console.warn(
    `warning: ${resourceLabel} directory is empty; publishing a manifest that removes ${remoteCount} marketplace entr${remoteCount === 1 ? "y" : "ies"}`,
  );
}

export function backfillManifestFields({ isPublished, size, publishedAt, remoteEntry }) {
  return {
    size: isPublished ? size : (remoteEntry?.size ?? 0),
    updatedAt: isPublished ? publishedAt : (remoteEntry?.updatedAt ?? publishedAt),
  };
}
