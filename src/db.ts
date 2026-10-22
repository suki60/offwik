import pg from "pg";

// count(*) and sum() return bigint, which pg gives back as a string by default
// (a JS number is only exact up to 2^53). Our counts and ids are far below that.
pg.types.setTypeParser(pg.types.builtins.INT8, Number);

// Two databases in compose.yaml: db (10k articles) on 5432, db2 (60k) on 5433.
// Pick db2 with DB=db2, e.g. `DB=db2 npm run search -- "question"`.
const port = process.env.DB === "db2" ? 5433 : 5432;
const databaseUrl = `postgres://wiki:wiki@localhost:${port}/wiki`;

export async function connect() {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  return client;
}
