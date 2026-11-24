import { KNOWLEDGE_SCHEMA } from '../knowledge/schema';
import type { SchemaPart } from './migration';

/**
 * Every part of the schema, in the order `migrate` applies them. The conversation store (task
 * a2) and the knowledge index (task a3) each add their part here.
 */
export const SCHEMA_PARTS: readonly SchemaPart[] = [KNOWLEDGE_SCHEMA];
