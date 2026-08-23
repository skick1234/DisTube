export interface CompatibilityCase {
  readonly name: string;
  readonly dependencies: Readonly<Record<string, string>>;
}

/** Lowest and highest published stable versions inside a declared peer range. */
export interface PeerBoundaries {
  readonly floor: string;
  readonly ceiling: string;
}

/**
 * Picks the boundaries of a range from the versions a registry publishes.
 *
 * Prereleases never bound a range: a caret range excludes them, so treating one as the ceiling would
 * demand a pin the adapter does not claim to support.
 */
export function selectPeerBoundaries(published: readonly string[], range: string): PeerBoundaries {
  const matching = published
    .filter(version => !version.includes("-") && Bun.semver.satisfies(version, range))
    .sort(Bun.semver.order);
  const floor = matching.at(0);
  const ceiling = matching.at(-1);
  if (!floor || !ceiling) throw new Error(`No published version satisfies ${range}`);
  return { floor, ceiling };
}

/**
 * Reports every way a compatibility matrix leaves a declared peer range untested.
 *
 * A range is exercised only when the matrix pins both boundaries. Two cases pinning the same version
 * are one data point reported as two, which is how `eris` and `oceanic.js` passed while untested.
 * When a range admits exactly one published version the boundaries coincide and one pin covers it.
 */
export function inspectPeerCoverage(
  adapterName: string,
  peerRanges: Readonly<Record<string, string>>,
  cases: readonly CompatibilityCase[],
  boundariesFor: (packageName: string, range: string) => PeerBoundaries,
): string[] {
  const errors: string[] = [];
  const peers = Object.entries(peerRanges);
  if (peers.length === 0) return [`${adapterName}: declares no peer dependency to exercise`];

  for (const [peerName, range] of peers) {
    const unpinned = cases.filter(testCase => !testCase.dependencies[peerName]).map(testCase => testCase.name);
    if (unpinned.length > 0) {
      errors.push(`${adapterName}: ${peerName} is unpinned in case ${unpinned.join(", ")}`);
      continue;
    }
    const pinned = cases.map(testCase => testCase.dependencies[peerName] as string);
    for (const version of pinned) {
      if (!Bun.semver.satisfies(version, range)) {
        errors.push(`${adapterName}: ${peerName}@${version} is outside the declared range ${range}`);
      }
    }
    const { floor, ceiling } = boundariesFor(peerName, range);
    const covered = new Set(pinned);
    for (const boundary of [floor, ceiling]) {
      if (!covered.has(boundary))
        errors.push(`${adapterName}: ${peerName} range ${range} is unexercised at ${boundary}`);
    }
  }
  return errors;
}
