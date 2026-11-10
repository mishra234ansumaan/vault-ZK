export const dynamic = "force-dynamic";

export async function GET() {
  // Skip the database check if no database is configured.
  if (!process.env.DATABASE_URL) {
    return Response.json({
      ok: true,
      database: "not_configured",
    });
  }

  try {
    const [{ db }, { sql }] = await Promise.all([
      import("@/db"),
      import("drizzle-orm"),
    ]);

    await db.execute(sql`select 1`);

    return Response.json({
      ok: true,
      database: "connected",
    });
  } catch {
    return Response.json(
      { ok: false, database: "unavailable" },
      { status: 503 },
    );
  }
}