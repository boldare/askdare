/**
 * One step of a part's schema. Released migrations are never edited or renumbered: a change to
 * the schema is a new migration with the next version.
 */
export interface Migration {
  /** 1 for the part's first migration, then 2, 3… with no gaps. */
  readonly version: number;
  /** A few words on what it changes, recorded with the version. */
  readonly name: string;
  /**
   * The SQL, run in one transaction together with recording the version. Several statements
   * separated by `;` are allowed. Name tables without a schema, so `search_path` decides.
   */
  readonly sql: string;
}

/**
 * A part of the schema with its own version, such as the conversation store or the knowledge
 * index. Parts upgrade independently, so adding one never renumbers another.
 */
export interface SchemaPart {
  /** Stable name, stored in the version table. */
  readonly name: string;
  readonly migrations: readonly Migration[];
}

/** Throws when the parts are not migratable: duplicate names, or versions that aren't 1, 2, 3… */
export function validateParts(parts: readonly SchemaPart[]): void {
  const names = new Set<string>();
  for (const part of parts) {
    if (!/^[a-z][a-z0-9_]*$/.test(part.name)) {
      throw new Error(`[askdare-postgres] Invalid schema part name "${part.name}".`);
    }
    if (names.has(part.name)) {
      throw new Error(`[askdare-postgres] Schema part "${part.name}" is listed twice.`);
    }
    names.add(part.name);
    part.migrations.forEach((migration, index) => {
      if (migration.version !== index + 1) {
        throw new Error(
          `[askdare-postgres] Migration ${index + 1} of "${part.name}" has version ${migration.version}; versions must be 1, 2, 3… in order.`,
        );
      }
    });
  }
}

/** The version the code expects for a part: its last migration's. */
export function latestVersion(part: SchemaPart): number {
  return part.migrations.at(-1)?.version ?? 0;
}
