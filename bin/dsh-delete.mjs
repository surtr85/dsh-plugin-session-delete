#!/usr/bin/env node

/**
 * CLI utility to permanently delete a DeepSeek Harness session via the internal API Gateway.
 *
 * Usage:
 *   dsh-delete <sessionId>
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const args = process.argv.slice(2);
if (args.length === 0 && !process.env.DSH_SESSION_ID) {
  console.error("Usage: dsh-delete <sessionId>");
  process.exit(1);
}

const sessionId = args[0] || process.env.DSH_SESSION_ID;

const credPath = path.join(process.env.HOME || "/home/amadeus", ".dsh", ".credentials.yaml");
if (!fs.existsSync(credPath)) {
  console.error(`Error: Credentials file not found at ${credPath}`);
  process.exit(1);
}

const credContent = fs.readFileSync(credPath, "utf8");
const match = credContent.match(/client-connection\/browser-session:[\s\S]*?secret:\s*([A-Za-z0-9_-]+)/);
if (!match) {
  console.error("Error: Could not find browser-session secret in .credentials.yaml");
  process.exit(1);
}

const secretB64 = match[1];

function decodeBase64Url(value) {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  return Buffer.from(value.replaceAll("-", "+").replaceAll("_", "/") + padding, "base64");
}

function encodeBase64Url(value) {
  return Buffer.from(value).toString("base64").replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

const secret = decodeBase64Url(secretB64);
const webUrlStr = process.env.DSH_WEB_URL || "http://127.0.0.1:3080";
const webUrl = new URL(webUrlStr);
const authority = webUrl.host;

const cookieName = "dsh-auth-" + encodeBase64Url(crypto.createHash("sha256").update(authority).digest());
const now = Date.now();
const payload = {
  version: 1,
  authority,
  issuedAt: now,
  expiresAt: now + 86400000,
};
const body = encodeBase64Url(Buffer.from(JSON.stringify(payload), "utf8"));
const sig = encodeBase64Url(crypto.createHmac("sha256", secret).update(body).digest());
const cookieHeader = `${cookieName}=v1.${body}.${sig}`;

const res = await fetch(`${webUrl.origin}/dsh-ext/session-delete`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Cookie: cookieHeader,
  },
  body: JSON.stringify({ sessionId }),
});

if (!res.ok) {
  const text = await res.text();
  console.error(`HTTP ${res.status}: ${text}`);
  process.exit(1);
}

const json = await res.json();
if (json.ok) {
  console.log(`Successfully deleted session "${sessionId}" (deleted from disk: ${json.deleted})`);
} else {
  console.error("Delete Error:", JSON.stringify(json.error || json));
  process.exit(1);
}
