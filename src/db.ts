import pg from "pg";

// Defaults match compose.yaml.
const databaseUrl =
  process.env.DATABASE_URL ?? "postgres://wiki:wiki@localhost:5432/wiki";

export async function connect() {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  return client;
}
