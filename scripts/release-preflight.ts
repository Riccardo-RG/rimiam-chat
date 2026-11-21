/** Read-only operational evidence. Never imports application/worker startup. */
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import pg from "pg";

type Environment = Readonly<Record<string, string | undefined>>;

const domains = [
  [
    "interpretation",
    "status",
    ["queued", "running", "completed", "stale", "failed"],
    true,
  ],
  [
    "research_work",
    "status",
    [
      "queued",
      "running",
      "completed",
      "failed",
      "stale",
      "cancelled",
      "needs_configuration",
    ],
    true,
  ],
  [
    "active_work",
    "phase",
    ["queued", "working", "needs_input", "paused", "stopped", "completed"],
    true,
  ],
  [
    "account_delivery",
    "status",
    [
      "queued",
      "running",
      "delivered",
      "unknown",
      "needs_configuration",
      "expired",
    ],
    true,
  ],
  [
    "invitation_delivery",
    "status",
    [
      "queued",
      "needs_configuration",
      "running",
      "submitted",
      "unknown",
      "cancelled",
      "expired",
    ],
    true,
  ],
  [
    "calendar_action",
    "status",
    [
      "PROPOSED",
      "AUTHORIZED",
      "EXECUTING",
      "SUCCEEDED",
      "FAILED",
      "OUTCOME_UNKNOWN",
      "REJECTED",
    ],
    true,
  ],
  [
    "calendar_read",
    "status",
    ["QUEUED", "READING", "COMPLETED", "FAILED"],
    true,
  ],
  [
    "email_send",
    "status",
    [
      "PROPOSED",
      "AUTHORIZED",
      "EXECUTING",
      "SUCCEEDED",
      "FAILED",
      "OUTCOME_UNKNOWN",
      "REJECTED",
    ],
    true,
  ],
  ["email_read", "status", ["QUEUED", "READING", "COMPLETED", "FAILED"], true],
  [
    "document_processing",
    "status",
    [
      "queued",
      "processing",
      "ready",
      "needs_configuration",
      "needs_input",
      "failed",
    ],
    true,
  ],
  ["audio_call", "state", ["open", "ended"], false],
  [
    "call_recording",
    "state",
    [
      "prepared",
      "starting",
      "active",
      "stopping",
      "complete",
      "failed",
      "unknown",
    ],
    false,
  ],
  [
    "call_transcription",
    "status",
    ["queued", "processing", "ready", "failed", "needs_configuration"],
    true,
  ],
  [
    "web_push_delivery",
    "status",
    ["queued", "sending", "submitted", "suppressed", "failed"],
    true,
  ],
] as const;

// Registered names from src/server/worker-runner.ts; unknown names are counted,
// never printed (queue names, payloads and last_error may contain private data).
const workerTasks = [
  "interpret",
  "research",
  "account_mail",
  "invitation_mail",
  "calendar_execute",
  "calendar_read",
  "email_send",
  "email_read",
  "followup_due",
  "active_work",
  "document_extract",
  "audio_call",
  "call_transcribe",
  "web_push",
];

export function preflightConnection(
  value: string | undefined,
  options: { allowRemoteRead?: boolean; testDatabase?: boolean } = {},
) {
  if (!value) throw new Error("DATABASE_URL_REQUIRED");
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("DATABASE_URL_INVALID");
  }
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    !url.hostname ||
    !url.pathname.slice(1)
  )
    throw new Error("DATABASE_URL_INVALID");
  // pg connection-string query parameters can override the URL hostname.
  // Accept only TLS options, never host/user/options/timeout overrides.
  const tlsOptions = new Set([
    "sslmode",
    "sslrootcert",
    "sslcert",
    "sslkey",
    "ssl",
    "uselibpqcompat",
    "sslnegotiation",
  ]);
  for (const key of url.searchParams.keys())
    if (!tlsOptions.has(key))
      throw new Error("DATABASE_URL_QUERY_OPTION_REJECTED");
  const local = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
  if (!local && (!options.allowRemoteRead || options.testDatabase))
    throw new Error("REMOTE_DATABASE_READ_REQUIRES_EXPLICIT_FLAG");
  if (url.hostname === "localhost") url.hostname = "127.0.0.1";
  if (options.testDatabase) url.pathname = "/miriam_test";
  return {
    connectionString: url.href,
    target: local ? "loopback" : "remote-explicit",
  };
}

export function configurationPresence(env: Environment) {
  const names = [
    "BETTER_AUTH_URL",
    "BETTER_AUTH_SECRET",
    "AI_MODE",
    "AI_MODEL",
    "OPENAI_API_KEY",
    "ANTHROPIC_API_KEY",
    "OLLAMA_BASE_URL",
    "OLLAMA_MODEL",
    "AI_MAX_INVOCATIONS_PER_MINUTE",
    "AI_MAX_INVOCATIONS_PER_DAY",
    "AI_MAX_WORKSPACE_INVOCATIONS_PER_DAY",
    "MAIL_PROVIDER",
    "MAIL_FROM",
    "RESEND_API_KEY",
    "RESEARCH_PROVIDER",
    "BRAVE_SEARCH_API_KEY",
    "TRANSCRIPTION_PROVIDER",
    "TRANSCRIPTION_MODEL",
    "GOOGLE_AUTH_CLIENT_ID",
    "GOOGLE_AUTH_CLIENT_SECRET",
    "GOOGLE_OAUTH_CAPABILITIES",
    "GOOGLE_OAUTH_CLIENT_ID",
    "GOOGLE_OAUTH_CLIENT_SECRET",
    "GOOGLE_OAUTH_REDIRECT_URI",
    "MICROSOFT_MAIL_CLIENT_ID",
    "MICROSOFT_MAIL_CLIENT_SECRET",
    "MICROSOFT_MAIL_REDIRECT_URI",
    "LIVEKIT_URL",
    "LIVEKIT_API_KEY",
    "LIVEKIT_API_SECRET",
    "CALL_STORAGE_BUCKET",
    "CALL_STORAGE_REGION",
    "CALL_STORAGE_ACCESS_KEY",
    "CALL_STORAGE_SECRET_KEY",
    "WEB_PUSH_VAPID_PUBLIC_KEY",
    "WEB_PUSH_VAPID_PRIVATE_KEY",
    "WEB_PUSH_VAPID_SUBJECT",
    "APNS_TEAM_ID",
    "APNS_BUNDLE_ID",
    "APNS_ENVIRONMENT",
    "APNS_KEY_ID",
    "APNS_PRIVATE_KEY",
    "FCM_PROJECT_ID",
    "FCM_CLIENT_EMAIL",
    "FCM_PRIVATE_KEY",
    "DOCUMENT_PYTHON_PATH",
    "FFMPEG_PATH",
  ];
  return {
    variablesPresent: Object.fromEntries(
      names.map((name) => [name, Boolean(env[name]?.trim())]),
    ),
    localMailEnabled: env.LOCAL_MAIL === "true",
    webPushEnabled: env.WEB_PUSH_ENABLED === "true",
    nativePushEnabled: env.NATIVE_PUSH_ENABLED === "true",
    productionMode: env.NODE_ENV === "production",
    note: "Presence only; values, validity, expiry, credits, connectivity and consent are not verified.",
  };
}

export async function migrationChecks(
  applied: { name: string; checksum: string }[],
  directory = "migrations",
) {
  const files = (await readdir(directory))
    .filter((name) => name.endsWith(".sql"))
    .sort();
  const known = new Set(files),
    entries = new Map(applied.map((entry) => [entry.name, entry.checksum]));
  const pending: string[] = [],
    mismatched: string[] = [];
  for (const name of files) {
    const checksum = createHash("sha256")
      .update(await readFile(resolve(directory, name), "utf8"))
      .digest("hex");
    if (!entries.has(name)) pending.push(name);
    else if (entries.get(name) !== checksum) mismatched.push(name);
  }
  return {
    localFiles: files.length,
    recorded: applied.length,
    pending,
    mismatched,
    unrecognizedAppliedCount: applied.filter((entry) => !known.has(entry.name))
      .length,
  };
}

async function hasColumns(
  client: pg.Client,
  schema: string,
  table: string,
  columns: readonly string[],
) {
  const result = await client.query<{ column_name: string }>(
    "SELECT column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name=$2 AND column_name=ANY($3::text[])",
    [schema, table, columns],
  );
  return (
    new Set(result.rows.map((row) => row.column_name)).size === columns.length
  );
}

export async function runReleasePreflight(options: {
  connectionString: string;
  allowRemoteRead?: boolean;
  testDatabase?: boolean;
  environment?: Environment;
  migrationsDirectory?: string;
}) {
  const target = preflightConnection(options.connectionString, options);
  const client = new pg.Client({
    connectionString: target.connectionString,
    application_name: "rimiam-readonly-release-preflight",
    connectionTimeoutMillis: 5000,
    query_timeout: 10000,
  });
  // Never print pg connection/error objects: they may include secret-bearing URLs.
  client.on("error", () => {});
  try {
    await client.connect();
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    await client.query("SET LOCAL statement_timeout='8s'");
    await client.query("SET LOCAL lock_timeout='2s'");
    const readonly =
      (await client.query("SHOW transaction_read_only")).rows[0]
        .transaction_read_only === "on";
    if (!readonly) throw new Error("READ_ONLY_TRANSACTION_NOT_ENFORCED");
    const ledgerPresent = await hasColumns(
      client,
      "public",
      "schema_migration",
      ["name", "checksum"],
    );
    const applied = ledgerPresent
      ? (
          await client.query<{ name: string; checksum: string }>(
            "SELECT name,checksum FROM public.schema_migration",
          )
        ).rows
      : [];
    const migrations = {
      ledgerPresent,
      ...(await migrationChecks(applied, options.migrationsDirectory)),
    };
    const states: Record<string, unknown> = {};
    const missingRelations: string[] = [];
    for (const [table, column, allowed, lease] of domains) {
      if (
        !(await hasColumns(client, "public", table, [
          column,
          ...(lease ? ["lease_until"] : []),
        ]))
      ) {
        missingRelations.push(table);
        states[table] = { available: false };
        continue;
      }
      // All interpolated identifiers come from the static registry above.
      const counts = await client.query<{ state: string; count: number }>(
        `SELECT CASE WHEN ${column}=ANY($1::text[]) THEN ${column} ELSE 'unrecognized' END AS state,count(*)::integer AS count FROM public.${table} GROUP BY 1`,
        [allowed],
      );
      const expiredLeases = lease
        ? ((
            await client.query(
              `SELECT count(*)::integer AS count FROM public.${table} WHERE lease_until IS NOT NULL AND lease_until<now()`,
            )
          ).rows[0].count as number)
        : undefined;
      states[table] = {
        available: true,
        counts: Object.fromEntries(
          counts.rows.map((row) => [row.state, row.count]),
        ),
        ...(lease ? { expiredLeases } : {}),
      };
    }
    let followups: unknown = { available: false };
    if (
      (await hasColumns(client, "public", "workspace_followup", [
        "workspace_id",
        "id",
        "current_version",
      ])) &&
      (await hasColumns(client, "public", "followup_version", [
        "workspace_id",
        "followup_id",
        "version",
        "status",
        "remind_at",
      ])) &&
      (await hasColumns(client, "public", "followup_delivery", [
        "workspace_id",
        "followup_id",
        "version",
      ]))
    ) {
      const hasRecurringCursor = await hasColumns(
        client,
        "public",
        "workspace_followup",
        ["next_remind_at"],
      );
      followups = {
        available: true,
        ...(
          await client.query(
            hasRecurringCursor
              ? `SELECT count(*)::integer AS active_undelivered,
               count(*) FILTER(WHERE next_remind_at<=now())::integer AS due
               FROM public.workspace_followup WHERE next_remind_at IS NOT NULL`
              : `SELECT count(*)::integer AS active_undelivered,
          count(*) FILTER(WHERE v.remind_at<=now())::integer AS due
        FROM public.workspace_followup f JOIN public.followup_version v
          ON (v.workspace_id,v.followup_id,v.version)=(f.workspace_id,f.id,f.current_version)
        WHERE v.status='active' AND NOT EXISTS(SELECT 1 FROM public.followup_delivery d
          WHERE (d.workspace_id,d.followup_id,d.version)=(v.workspace_id,v.followup_id,v.version))`,
          )
        ).rows[0],
      };
    } else missingRelations.push("followup_current_view");
    let queue: unknown = { available: false };
    if (
      await hasColumns(client, "graphile_worker", "jobs", [
        "task_identifier",
        "run_at",
        "attempts",
        "max_attempts",
        "locked_at",
        "last_error",
      ])
    ) {
      queue = {
        available: true,
        tasks: (
          await client.query(
            `SELECT CASE WHEN task_identifier=ANY($1::text[]) THEN task_identifier ELSE 'unrecognized' END AS task,
          count(*)::integer AS total,
          count(*) FILTER(WHERE locked_at IS NULL AND attempts<max_attempts AND run_at<=now())::integer AS due_unlocked,
          count(*) FILTER(WHERE locked_at IS NULL AND attempts<max_attempts AND run_at>now())::integer AS scheduled_unlocked,
          count(*) FILTER(WHERE locked_at IS NOT NULL)::integer AS locked,
          count(*) FILTER(WHERE attempts>=max_attempts)::integer AS exhausted,
          count(*) FILTER(WHERE last_error IS NOT NULL)::integer AS with_previous_error
        FROM graphile_worker.jobs GROUP BY 1 ORDER BY 1`,
            [workerTasks],
          )
        ).rows,
      };
    } else missingRelations.push("graphile_worker.jobs");
    const report = {
      capturedAt: new Date().toISOString(),
      target: target.target,
      readOnlyTransaction: readonly,
      configuration: configurationPresence(options.environment ?? process.env),
      migrations,
      queue,
      domainStates: states,
      followups,
      missingRelations,
      limitations: [
        "Aggregate snapshot only; no payloads, identities, error text or provider calls.",
        "Project SQL checksums only; Better Auth/Graphile upgrades and actual runtime compatibility need separate verification.",
        "Starting the worker may recover domain work absent from the current queue and may cause external effects or charges.",
        "Unknown outcomes require capability-specific reconciliation; do not blindly retry, delete, unlock or mark work completed.",
        "This report never authorizes activation or asserts safe-to-start, backups, provider validity, billing limits or live acceptance.",
      ],
    };
    await client.query("ROLLBACK");
    return report;
  } finally {
    await client.end();
  }
}

const knownErrors = new Set([
  "DATABASE_URL_REQUIRED",
  "DATABASE_URL_INVALID",
  "DATABASE_URL_QUERY_OPTION_REJECTED",
  "REMOTE_DATABASE_READ_REQUIRES_EXPLICIT_FLAG",
  "READ_ONLY_TRANSACTION_NOT_ENFORCED",
  "UNKNOWN_PREFLIGHT_OPTION",
]);
export async function preflightMain(
  args: string[],
  env: Environment = process.env,
) {
  if (args.includes("--help")) {
    console.log(
      "Usage: npm run release:preflight -- [--test-database] [--allow-remote-read]\nRead-only aggregates. Remote database reads require both authorization and the explicit flag; no worker/provider activation occurs.",
    );
    return 0;
  }
  try {
    if (
      args.some(
        (arg) => !["--test-database", "--allow-remote-read"].includes(arg),
      )
    )
      throw new Error("UNKNOWN_PREFLIGHT_OPTION");
    const report = await runReleasePreflight({
      connectionString: env.DATABASE_URL ?? "",
      allowRemoteRead: args.includes("--allow-remote-read"),
      testDatabase: args.includes("--test-database"),
      environment: env,
    });
    console.log(JSON.stringify(report, null, 2));
    return report.migrations.pending.length ||
      report.migrations.mismatched.length ||
      report.migrations.unrecognizedAppliedCount ||
      report.missingRelations.length
      ? 2
      : 0;
  } catch (error) {
    const message =
      error instanceof Error && knownErrors.has(error.message)
        ? error.message
        : "PREFLIGHT_INCOMPLETE";
    console.error(
      JSON.stringify({
        error: message,
        detail:
          "No activation or retry was performed; inspect connection/permissions/schema privately.",
      }),
    );
    return 1;
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  process.exitCode = await preflightMain(process.argv.slice(2));
