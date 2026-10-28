import type { BrowserApplication } from "./browserApp";

/** Test-only worker route uses the same atomic durable commit as normal writes. */
export async function seedDatabase(app: BrowserApplication, statements: Array<{ sql: string; values?: unknown[] }>) {
  await app.page.evaluate(async statements => {
    const result = await (window.hcb as any).__testing.seedDatabase({ statements });
    if (!result.ok) throw new Error(result.error.message);
  }, statements);
}
