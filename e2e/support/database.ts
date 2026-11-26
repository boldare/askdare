/**
 * The Postgres that e2e/postgres.spec.ts keeps its chat in: the database of the Postgres package's
 * tests (the CI service, or packages/askdare-postgres/docker-compose.yml), in a schema of its own so
 * it never meets the tables those tests create. Without ASKDARE_POSTGRES_TEST_URL the test skips
 * locally and the site's Postgres route stays off.
 */
export const TEST_DATABASE_URL: string | undefined = process.env['ASKDARE_POSTGRES_TEST_URL'];

export const E2E_SCHEMA = 'askdare_e2e';

/** The connection string the site and the test use: the test database with the schema first. */
export const E2E_DATABASE_URL: string | undefined = TEST_DATABASE_URL
  ? withSchema(TEST_DATABASE_URL)
  : undefined;

function withSchema(base: string): string {
  const url = new URL(base);
  url.searchParams.set('options', `-c search_path=${E2E_SCHEMA}`);
  return url.toString();
}
