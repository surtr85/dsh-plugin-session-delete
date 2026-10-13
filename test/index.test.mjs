import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { apply, name, removeSessionFiles } from "../index.js";

test("plugin metadata", () => {
  assert.equal(name, "dsh-plugin-session-delete");
});

test("removeSessionFiles rejects invalid or malicious sessionIds", async () => {
  await assert.rejects(
    async () => removeSessionFiles("../../../etc/passwd"),
    /Invalid sessionId format/
  );

  await assert.rejects(
    async () => removeSessionFiles(""),
    /Invalid sessionId format/
  );

  await assert.rejects(
    async () => removeSessionFiles("session-;rm -rf /"),
    /Invalid sessionId format/
  );
});

test("removeSessionFiles removes existing session directory", async () => {
  const tmpDsh = await fs.mkdtemp(path.join(os.tmpdir(), "dsh-test-"));
  const prevDshHome = process.env.DSH_HOME;
  process.env.DSH_HOME = tmpDsh;

  try {
    const testSessionId = "session-12345678-1234-1234-1234-123456789abc";
    const sessionDir = path.join(tmpDsh, "sessions", "workspace-1", testSessionId);
    await fs.mkdir(sessionDir, { recursive: true });
    await fs.writeFile(path.join(sessionDir, "session.lock"), "");

    const deleted = await removeSessionFiles(testSessionId);
    assert.equal(deleted, true, "Should return true when session directory was found and deleted");

    const exists = await fs
      .access(sessionDir)
      .then(() => true)
      .catch(() => false);
    assert.equal(exists, false, "Session directory should not exist after removal");
  } finally {
    process.env.DSH_HOME = prevDshHome;
    await fs.rm(tmpDsh, { recursive: true, force: true });
  }
});

test("plugin registers webServer route and agent tool", () => {
  let registeredRoute = null;
  let registeredTool = null;

  const mockCtx = {
    logger: { info: () => {}, warn: () => {} },
    webServer: {
      register: (route) => {
        registeredRoute = route;
      },
    },
    tools: {
      register: (tool) => {
        registeredTool = tool;
      },
    },
    effect: (fn) => fn(),
    inject: (deps, cb) => cb(mockCtx),
    get: () => null,
  };

  apply(mockCtx);

  assert.ok(registeredRoute, "WebServer route must be registered");
  assert.equal(registeredRoute.path, "/api/session/delete");
  assert.equal(registeredRoute.kind, "exact");

  assert.ok(registeredTool, "Agent tool must be registered");
  assert.equal(registeredTool.name, "session_delete");
  assert.ok(registeredTool.parameters.properties.sessionId, "sessionId property must exist");
});
