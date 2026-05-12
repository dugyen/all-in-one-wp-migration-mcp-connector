#!/usr/bin/env node
import "dotenv/config";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { WordPressClient } from "./wordpress-client.js";

// ---------------------------------------------------------------------------
// Configuration — read from environment variables
// ---------------------------------------------------------------------------
function getConfig() {
  const siteUrl = process.env.WP_SITE_URL;
  const username = process.env.WP_USERNAME;
  const appPassword = process.env.WP_APPLICATION_PASSWORD;

  if (!siteUrl || !username || !appPassword) {
    throw new Error(
      "Missing required environment variables: WP_SITE_URL, WP_USERNAME, WP_APPLICATION_PASSWORD\n" +
        "Copy .env.example to .env and fill in your WordPress credentials."
    );
  }

  return {
    siteUrl,
    username,
    appPassword,
    secretKey: process.env.AI1WM_SECRET_KEY ?? "",
  };
}

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------
const TOOLS: Tool[] = [
  {
    name: "list_backups",
    description:
      "List all available backup files on the WordPress site managed by All-in-One WP Migration. " +
      "Returns each backup's filename, size, creation date, and type.",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    name: "export_backup",
    description:
      "Trigger a full site export (backup) using All-in-One WP Migration. " +
      "Returns a job ID and, once complete, a download URL for the backup file. " +
      "Optionally exclude spam comments or media files to reduce backup size.",
    inputSchema: {
      type: "object",
      properties: {
        exclude_spam: {
          type: "boolean",
          description: "Exclude spam comments from the backup (default: false).",
        },
        exclude_media: {
          type: "boolean",
          description: "Exclude media files from the backup (default: false).",
        },
      },
      required: [],
    },
  },
  {
    name: "import_backup",
    description:
      "Import (restore) a WordPress site from a backup file using All-in-One WP Migration. " +
      "Provide a publicly accessible URL pointing to the .wpress backup file, " +
      "or a URL previously returned by export_backup.",
    inputSchema: {
      type: "object",
      properties: {
        file_url: {
          type: "string",
          description: "Publicly accessible URL of the .wpress backup file to import.",
        },
      },
      required: ["file_url"],
    },
  },
  {
    name: "get_backup_status",
    description:
      "Check the status of an ongoing or recently completed import or export operation. " +
      "Use the job_id returned by export_backup or import_backup.",
    inputSchema: {
      type: "object",
      properties: {
        job_id: {
          type: "string",
          description: "The job ID returned by export_backup or import_backup.",
        },
      },
      required: ["job_id"],
    },
  },
];

// ---------------------------------------------------------------------------
// Tool handlers
// ---------------------------------------------------------------------------
async function handleListBackups(client: WordPressClient): Promise<string> {
  const backups = await client.listBackups();

  if (backups.length === 0) {
    return "No backup files found on your WordPress site.";
  }

  const sorted = [...backups].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );

  const lines = sorted.map((b, i) => {
    const date = new Date(b.created_at).toLocaleString();
    const size = b.size_human ?? client.formatBytes(b.size);
    return `${i + 1}. ${b.name}\n   Size: ${size} | Created: ${date}${b.download_url ? `\n   Download: ${b.download_url}` : ""}`;
  });

  return `Found ${backups.length} backup(s):\n\n${lines.join("\n\n")}`;
}

async function handleExportBackup(
  client: WordPressClient,
  args: { exclude_spam?: boolean; exclude_media?: boolean }
): Promise<string> {
  const result = await client.exportBackup({
    exclude_spam: args.exclude_spam ?? false,
    exclude_media: args.exclude_media ?? false,
  });

  const lines = [
    `Export started successfully.`,
    `Job ID: ${result.job_id}`,
    `Status: ${result.status}`,
  ];

  if (result.download_url) {
    lines.push(`Download URL: ${result.download_url}`);
  }
  if (result.filename) {
    lines.push(`Filename: ${result.filename}`);
  }
  if (result.message) {
    lines.push(`Message: ${result.message}`);
  }

  lines.push(
    `\nUse get_backup_status with job_id "${result.job_id}" to check when the export is complete.`
  );

  return lines.join("\n");
}

async function handleImportBackup(
  client: WordPressClient,
  args: { file_url: string }
): Promise<string> {
  if (!args.file_url || !args.file_url.startsWith("http")) {
    throw new Error("file_url must be a valid HTTP/HTTPS URL pointing to a .wpress file.");
  }

  const result = await client.importBackup(args.file_url);

  const lines = [
    `Import started successfully.`,
    `Job ID: ${result.job_id}`,
    `Status: ${result.status}`,
  ];

  if (result.message) {
    lines.push(`Message: ${result.message}`);
  }

  lines.push(
    `\nWARNING: Importing a backup will overwrite your current site content.`,
    `Use get_backup_status with job_id "${result.job_id}" to monitor progress.`
  );

  return lines.join("\n");
}

async function handleGetBackupStatus(
  client: WordPressClient,
  args: { job_id: string }
): Promise<string> {
  const status = await client.getJobStatus(args.job_id);

  const lines = [
    `Job ID: ${status.job_id}`,
    `Status: ${status.status}`,
  ];

  if (status.progress !== undefined) {
    lines.push(`Progress: ${status.progress}%`);
  }
  if (status.archive) {
    lines.push(`Backup file: ${status.archive}`);
  }
  if (status.download_url) {
    lines.push(`Download URL: ${status.download_url}`);
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Server setup
// ---------------------------------------------------------------------------
async function main() {
  const config = getConfig();
  const client = new WordPressClient(
    config.siteUrl,
    config.username,
    config.appPassword,
    config.secretKey
  );

  const server = new Server(
    {
      name: "all-in-one-wp-migration-mcp-connector",
      version: "1.0.0",
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS,
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
      let result: string;

      switch (name) {
        case "list_backups":
          result = await handleListBackups(client);
          break;

        case "export_backup":
          result = await handleExportBackup(
            client,
            (args ?? {}) as { exclude_spam?: boolean; exclude_media?: boolean }
          );
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

      return {
        content: [{ type: "text", text: result }],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: "text", text: `Error: ${message}` }],
        isError: true,
      };
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Server is running — logs go to stderr to avoid polluting the MCP stdio channel
  process.stderr.write("All-in-One WP Migration MCP Connector running\n");
}

main().catch((err) => {
  process.stderr.write(`Fatal: ${err instanceof Error ? err.message : err}\n`);
  process.exit(1);
});
