/**
 * Before the run: move the test database's sample clock to now
 * (`api.refresh_sample_clock()`, which Supabase's pg_cron runs every 30
 * minutes). Sample data keeps the times it was loaded with, so a database
 * loaded days ago would otherwise have nothing in "the last 24 hours" or
 * "the last 7 days". Only rows with is_sample move.
 */
import { DATABASE_URL } from "../playwright.config";

export default async function globalSetup(): Promise<void> {
  const { default: pg } = await import("pg");
  const client = new pg.Client({ connectionString: DATABASE_URL });
  try {
    await client.connect();
    await client.query("select api.refresh_sample_clock()");
  } catch (error) {
    // The test-link projects need no database; the website ones will say what's missing.
    console.warn(`e2e: couldn't move the sample clock in DEV_DATABASE_URL's database: ${String(error)}`);
  } finally {
    await client.end().catch(() => {});
  }
}
