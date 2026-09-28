// Local native verification ONLY. Fixed fictional accounts in a separate database;
// never imported by the runtime or bundled into clients.
import { spawn } from "node:child_process";
import pg from "pg";
const database = new URL(process.env.DATABASE_URL!);
if (!["127.0.0.1", "localhost", "[::1]"].includes(database.hostname))
  throw new Error("Native fixtures require a loopback database host");
const admin = new pg.Pool({ connectionString: database.href });
try {
  if (
    !(
      await admin.query(
        "SELECT 1 FROM pg_database WHERE datname='miriam_native'",
      )
    ).rowCount
  )
    await admin.query("CREATE DATABASE miriam_native");
} finally {
  await admin.end();
}
database.pathname = "/miriam_native";
process.env.DATABASE_URL = database.href;
process.env.BETTER_AUTH_URL = "http://127.0.0.1:3102";
process.env.API_PORT = "3102";
process.env.LOCAL_MAIL = "true";
process.env.AI_MODE = "unconfigured";
const migrate = spawn(
  process.execPath,
  ["--import", "tsx", "scripts/migrate.ts"],
  { env: process.env, stdio: "inherit" },
);
const code = await new Promise<number>((resolve) =>
  migrate.once("exit", (code) => resolve(code ?? 1)),
);
if (code) throw new Error("Native test migrations failed");
const { auth } = await import("../src/server/auth");
const { pool } = await import("../src/server/db");
const { createWorkspace, execute, acceptInvitation } =
  await import("../src/server/commands");
const { randomUUID } = await import("node:crypto");
for (const platform of ["ios", "android"]) {
  const email = `native-${platform}@example.test`;
  let user = (await pool.query('SELECT id FROM "user" WHERE email=$1', [email]))
    .rows[0];
  if (!user) {
    user = (
      await auth.api.signUpEmail({
        body: {
          email,
          password: "Native-test-only-2026!",
          name: `Native ${platform} tester`,
        },
      })
    ).user;
    await pool.query('UPDATE "user" SET "emailVerified"=true WHERE id=$1', [
      user.id,
    ]);
    const w = await createWorkspace(
      user.id,
      `Workspace ${platform} di verifica`,
      randomUUID(),
    );
    await execute(user.id, w.id, randomUUID(), {
      type: "message.send",
      content: "Messaggio persistente dal server di verifica.",
    });
  }
}
const nativeUsers = (
  await pool.query('SELECT id,email FROM "user" WHERE email IN ($1,$2)', [
    "native-ios@example.test",
    "native-android@example.test",
  ])
).rows;
const ios = nativeUsers.find((u) => u.email === "native-ios@example.test")!;
const android = nativeUsers.find(
  (u) => u.email === "native-android@example.test",
)!;
if (
  !(
    await pool.query(
      "SELECT id FROM workspace WHERE name=$1 AND created_by=$2",
      ["Native shared verification", ios.id],
    )
  ).rowCount
) {
  const w = await createWorkspace(
    ios.id,
    "Native shared verification",
    randomUUID(),
  );
  const invitation = (await execute(ios.id, w.id, randomUUID(), {
    type: "invitation.create",
    email: android.email,
    fullHistoryDisclosed: true,
  })) as { token: string };
  await acceptInvitation(android.id, invitation.token, true);
  await execute(ios.id, w.id, randomUUID(), {
    type: "message.send",
    content: "Workspace condiviso dai due client nativi di verifica.",
  });
}
const { FixtureEmail } = await import("./support/fixture-email");
const { establishMailbox } = await import("../src/server/email-state");
const { FixtureCalendar } = await import("./support/fixture-calendar");
const { establishCalendarConnection } =
  await import("../src/server/calendar-state");
for (const user of nativeUsers) {
  const signed = await auth.api.signInEmail({
    body: { email: user.email, password: "Native-test-only-2026!" },
  });
  const session = (
    await pool.query("SELECT id FROM session WHERE token=$1", [signed.token])
  ).rows[0].id;
  const workspaces = (
    await pool.query(
      "SELECT workspace_id FROM membership WHERE user_id=$1 AND active",
      [user.id],
    )
  ).rows;
  for (const row of workspaces) {
    if (
      !(
        await pool.query(
          "SELECT id FROM mailbox_connection WHERE workspace_id=$1 AND person_id=$2 AND active",
          [row.workspace_id, user.id],
        )
      ).rowCount
    )
      await establishMailbox(
        user.id,
        row.workspace_id,
        session,
        new FixtureEmail(),
        user.email,
        "Mailbox di verifica",
      );
    if (
      !(
        await pool.query(
          "SELECT id FROM calendar_connection WHERE workspace_id=$1 AND person_id=$2 AND active",
          [row.workspace_id, user.id],
        )
      ).rowCount
    )
      await establishCalendarConnection(
        user.id,
        row.workspace_id,
        session,
        new FixtureCalendar(),
        user.id,
        "Calendar di verifica",
      );
  }
}
// A shared, deterministic provenance fixture for the pre-design native boundary checks.
if (
  !(
    await pool.query(
      "SELECT 1 FROM workspace WHERE name='Pre-design provenance fixture' AND created_by=$1",
      [ios.id],
    )
  ).rowCount
) {
  const w = (
    await createWorkspace(
      ios.id,
      "Pre-design provenance fixture",
      randomUUID(),
      "Confrontiamo i costi; questa è un’introduzione, non un Goal.",
    )
  ).id;
  const invitation = await execute(ios.id, w, randomUUID(), {
    type: "invitation.create",
    email: android.email,
    fullHistoryDisclosed: true,
  });
  await acceptInvitation(android.id, invitation.token, true);
  const { processInterpretation } =
    await import("../src/server/interpretation");
  let informationId: string | undefined;
  for (const amount of [3000, 3500]) {
    const m = await execute(ios.id, w, randomUUID(), {
      type: "message.send",
      content: `Il locale costa circa ${amount} euro.`,
    });
    await processInterpretation(m.interpretationId, {
      async interpret(c) {
        return {
          needsMore: [],
          proposals: [
            {
              subject: "Stima affitto",
              content: c.trigger.content,
              classification: "descriptive",
              origin: "inferred",
              qualification: "Ipotesi di test non verificata",
              sourceIds: [c.trigger.id],
            },
          ],
        };
      },
    });
    const candidate = (
      await pool.query("SELECT id FROM candidate WHERE interpretation_id=$1", [
        m.interpretationId,
      ])
    ).rows[0].id;
    const result = await execute(
      android.id,
      w,
      randomUUID(),
      informationId
        ? {
            type: "information.correct",
            informationId,
            expectedVersion: 1,
            candidateId: candidate,
            reason: "Nuova stima",
            descriptiveOnly: true,
          }
        : {
            type: "information.accept",
            candidateId: candidate,
            descriptiveOnly: true,
          },
    );
    informationId = result.informationId;
  }
}
await pool.end();
const calendarWorker = spawn(
  process.execPath,
  ["--import", "tsx", "tests/native-worker.ts"],
  { env: process.env, stdio: "inherit" },
);
const server = spawn(process.execPath, ["dist/backend/api.js"], {
  env: process.env,
  stdio: "inherit",
});
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.once(signal, () => {
    server.kill(signal);
    calendarWorker.kill(signal);
  });
process.exitCode = await new Promise<number>((resolve) =>
  server.once("exit", (code) => resolve(code ?? 0)),
);
