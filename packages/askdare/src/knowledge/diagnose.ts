import type { DoctorCheck } from '../protocol/doctor';
import type { KnowledgeCheck, KnowledgeIndex } from './port';

/** How long `askdare doctor` waits for the index before reporting it as failed. */
const DIAGNOSE_TIMEOUT_MS = 20_000;

/** Names for the checks every index or `pgvectorIndex` reports (ADR-0025, decision 9). */
const LABELS: Readonly<Record<string, string>> = {
  'knowledge.reachable': 'Knowledge database',
  'knowledge.pgvector': 'pgvector',
  'knowledge.schema': 'Knowledge schema',
  'knowledge.synced': 'Knowledge index',
  'knowledge.embedder': 'Knowledge embedder',
};

const SYNC =
  'Run `npx @boldare/askdare kb sync <folder> --index <id>` with the embedder the bot uses.';

function doctorCheck(check: KnowledgeCheck): DoctorCheck {
  const label = LABELS[check.id] ?? check.id.slice(0, 60);
  const title = `${label}: ${check.detail}`.slice(0, 500);
  if (check.ok) return { status: 'ok', title };
  return check.id === 'knowledge.synced' || check.id === 'knowledge.embedder'
    ? { status: 'fail', title, fix: SYNC }
    : { status: 'fail', title };
}

/**
 * The index's own checks for `askdare doctor`: `knowledge.pgvector`, `knowledge.synced` and
 * `knowledge.embedder`, and whatever else it reports. An index that can't answer is a failure.
 */
export async function knowledgeChecks(index: KnowledgeIndex): Promise<DoctorCheck[]> {
  try {
    const checks = await index.diagnose({ signal: AbortSignal.timeout(DIAGNOSE_TIMEOUT_MS) });
    return checks.map(doctorCheck);
  } catch {
    return [{ status: 'fail', title: 'The knowledge index could not be checked.' }];
  }
}
