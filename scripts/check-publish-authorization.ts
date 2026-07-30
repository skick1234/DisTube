export interface PublishAuthorizationInput {
  readonly publishAuthorized?: string;
  readonly candidateId?: string;
  readonly authorizedCandidateId?: string;
  readonly sourceRevision?: string;
  readonly candidateSourceRevision?: string;
}

const candidatePattern = /^[a-f0-9]{64}$/u;
const revisionPattern = /^[a-f0-9]{40}$/u;

export function inspectPublishAuthorization(input: PublishAuthorizationInput): string[] {
  const errors: string[] = [];
  if (input.publishAuthorized !== "true") errors.push("publication is not explicitly authorized");
  if (!input.candidateId || !candidatePattern.test(input.candidateId))
    errors.push("release candidate ID is missing or invalid");
  if (!input.authorizedCandidateId || input.authorizedCandidateId !== input.candidateId) {
    errors.push("publication authorization does not name the current release candidate");
  }
  if (!input.sourceRevision || !revisionPattern.test(input.sourceRevision))
    errors.push("release source revision is missing or invalid");
  if (!input.candidateSourceRevision || input.candidateSourceRevision !== input.sourceRevision) {
    errors.push("release source revision differs from the authorized candidate");
  }
  return errors;
}

if (import.meta.main) {
  const errors = inspectPublishAuthorization({
    publishAuthorized: process.env.PUBLISH_AUTHORIZED,
    candidateId: process.env.RELEASE_CANDIDATE_ID,
    authorizedCandidateId: process.env.AUTHORIZED_RELEASE_CANDIDATE_ID,
    sourceRevision: process.env.RELEASE_SOURCE_REVISION,
    candidateSourceRevision: process.env.CANDIDATE_DISTUBE_REVISION,
  });
  if (errors.length > 0) throw new Error(errors.join("\n"));
  process.stdout.write("Exact release candidate publication authorization verified.\n");
}
