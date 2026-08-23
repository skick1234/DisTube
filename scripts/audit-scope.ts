export type DependencyMap = Readonly<Record<string, string>>;

export type PackageManifest = {
  readonly name?: string;
  readonly private?: boolean;
  readonly workspaces?: readonly string[];
  readonly dependencies?: DependencyMap;
  readonly optionalDependencies?: DependencyMap;
  readonly peerDependencies?: DependencyMap;
};

export type LockMetadata = {
  readonly dependencies?: DependencyMap;
  readonly optionalDependencies?: DependencyMap;
};

export type Lockfile = {
  readonly packages?: Readonly<Record<string, readonly unknown[]>>;
};

export type LockEntry = {
  readonly actualName?: string;
  readonly dependencies: readonly string[];
};

/** What a lock entry installs alongside itself. */
export function runtimeDependencies(value: LockMetadata): string[] {
  return [...Object.keys(value.dependencies ?? {}), ...Object.keys(value.optionalDependencies ?? {})];
}

/**
 * What a published manifest puts in front of a consumer.
 *
 * A peer ships as surely as a dependency: the consumer installs it and the package runs against it.
 * Every core package declares its Discord library as a peer and nothing else, so reading only
 * `dependencies` left the production set empty and the audit unable to block any advisory at all.
 */
export function publishedDependencies(manifest: PackageManifest): string[] {
  return [...runtimeDependencies(manifest), ...Object.keys(manifest.peerDependencies ?? {})];
}

export function packageNameFromReference(reference: string): string | undefined {
  const normalized = reference.startsWith("npm:") ? reference.slice(4) : reference;
  if (normalized.startsWith("file:") || normalized.startsWith("workspace:") || normalized.startsWith("link:")) {
    return undefined;
  }
  if (normalized.startsWith("@")) {
    const slash = normalized.indexOf("/");
    const version = normalized.lastIndexOf("@");
    return version > slash ? normalized.slice(0, version) : normalized;
  }
  const version = normalized.indexOf("@");
  return version > 0 ? normalized.slice(0, version) : normalized;
}

export function buildLockIndex(lockfile: Lockfile): Map<string, LockEntry[]> {
  const index = new Map<string, LockEntry[]>();
  for (const [reference, value] of Object.entries(lockfile.packages ?? {})) {
    if (!Array.isArray(value)) continue;
    const dependencyName = packageNameFromReference(reference);
    const actualName = typeof value[0] === "string" ? packageNameFromReference(value[0]) : undefined;
    const metadata = (value[2] ?? {}) as LockMetadata;
    const entry = { actualName, dependencies: runtimeDependencies(metadata) } satisfies LockEntry;
    for (const name of new Set([dependencyName, actualName])) {
      if (!name) continue;
      const entries = index.get(name) ?? [];
      entries.push(entry);
      index.set(name, entries);
    }
  }
  return index;
}

/**
 * Every package a consumer of the published manifests ends up installing.
 *
 * Traversal starts at the non-private manifests' published dependencies and follows what the lockfile
 * says each one installs. Workspace names resolve to their own manifest so a package depending on a
 * sibling pulls in that sibling's peers too.
 */
export function reachableProductionPackages(manifests: readonly PackageManifest[], lockfile: Lockfile): Set<string> {
  const workspaceDependencies = new Map<string, readonly string[]>();
  const pending: string[] = [];

  for (const manifest of manifests) {
    if (manifest.name) workspaceDependencies.set(manifest.name, publishedDependencies(manifest));
    if (manifest.private !== true) pending.push(...publishedDependencies(manifest));
  }

  const lockIndex = buildLockIndex(lockfile);
  const reachable = new Set<string>();
  while (pending.length > 0) {
    const name = pending.shift();
    if (!name || reachable.has(name)) continue;
    reachable.add(name);
    pending.push(...(workspaceDependencies.get(name) ?? []));
    for (const entry of lockIndex.get(name) ?? []) {
      if (entry.actualName && !reachable.has(entry.actualName)) pending.push(entry.actualName);
      pending.push(...entry.dependencies);
    }
  }
  return reachable;
}
