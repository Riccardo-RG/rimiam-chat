// Local test process only; domain state is real PostgreSQL, only the external provider is a double.
import { pool } from "../src/server/db";
import {
  processCalendarAction,
  processCalendarRead,
  recoverCalendar,
} from "../src/server/calendar-worker";
import {
  processEmailSend,
  processEmailRead,
  recoverEmail,
} from "../src/server/email-worker";
import { FixtureEmail } from "./support/fixture-email";
import { FixtureCalendar } from "./support/fixture-calendar";
const database = new URL(process.env.DATABASE_URL!);
if (
  !["/miriam_e2e", "/miriam_native"].includes(database.pathname) ||
  !["localhost", "127.0.0.1", "[::1]"].includes(database.hostname)
)
  throw new Error("Calendar fixtures require isolated loopback test database");
const provider = new FixtureCalendar();
const email = new FixtureEmail();
let stop = false;
for (const signal of ["SIGTERM", "SIGINT"] as const)
  process.once(signal, () => {
    stop = true;
  });
while (!stop) {
  await recoverCalendar();
  await recoverEmail();
  for (const row of (
    await pool.query("SELECT id FROM email_send WHERE status='AUTHORIZED'")
  ).rows)
    await processEmailSend(row.id, email);
  for (const row of (
    await pool.query("SELECT id FROM email_read WHERE status='QUEUED'")
  ).rows)
    await processEmailRead(row.id, email);
  for (const row of (
    await pool.query("SELECT id FROM calendar_action WHERE status='AUTHORIZED'")
  ).rows)
    await processCalendarAction(row.id, provider);
  for (const row of (
    await pool.query("SELECT id FROM calendar_read WHERE status='QUEUED'")
  ).rows)
    await processCalendarRead(row.id, provider);
  await new Promise((r) => setTimeout(r, 250));
}
await pool.end();
