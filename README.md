# All-in-One WP Migration for REST API MCP

Manage WordPress backups through Claude AI using the [Model Context Protocol](https://modelcontextprotocol.io/). Works with **any WordPress site** that has the [All-in-One WP Migration](https://servmask.com/) plugin installed and activated — regardless of hosting provider.

```
Claude AI  ──►  MCP Connector  ──►  All-in-One WP Migration REST API  ──►  WordPress Site
```

---

## Prerequisites

| Requirement | Notes |
|---|---|
| Node.js ≥ 18 | For running the connector locally |
| All-in-One WP Migration plugin | Installed & activated on your WordPress site |
| WordPress Application Password | Generated in WP Admin → Users → Profile → Application Passwords |
| Claude Desktop or Claude Code | To connect the MCP server |

---

## Quick Start

### 1. Install

```bash
# Run directly with npx (recommended — no global install needed)
npx all-in-one-wp-migration-rest-api-mcp

# Or install globally
npm install -g all-in-one-wp-migration-rest-api-mcp
```

### 2. Generate a WordPress Application Password

1. Log in to your WordPress admin dashboard
2. Go to **Users → Profile**
3. Scroll to **Application Passwords**
4. Enter a name (e.g. "Claude MCP") and click **Add New Application Password**
5. Copy the generated password — you'll only see it once

### 3. Configure Claude Desktop

Add this block to your Claude Desktop config file:

- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "all-in-one-wp-migration": {
      "command": "npx",
      "args": ["-y", "all-in-one-wp-migration-rest-api-mcp"],
      "env": {
        "WP_SITE_URL": "https://your-wordpress-site.com",
        "WP_USERNAME": "your_admin_username",
        "WP_APPLICATION_PASSWORD": "xxxx xxxx xxxx xxxx xxxx xxxx"
      }
    }
  }
}
```

Restart Claude Desktop. The connector is now available.

### 4. Configure Claude Code (CLI)

```bash
claude mcp add all-in-one-wp-migration \
  --env WP_SITE_URL=https://your-wordpress-site.com \
  --env WP_USERNAME=your_admin_username \
  --env "WP_APPLICATION_PASSWORD=xxxx xxxx xxxx xxxx xxxx xxxx" \
  -- npx -y all-in-one-wp-migration-rest-api-mcp
```

---

## Available Tools

| Tool | Description |
|---|---|
| `list_backups` | List all backup files with name, size, date, and type |
| `export_backup` | Trigger a full site export; returns a job ID and download URL |
| `import_backup` | Restore a site from a `.wpress` file URL |
| `get_backup_status` | Check progress of an ongoing export or import |
| `delete_backup` | Permanently delete a backup file by filename |

---

## Example Prompts

> *"List all backups on my WordPress site."*

> *"Export a backup of my site, but skip the media files."*

> *"Export a backup of my site and encrypt it with password: mypassword"*

> *"Import the backup from last Tuesday."*

> *"Is my backup export complete yet? The job ID is abc123."*

> *"Delete backup filename.wpress from my WordPress site."*

---

## Export Options

You can exclude specific content to reduce backup size:

| Option | Description |
|---|---|
| `no_media` | Exclude media library files |
| `no_spam` | Exclude spam comments |
| `no_post_revisions` | Exclude post revisions |
| `no_cache` | Exclude cache files |
| `no_database` | Exclude the database |
| `no_plugins` | Exclude all plugins |
| `no_themes` | Exclude all themes |
| `no_inactive_plugins` | Exclude inactive plugins |
| `no_inactive_themes` | Exclude inactive themes |
| `no_security` | Exclude security options (passwords, keys, credentials) |
| `no_must_use_plugins` | Exclude must-use plugins (mu-plugins) |

---

## Running Locally (Development)

```bash
git clone https://github.com/dugyen/all-in-one-wp-migration-rest-api-mcp.git
cd all-in-one-wp-migration-rest-api-mcp

npm install

# Configure credentials
cp .env.example .env
# Edit .env with your WordPress site details

npm run dev   # run with tsx (no build step)
# or
npm run build && npm start
```

---

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `WP_SITE_URL` | Yes | Full URL of your WordPress site (no trailing slash) |
| `WP_USERNAME` | Yes | WordPress admin username |
| `WP_APPLICATION_PASSWORD` | Yes | WordPress Application Password (spaces are stripped automatically) |

---

## Architecture

```
┌─────────────────────────────────────┐
│            Claude AI                │
│  (Natural Language Interface)       │
└────────────────┬────────────────────┘
                 │ MCP Protocol (stdio)
┌────────────────▼────────────────────┐
│   All-in-One WP Migration           │
│      for REST API MCP               │
│  ┌──────────────────────────────┐   │
│  │  Tool Definitions            │   │
│  │  Authentication Handler      │   │
│  │  WordPress REST API Client   │   │
│  └──────────────────────────────┘   │
└────────────────┬────────────────────┘
                 │ HTTPS + Basic Auth
┌────────────────▼────────────────────┐
│         WordPress Site              │
│  All-in-One WP Migration Plugin     │
│  REST API: /wp-json/ai1wm/v1/       │
└─────────────────────────────────────┘
```

---

## Security Notes

- Credentials are passed as environment variables — never hard-coded
- All communication uses HTTPS + WordPress Application Passwords
- Application Passwords can be revoked at any time from the WordPress admin
- The connector never stores credentials beyond the current process lifetime

---

## Roadmap

- [ ] Export to cloud storage (Google Drive, Dropbox, Amazon S3)
- [ ] Scheduled backup management
- [ ] Multi-site support
- [ ] Restore to staging environment

---

## License

[MIT License](LICENSE)

---

## Acknowledgements

- Built on top of [All-in-One WP Migration](https://servmask.com/) by ServMask
- Powered by [Claude AI](https://claude.ai) and the [Model Context Protocol](https://modelcontextprotocol.io/)
