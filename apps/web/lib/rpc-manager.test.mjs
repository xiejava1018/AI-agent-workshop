import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("RPC session startup preloads extension-registered providers before restoring models", async () => {
  const source = await readFile(new URL("./rpc-manager.ts", import.meta.url), "utf8");
  // Search the whole file rather than only the slice after startRpcSession,
  // because T2.4 moved the createAgentSessionServices call into a helper
  // (getOrCreateServices) and the architectural invariant we are guarding
  // is "this file builds services via createAgentSessionServices and uses
  // createAgentSessionFromServices for the session step", not "the literal
  // calls live inside the startRpcSession function body".
  assert.match(source, /createAgentSessionServices\(/);
  assert.match(source, /createAgentSessionFromServices\(/);
  assert.doesNotMatch(source, /await createAgentSession\(/);
});
