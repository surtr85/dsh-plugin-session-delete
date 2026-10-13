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

  return foundAndDeleted;
}

/**
 * DeepSeek Harness Host Plugin entry point.
 * Mounts the HTTP endpoint `/api/session/delete` and agent tool `session_delete`.
 *
 * @param {import("@deepseek-ai/cordis").Context} ctx
 */
export function apply(ctx) {
  ctx.logger?.info?.("dsh-plugin-session-delete: mounting session delete engine");

  // 1. Register WebServer endpoint for UI context menu and RPC calls
  if (ctx.webServer) {
    const route = {
      kind: "exact",
      path: "/api/session/delete",
      handler: async (req, res) => {
        // Authenticate request if Connection service is available
        const connection = ctx.get("connection");
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

            // Close active agent if running in memory
            try {
              const liveAgent = ctx.get("agents")?.get?.(sessionId);
              if (liveAgent && typeof liveAgent.dispose === "function") {
                await liveAgent.dispose();
              }
            } catch (err) {
              ctx.logger?.warn?.(`dsh-plugin-session-delete: failed to dispose live agent: ${err.message}`);
            }

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

    ctx.effect(() => ctx.webServer.register(route), "dsh-plugin-session-delete: /api/session/delete");
  }

  // 2. Register Agent Tool `session_delete` if tools service is available
  ctx.inject(["tools"], (toolCtx) => {
    if (toolCtx.tools && typeof defineTool === "function") {
      toolCtx.tools.register(
        defineTool({
          name: "session_delete",
          description:
            "Permanently delete a specified session by its sessionId, completely erasing its data and logs from disk. Use with caution.",
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
                text: `Session "${value.sessionId}" permanently removed from disk (deleted: ${value.deleted}).`,
              },
            ],
          },
          async execute(args) {
            const sessionId = args?.sessionId?.trim();
            if (!sessionId) {
              throw new Error("session_delete requires a valid sessionId");
            }

            const deleted = await removeSessionFiles(sessionId);
            return {
              ok: true,
              sessionId,
              deleted,
            };
          },
        })
      );
    }
  });
}
