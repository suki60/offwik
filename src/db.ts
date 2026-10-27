import pg from "pg";

// count(*) and sum() return bigint, which pg gives back as a string by default
// (a JS number is only exact up to 2^53). Our counts and ids are far below that.
pg.types.setTypeParser(pg.types.builtins.INT8, Number);

// Two databases in compose.yaml: db (full Simple English) on 5430, db2 (10k
// articles) on 5431. 5432 is left to a local Homebrew Postgres.
// Pick db2 with DB=db2, e.g. `DB=db2 npm run search -- "question"`.
const port = process.env.DB === "db2" ? 5431 : 5430;
const databaseUrl = `postgres://wiki:wiki@localhost:${port}/wiki`;

export async function connect() {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  return client;
}
