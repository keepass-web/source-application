// Pure logic for index: the verify command text and the must() guard — no DOM state, so unit-tested directly.

// Unwrap a possibly-missing DOM lookup, or fail loudly; kept here so its throw branch is testable.
export function must<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) {
    throw new Error('expected element not found');
  }
  return value;
}

const REPO = 'keepass-web/source-application';
const FILE = 'index.html';

// A file opened from disk (or a local build) is already there; anything else needs downloading first.
export function verifyCommand(protocol: string, origin: string): string {
  if (protocol === 'file:') {
    return `gh attestation verify ${FILE} --repo ${REPO}`;
  }
  return `curl -O ${origin}/${FILE}\ngh attestation verify ${FILE} --repo ${REPO}`;
}
