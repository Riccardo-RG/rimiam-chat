import { localMailEnabled } from "@/server/auth";
import { pool } from "@/server/db";
export async function GET(request: Request) {
  if (
    !localMailEnabled ||
    !["localhost", "127.0.0.1"].includes(new URL(request.url).hostname)
  )
    return new Response(null, { status: 404 });
  const rows = (
    await pool.query(
      "SELECT recipient,subject,link,created_at FROM local_mail ORDER BY created_at DESC",
    )
  ).rows;
  return Response.json(rows, { headers: { "Cache-Control": "no-store" } });
}
