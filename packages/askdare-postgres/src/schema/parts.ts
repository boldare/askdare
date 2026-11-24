import { CONVERSATIONS_PART } from '../conversations/schema';
import { KNOWLEDGE_SCHEMA } from '../knowledge/schema';
import type { SchemaPart } from './migration';

/**
 * Every part of the schema, in the order `migrate` applies them. The conversation store (task
 * a2) and the knowledge index (task a3) each add their part here.
 */
export const SCHEMA_PARTS: readonly SchemaPart[] = [
  // The conversation store (ADR-0024).
  CONVERSATIONS_PART,
  // The knowledge index (ADR-0025). Needs pgvector; `migrate({ parts })` can leave it out.
  KNOWLEDGE_SCHEMA,
];
