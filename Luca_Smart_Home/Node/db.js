// Connection to the PostgreSQL database (Database/schema.sql).
// The connection comes from the environment variables PGHOST, PGPORT, PGUSER, PGPASSWORD, PGDATABASE.
const { Pool, types } = require("pg");

// BIGINT ids come as strings by default, they are far below Number.MAX_SAFE_INTEGER
types.setTypeParser(types.builtins.INT8, Number);

// only one connection, so writes are executed in the order they were started;
// jit=off: PostgreSQL overestimates the recursive view devices_with_room by far and then spends
// seconds compiling the query to machine code (JIT), which never pays off for these small tables
const db = new Pool({ max: 1, options: "-c jit=off" });

module.exports = db;
