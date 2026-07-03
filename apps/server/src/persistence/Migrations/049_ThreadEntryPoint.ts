// FILE: 049_ThreadEntryPoint.ts
// Purpose: Persists which primary surface (chat vs terminal) a thread was created for,
//   so terminal threads reopen as terminals on every client instead of relying on
//   client-local storage.
// Layer: Server persistence migration
// Depends on: projection_threads table and schemaHelpers.columnExists.

import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { columnExists } from "./schemaHelpers.ts";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  if (!(yield* columnExists(sql, "projection_threads", "entry_point"))) {
    yield* sql`
      ALTER TABLE projection_threads
      ADD COLUMN entry_point TEXT NOT NULL DEFAULT 'chat'
    `;
  }
});
