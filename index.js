import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import os from "node:os";
import { defineTool } from "@deepseek-ai/dsh-tools";

export const name = "dsh-plugin-session-delete";

const SESSION_ID_REGEX = /^session-[0-9a-fA-F-]+$/;

/**
 * Remove session files from disk safely.
 * Scans all workspace prefixes under ~/.dsh/sessions/ and ~/.dsh/recovery/.
 *
 * @param {string} sessionId
 * @returns {Promise<boolean>} whether any session folder was removed
 */
export async function removeSessionFiles(sessionId) {
  if (!SESSION_ID_REGEX.test(sessionId)) {
    throw new Error(`Invalid sessionId format: "${sessionId}"`);
  }

  const dshHome = process.env.DSH_HOME || path.join(os.homedir(), ".dsh");
  const sessionsDir = path.join(dshHome, "sessions");
  let foundAndDeleted = false;

  if (fsSync.existsSync(sessionsDir)) {
    const workspaces = await fs.readdir(sessionsDir, { withFileTypes: true });
    for (const ws of workspaces) {
      if (ws.isDirectory()) {
        const candidate = path.join(sessionsDir, ws.name, sessionId);
        if (fsSync.existsSync(candidate)) {
          await fs.rm(candidate, { recursive: true, force: true });
          foundAndDeleted = true;
        }
      }
    }
  }

  const recoveryCandidate = path.join(dshHome, "recovery", sessionId);
  if (fsSync.existsSync(recoveryCandidate)) {
    await fs.rm(recoveryCandidate, { recursive: true, force: true });
  }

  // Clear projection caches so UI sidebar never shows orphan ghost sessions
  const projCacheDirs = [
    path.join(dshHome, "storages", "session_projcache", "sessions"),
    path.join(dshHome, "storages", "session_projcache_archive_manager_v2", "sessions"),
  ];

  for (const cacheDir of projCacheDirs) {
    const cacheFile = path.join(cacheDir, `${sessionId}.json`);
    if (fsSync.existsSync(cacheFile)) {
      await fs.rm(cacheFile, { recursive: true, force: true });
      foundAndDeleted = true;
    }
  }

  return foundAndDeleted;
}

/**
 * Evict session from runtime state (agents, sessions, workspaceRegistry) and emit WebSocket broadcast.
 *
 * @param {import("@deepseek-ai/cordis").Context} ctx
 * @param {string} sessionId
 */
export async function purgeSessionFromRuntime(ctx, sessionId) {
  if (!SESSION_ID_REGEX.test(sessionId)) return;

  // 1. Dispose live agent if running
  try {
    const agents = ctx.get("agents");
    const liveAgent = agents?.get?.(sessionId);
    if (liveAgent && typeof liveAgent.dispose === "function") {
      await liveAgent.dispose().catch(() => {});
    }
  } catch (err) {
    ctx.logger?.warn?.(`[session-manager] agent disposal error for ${sessionId}: ${err.message}`);
  }

  // 2. Detach live session if loaded in memory
  try {
    const sessions = ctx.get("sessions");
    const liveSession = sessions?.get?.(sessionId);
    if (liveSession && typeof liveSession.dispose === "function") {
      await liveSession.dispose().catch(() => {});
    }
  } catch (err) {
    ctx.logger?.warn?.(`[session-manager] live session disposal error for ${sessionId}: ${err.message}`);
  }

  // 3. Clean up workspaceRegistry memberships, pin, and archive lists
  try {
    const wsRegistry = ctx.get("workspaceRegistry");
    if (wsRegistry) {
      if (typeof wsRegistry.unarchiveSession === "function") {
        await wsRegistry.unarchiveSession(sessionId).catch(() => {});
      }
      if (typeof wsRegistry.unpinSession === "function") {
        await wsRegistry.unpinSession(sessionId).catch(() => {});
      }
      const table = wsRegistry.table || (typeof wsRegistry.requireTable === "function" ? wsRegistry.requireTable() : null);
      if (table) {
        for (const [wsId, record] of table.entries()) {
          if (record.sessionIds && record.sessionIds.includes(sessionId)) {
            const updated = record.sessionIds.filter((id) => id !== sessionId);
            await table.set(wsId, {
              ...record,
              sessionIds: updated,
              updatedAt: new Date().toISOString(),
            }).catch(() => {});
          }
        }
      }
      wsRegistry.headers?.delete?.(sessionId);
      wsRegistry.sessionPaths?.delete?.(sessionId);
      wsRegistry.invalidSessionPaths?.delete?.(sessionId);
    }
  } catch (err) {
    ctx.logger?.warn?.(`[session-manager] workspace registry cleanup error for ${sessionId}: ${err.message}`);
  }

  // 4. Emit Cordis events that propagate through dsh-api-remotes to WebSockets
  try {
    ctx.emit("api-session/removed", sessionId);
    ctx.emit("session/disposed", { id: sessionId, header: { id: sessionId } });
    ctx.emit("workspace/orderChanged");
  } catch (err) {
    ctx.logger?.warn?.(`[session-manager] event broadcast error for ${sessionId}: ${err.message}`);
  }
}

/**
 * DeepSeek Harness Host Plugin entry point.
 *
 * @param {import("@deepseek-ai/cordis").Context} ctx
 */
export function apply(ctx) {
  ctx.logger?.info?.("dsh-plugin-session-delete: mounting session management & live delete engine");

  // 1. Register WebServer endpoints
  ctx.inject(["webServer"], (webCtx) => {
    // Single delete endpoint
    const deleteRoute = {
      kind: "exact",
      path: "/dsh-ext/session-delete",
      handler: async (req, res) => {
        const connection = webCtx.get("connection");
        if (connection && typeof connection.admit === "function") {
          const admission = connection.admit(req);
          if ("rejection" in admission) {
            res.writeHead(admission.rejection, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: false, error: "unauthorized" }));
            return;
          }
        }

        if (req.method !== "POST") {
          res.writeHead(405, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: "method not allowed" }));
          return;
        }

        let bodyRaw = "";
        req.on("data", (chunk) => {
          bodyRaw += chunk;
        });

        req.on("end", async () => {
          try {
            const body = JSON.parse(bodyRaw || "{}");
            const sessionId = body.sessionId || body.payload?.args?.request?.sessionId;

            if (!sessionId || typeof sessionId !== "string") {
              res.writeHead(400, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ ok: false, error: "sessionId is required" }));
              return;
            }

            // Purge runtime state & broadcast WebSocket event FIRST
            await purgeSessionFromRuntime(webCtx, sessionId);

            // Remove files from disk
            const deleted = await removeSessionFiles(sessionId);

            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: true, sessionId, deleted }));
          } catch (err) {
            res.writeHead(500, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: false, error: err.message }));
          }
        });
      },
    };

    // Bulk delete endpoint
    const bulkDeleteRoute = {
      kind: "exact",
      path: "/dsh-ext/session-bulk-delete",
      handler: async (req, res) => {
        const connection = webCtx.get("connection");
        if (connection && typeof connection.admit === "function") {
          const admission = connection.admit(req);
          if ("rejection" in admission) {
            res.writeHead(admission.rejection, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: false, error: "unauthorized" }));
            return;
          }
        }

        if (req.method !== "POST") {
          res.writeHead(405, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: "method not allowed" }));
          return;
        }

        let bodyRaw = "";
        req.on("data", (chunk) => {
          bodyRaw += chunk;
        });

        req.on("end", async () => {
          try {
            const body = JSON.parse(bodyRaw || "{}");
            const sessionIds = Array.isArray(body.sessionIds) ? body.sessionIds : [];

            if (sessionIds.length === 0) {
              res.writeHead(400, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ ok: false, error: "sessionIds array is required" }));
              return;
            }

            const results = [];
            for (const id of sessionIds) {
              try {
                await purgeSessionFromRuntime(webCtx, id);
                const deleted = await removeSessionFiles(id);
                results.push({ id, ok: true, deleted });
              } catch (e) {
                results.push({ id, ok: false, error: e.message });
              }
            }

            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: true, results }));
          } catch (err) {
            res.writeHead(500, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: false, error: err.message }));
          }
        });
      },
    };

    
    // Sessions list endpoint
    const listRoute = {
      kind: "exact",
      path: "/dsh-ext/sessions",
      handler: async (req, res) => {
        try {
          const dshHome = process.env.DSH_HOME || path.join(os.homedir(), ".dsh");
          const projCacheDir = path.join(dshHome, "storages", "session_projcache", "sessions");
          const sessions = [];

          if (fsSync.existsSync(projCacheDir)) {
            const files = await fs.readdir(projCacheDir);
            for (const file of files) {
              if (file.endsWith(".json")) {
                try {
                  const content = await fs.readFile(path.join(projCacheDir, file), "utf-8");
                  const data = JSON.parse(content);
                  sessions.push({
                    id: file.replace(".json", ""),
                    title: data.title || data.displayTitle || file.replace(".json", ""),
                    displayTitle: data.displayTitle || data.title || file.replace(".json", ""),
                    updatedAt: data.updatedAt || 0,
                    cwd: data.cwd || "",
                    running: false,
                  });
                } catch {}
              }
            }
          }

          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true, sessions }));
        } catch (err) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: err.message }));
        }
      },
    };

    webCtx.effect(() => webCtx.webServer.register(listRoute), "dsh-plugin-session-delete: /dsh-ext/sessions");
    webCtx.effect(() => webCtx.webServer.register(deleteRoute), "dsh-plugin-session-delete: /dsh-ext/session-delete");
    webCtx.effect(() => webCtx.webServer.register(bulkDeleteRoute), "dsh-plugin-session-delete: /dsh-ext/session-bulk-delete");
  });

  // 2. Register Agent Tool `session_delete` if tools service is available
  ctx.inject(["tools"], (toolCtx) => {
    if (toolCtx.tools && typeof defineTool === "function") {
      const sessionDeleteTool = defineTool({
        name: "session_delete",
        description:
          "Permanently delete a specified session by its sessionId, completely erasing its data and logs from disk and runtime memory. Use with caution.",
        parameters: {
          sessionId: {
            type: "string",
            required: true,
            description: "The unique identifier of the session to delete (e.g. session-3090573d-2edd-4f3f-b4f8-3fb9f6e70f20).",
          },
        },
        output: {
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              ok: { type: "boolean", required: true },
              sessionId: { type: "string", required: true },
              deleted: { type: "boolean", required: true },
            },
          },
          render: (_args, value) => [
            {
              type: "text",
              text: `Session "${value.sessionId}" permanently removed from disk and runtime (deleted: ${value.deleted}).`,
            },
          ],
        },
        async execute(args) {
          const sessionId = args?.sessionId?.trim();
          if (!sessionId) {
            throw new Error("session_delete requires a valid sessionId");
          }

          await purgeSessionFromRuntime(toolCtx, sessionId);
          const deleted = await removeSessionFiles(sessionId);
          return {
            ok: true,
            sessionId,
            deleted,
          };
        },
      });

      toolCtx.effect(() => toolCtx.tools.register(sessionDeleteTool), "dsh-plugin-session-delete: session_delete tool");
    }
  });
}
