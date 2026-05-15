#!/usr/bin/env node
import "dotenv/config";
import fs from "fs";
import https from "https";
import http from "http";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { WordPressClient } from "./wordpress-client.js";

function getConfig() {
  const siteUrl = process.env.WP_SITE_URL;
  const username = process.env.WP_USERNAME;
  const appPassword = process.env.WP_APPLICATION_PASSWORD;
  if (!siteUrl || !username || !appPassword) {
    throw new Error(
      "Missing required environment variables: WP_SITE_URL, WP_USERNAME, WP_APPLICATION_PASSWORD"
    );
  }
  return { siteUrl, username, appPassword };
}

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------
const TOOLS: Tool[] = [
  {
    name: "list_backups",
    description:
      "List all available backup files on the WordPress site managed by All-in-One WP Migration. " +
      "Returns each backup's filename, size, creation date, and download URL.",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "export_backup",
    description:
      "Trigger a full site export (backup) using All-in-One WP Migration. " +
      "Optionally exclude specific content to reduce backup size. " +
      "Returns a job ID — poll get_backup_status until status is 'complete' to get the download URL.",
    inputSchema: {
      type: "object",
      properties: {
        no_media:            { type: "boolean", description: "Exclude media library files." },
        no_spam:             { type: "boolean", description: "Exclude spam comments." },
        no_post_revisions:   { type: "boolean", description: "Exclude post revisions." },
        no_cache:            { type: "boolean", description: "Exclude cache files." },
        no_database:         { type: "boolean", description: "Exclude the database." },
        no_plugins:          { type: "boolean", description: "Exclude all plugins." },
        no_themes:           { type: "boolean", description: "Exclude all themes." },
        no_inactive_plugins: { type: "boolean", description: "Exclude inactive plugins." },
        no_inactive_themes:   { type: "boolean", description: "Exclude inactive themes." },
        no_security:          { type: "boolean", description: "Exclude security options (passwords, keys, credentials)." },
        no_must_use_plugins:  { type: "boolean", description: "Exclude must-use plugins (mu-plugins)." },
      },
      required: [],
    },
  },
  {
    name: "import_backup",
    description:
      "Import (restore) a WordPress site from a .wpress backup file URL. " +
      "The file is downloaded locally then uploaded to the site in 2 MB chunks. " +
      "After upload, poll get_backup_status with the returned job_id to monitor extraction and restoration. " +
      "WARNING: This replaces all site content. Large files (>100 MB) may take several minutes.",
    inputSchema: {
      type: "object",
      properties: {
        file_url: {
          type: "string",
          description: "Publicly accessible HTTPS URL of the .wpress backup file.",
        },
      },
      required: ["file_url"],
    },
  },
  {
    name: "get_backup_status",
    description:
      "Check the current status of an export or import job. " +
      "For exports: also triggers the next processing step (call repeatedly until status is 'complete'). " +
      "For imports: returns the current extraction/restore progress.",
    inputSchema: {
      type: "object",
      properties: {
        job_id: { type: "string", description: "Job ID returned by export_backup or import_backup." },
      },
      required: ["job_id"],
    },
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function downloadToBuffer(url: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith("https") ? https : http;
    protocol.get(url, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        resolve(downloadToBuffer(res.headers.location));
        return;
      }
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => resolve(Buffer.concat(chunks)));
      res.on("error", reject);
    }).on("error", reject);
  });
}

// ---------------------------------------------------------------------------
// Tool handlers
// ---------------------------------------------------------------------------
async function handleListBackups(client: WordPressClient): Promise<string> {
  const backups = await client.listBackups();
  if (backups.length === 0) return "No backup files found on your WordPress site.";

  const sorted = [...backups].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );

  const lines = sorted.map((b, i) => {
    const date = new Date(b.created_at).toLocaleString();
    const size = b.size_human ?? client.formatBytes(b.size);
    return (
      `${i + 1}. ${b.name}\n   Size: ${size} | Created: ${date}` +
      (b.download_url ? `\n   Download: ${b.download_url}` : "")
    );
  });

  return `Found ${backups.length} backup(s) — most recent first:\n\n${lines.join("\n\n")}`;
}

interface ExportArgs {
  no_media?: boolean;
  no_spam?: boolean;
  no_post_revisions?: boolean;
  no_cache?: boolean;
  no_database?: boolean;
  no_plugins?: boolean;
  no_themes?: boolean;
  no_inactive_plugins?: boolean;
  no_inactive_themes?: boolean;
  no_security?: boolean;
  no_must_use_plugins?: boolean;
}

async function handleExportBackup(
  client: WordPressClient,
  args: ExportArgs
): Promise<string> {
  const result = await client.exportBackup({
    no_media:            args.no_media,
    no_spam:             args.no_spam,
    no_post_revisions:   args.no_post_revisions,
    no_cache:            args.no_cache,
    no_database:         args.no_database,
    no_plugins:          args.no_plugins,
    no_themes:           args.no_themes,
    no_inactive_plugins:  args.no_inactive_plugins,
    no_inactive_themes:   args.no_inactive_themes,
    no_security:          args.no_security,
    no_must_use_plugins:  args.no_must_use_plugins,
  });

  const lines = [
    `Export started.`,
    `Job ID: ${result.job_id}`,
    `Status: ${result.status}`,
  ];
  if (result.archive) lines.push(`File: ${result.archive}`);
  if (result.download_url) lines.push(`Download URL: ${result.download_url}`);
  lines.push(`\nCall get_backup_status with job_id "${result.job_id}" to check progress.`);
  return lines.join("\n");
}

async function handleImportBackup(
  client: WordPressClient,
  args: { file_url: string }
): Promise<string> {
  if (!args.file_url?.startsWith("http")) {
    throw new Error("file_url must be a valid HTTP/HTTPS URL pointing to a .wpress file.");
  }

  const CHUNK_SIZE = 2 * 1024 * 1024; // 2 MB

  // Check site capabilities
  const caps = await client.getCapabilities();

  // Start import job
  const job = await client.startImport();
  const jobId = job.job_id;

  // Download the backup file into memory
  const fileBuffer = await downloadToBuffer(args.file_url);
  const totalSize = fileBuffer.length;
  const totalChunks = Math.ceil(totalSize / CHUNK_SIZE);

  // Upload in chunks
  let offset = 0;
  for (let i = 0; i < totalChunks; i++) {
    const chunk = fileBuffer.subarray(offset, offset + CHUNK_SIZE);
    await client.uploadChunk(jobId, Buffer.from(chunk), offset, totalSize);
    offset += chunk.length;
  }

  const lines = [
    `Import upload complete.`,
    `Job ID: ${jobId}`,
    `File size: ${client.formatBytes(totalSize)} (${totalChunks} chunks of 2 MB)`,
    `Site max upload size: ${caps.max_upload_size_human}`,
    ``,
    `The site is now extracting and restoring the backup. This may take several minutes for large files.`,
    `Call get_backup_status with job_id "${jobId}" repeatedly to monitor progress.`,
    `WARNING: Site content is being replaced — do not interrupt the process.`,
  ];
  return lines.join("\n");
}

async function handleGetBackupStatus(
  client: WordPressClient,
  args: { job_id: string }
): Promise<string> {
  const status = await client.getJobStatus(args.job_id);

  const lines = [`Job ID: ${status.job_id}`, `Status: ${status.status}`];
  if (status.percent !== undefined) lines.push(`Progress: ${status.percent}%`);
  if (status.archive) lines.push(`Backup file: ${status.archive}`);
  if (status.download_url) lines.push(`Download URL: ${status.download_url}`);
  if (status.message) {
    // Strip HTML tags from message
    const clean = status.message.replace(/<[^>]*>/g, "").trim();
    if (clean) lines.push(`Message: ${clean}`);
  }

  if (status.status === "complete" && !status.download_url) {
    lines.push(`\nRun list_backups to see the completed backup.`);
  }
  if (status.status === "running" || status.status === "awaiting_upload") {
    lines.push(`\nCall get_backup_status again to check for updates.`);
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Server setup
// ---------------------------------------------------------------------------
async function main() {
  const config = getConfig();
  const client = new WordPressClient(config.siteUrl, config.username, config.appPassword);

  const server = new Server(
    { name: "all-in-one-wp-migration-rest-api-mcp", version: "1.3.0" },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    try {
      let result: string;
      switch (name) {
        case "list_backups":
          result = await handleListBackups(client);
          break;
        case "export_backup":
          result = await handleExportBackup(client, (args ?? {}) as ExportArgs);
          break;
        case "import_backup":
          result = await handleImportBackup(client, args as { file_url: string });
          break;
        case "get_backup_status":
          result = await handleGetBackupStatus(client, args as { job_id: string });
          break;
        default:
          throw new Error(`Unknown tool: ${name}`);
      }
      return { content: [{ type: "text", text: result }] };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write("All-in-One WP Migration REST API MCP running\n");
}

main().catch((err) => {
  process.stderr.write(`Fatal: ${err instanceof Error ? err.message : err}\n`);
  process.exit(1);
});
