import pg from "pg";

// count(*) and sum() return bigint, which pg gives back as a string by default
// (a JS number is only exact up to 2^53). Our counts and ids are far below that.
pg.types.setTypeParser(pg.types.builtins.INT8, Number);

const databaseUrl = "postgres://wiki:wiki@localhost:5432/wiki";

export async function connect() {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  return client;
}
