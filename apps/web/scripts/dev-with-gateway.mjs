#!/usr/bin/env node

import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

function loadEnvFile(path) {
  if (!existsSync(path)) return;

  const content = readFileSync(path, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;

    const [, key, rawValue] = match;
    if (process.env[key] != null) continue;

    process.env[key] = rawValue
      .replace(/^(['"])(.*)\1$/, "$2")
      .replace(/\\n/g, "\n");
  }
}

loadEnvFile(".env");
loadEnvFile(".env.local");

const forwardedPort = process.env.PORT ?? "3000";
const localBaseUrl =
  process.env.KINFOLK_DEV_LOCAL_BASE_URL?.trim() ||
  `http://localhost:${forwardedPort}`;
const gatewayEnabled = process.env.KINFOLK_DEV_GATEWAY !== "false";
const shouldWriteEnv = process.env.KINFOLK_DEV_GATEWAY_WRITE_ENV !== "false";
const shouldSyncSendblue =
  process.env.KINFOLK_DEV_GATEWAY_SYNC_SENDBLUE === "true";
const gatewayCommand = process.env.KINFOLK_DEV_GATEWAY_COMMAND ?? "cloudflared";
const gatewayArgs = process.env.KINFOLK_DEV_GATEWAY_ARGS
  ? process.env.KINFOLK_DEV_GATEWAY_ARGS.split(/\s+/).filter(Boolean)
  : ["tunnel", "--url", `http://localhost:${forwardedPort}`];
const nextArgs = ["next", "dev", ...process.argv.slice(2)];

const children = new Set();
let shuttingDown = false;

function log(message) {
  process.stdout.write(`[dev] ${message}\n`);
}

function spawnChild(command, args, options = {}) {
  const child = spawn(command, args, {
    stdio: options.stdio ?? "inherit",
    env: options.env ?? process.env,
    shell: false,
  });
  children.add(child);
  child.once("exit", () => children.delete(child));
  return child;
}

function shutdown(signal, exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    if (child.exitCode == null && child.signalCode == null) {
      child.kill(signal);
    }
  }
  setTimeout(() => process.exit(exitCode), 250).unref();
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => shutdown(signal, 0));
}

function extractTryCloudflareUrl(chunk) {
  const text = chunk.toString();
  return text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i)?.[0] ?? null;
}

function updateLocalBaseUrl(publicUrl) {
  if (!shouldWriteEnv) return;

  const envPath = ".env.local";
  if (!existsSync(envPath)) return;

  const current = readFileSync(envPath, "utf8");
  const next = current.match(/^NEXT_PUBLIC_KINFOLK_BASE_URL=/m)
    ? current.replace(
        /^NEXT_PUBLIC_KINFOLK_BASE_URL=.*$/m,
        `NEXT_PUBLIC_KINFOLK_BASE_URL=${publicUrl}`,
      )
    : `${current.replace(/\s*$/, "\n")}NEXT_PUBLIC_KINFOLK_BASE_URL=${publicUrl}\n`;

  if (next !== current) {
    writeFileSync(envPath, next);
    log(`Updated ${envPath}: NEXT_PUBLIC_KINFOLK_BASE_URL=${publicUrl}`);
  }
}

function getWebhookUrl(value) {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && typeof value.url === "string") {
    return value.url;
  }
  return "";
}

function isDevSendblueWebhook(value) {
  const url = getWebhookUrl(value);
  return /^https:\/\/[a-z0-9-]+\.trycloudflare\.com\/api\/webhooks\/sendblue\/?$/i.test(
    url,
  );
}

function withoutDuplicateWebhook(values, url) {
  const existing = Array.isArray(values) ? values : [];
  return existing.filter((value) => getWebhookUrl(value).replace(/\/+$/, "") !== url);
}

async function syncSendblueWebhooks(publicUrl) {
  if (!shouldSyncSendblue) return;
  if ((process.env.KINFOLK_TEXT_TRANSPORT ?? "").trim().toLowerCase() !== "sendblue") {
    return;
  }

  const apiKey = process.env.SENDBLUE_API_KEY?.trim();
  const apiSecret = process.env.SENDBLUE_API_SECRET?.trim();
  if (!apiKey || !apiSecret) {
    log("Skipping Sendblue webhook sync; SENDBLUE_API_KEY or SENDBLUE_API_SECRET is missing.");
    return;
  }

  const apiBaseUrl = (process.env.SENDBLUE_API_BASE_URL ?? "https://api.sendblue.co")
    .replace(/\/+$/, "");
  const endpoint = `${apiBaseUrl}/api/account/webhooks`;
  const webhookUrl = `${publicUrl}/api/webhooks/sendblue`;
  const secret = process.env.SENDBLUE_WEBHOOK_SIGNING_SECRET?.trim();
  const webhook = secret ? { url: webhookUrl, secret } : webhookUrl;
  const headers = {
    "Content-Type": "application/json",
    "sb-api-key-id": apiKey,
    "sb-api-secret-key": apiSecret,
  };

  const currentResponse = await fetch(endpoint, { headers });
  if (!currentResponse.ok) {
    log(`Skipping Sendblue webhook sync; GET failed with ${currentResponse.status}.`);
    return;
  }

  const currentPayload = await currentResponse.json();
  const currentWebhooks =
    currentPayload && typeof currentPayload === "object" && currentPayload.webhooks
      ? currentPayload.webhooks
      : {};
  const nextWebhooks = { ...currentWebhooks };

  for (const key of Object.keys(nextWebhooks)) {
    if (Array.isArray(nextWebhooks[key])) {
      nextWebhooks[key] = nextWebhooks[key].filter(
        (value) => !isDevSendblueWebhook(value),
      );
    }
  }

  nextWebhooks.receive = [
    ...withoutDuplicateWebhook(nextWebhooks.receive, webhookUrl),
    webhook,
  ];
  nextWebhooks.outbound = [
    ...withoutDuplicateWebhook(nextWebhooks.outbound, webhookUrl),
    webhook,
  ];

  const updateResponse = await fetch(endpoint, {
    method: "PUT",
    headers,
    body: JSON.stringify({ webhooks: nextWebhooks }),
  });
  if (!updateResponse.ok) {
    log(`Sendblue webhook sync failed with ${updateResponse.status}.`);
    return;
  }

  log(`Synced Sendblue webhooks to ${webhookUrl}`);
}

async function startGateway() {
  log(`Starting gateway: ${gatewayCommand} ${gatewayArgs.join(" ")}`);
  const child = spawn(gatewayCommand, gatewayArgs, {
    stdio: ["ignore", "pipe", "pipe"],
    env: process.env,
    shell: false,
  });
  children.add(child);

  let resolved = false;
  let bufferedOutput = "";

  const urlPromise = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(
        new Error(
          `Timed out waiting for a cloudflared public URL.\n${bufferedOutput.trim()}`,
        ),
      );
    }, 30_000);

    const handleOutput = (chunk) => {
      process.stdout.write(chunk);
      bufferedOutput += chunk.toString();
      const url = extractTryCloudflareUrl(chunk);
      if (!url || resolved) return;
      resolved = true;
      clearTimeout(timeout);
      resolve(url);
    };

    child.stdout.on("data", handleOutput);
    child.stderr.on("data", handleOutput);
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("exit", (code, signal) => {
      children.delete(child);
      if (!resolved) {
        clearTimeout(timeout);
        reject(
          new Error(
            `Gateway exited before publishing a URL (code ${code}, signal ${signal}).`,
          ),
        );
      }
    });
  });

  const publicUrl = await urlPromise;
  log(`Gateway ready: ${publicUrl}`);
  log(`Webhook endpoints: ${publicUrl}/api/webhooks/sendblue and ${publicUrl}/api/webhooks/linq?version=2026-02-03`);
  updateLocalBaseUrl(publicUrl);
  await syncSendblueWebhooks(publicUrl);
  return { child, publicUrl };
}

async function main() {
  let env = process.env;

  if (gatewayEnabled) {
    const { publicUrl } = await startGateway();
    env = {
      ...process.env,
      NEXT_PUBLIC_KINFOLK_BASE_URL: publicUrl,
      KINFOLK_DEV_GATEWAY_URL: publicUrl,
      KINFOLK_DEV_LOCAL_BASE_URL: localBaseUrl,
    };
  } else {
    log("Gateway disabled; starting plain Next dev.");
  }

  log(`Starting web app: npx ${nextArgs.join(" ")}`);
  const next = spawnChild("npx", nextArgs, { env });
  const [code, signal] = await once(next, "exit");
  shutdown(signal ?? "SIGTERM", code ?? 0);
}

main().catch((error) => {
  console.error(`[dev] ${error instanceof Error ? error.message : String(error)}`);
  shutdown("SIGTERM", 1);
});
