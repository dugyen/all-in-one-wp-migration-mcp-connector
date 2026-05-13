import fetch, { type RequestInit, type Response } from "node-fetch";

export interface BackupFile {
  id?: string;
  name: string;
  size: number;
  size_human?: string;
  created_at: string;
  type?: string;
  label?: string;
  downloadable?: boolean;
  download_url?: string;
}

export interface ExportResult {
  job_id: string;
  status: "pending" | "running" | "complete" | "failed";
  archive?: string;
  download_url?: string;
  message?: string;
  secret_key?: string;
}

export interface ImportResult {
  job_id: string;
  status: "awaiting_upload" | "running" | "complete" | "failed";
  message?: string;
}

export interface JobStatus {
  job_id: string;
  type?: "export" | "import";
  status: "awaiting_upload" | "running" | "complete" | "failed" | "confirm" | "error";
  percent?: number;
  message?: string;
  archive?: string;
  download_url?: string;
}

export interface SiteCapabilities {
  export: boolean;
  import: boolean;
  max_upload_size: number;
  max_upload_size_human: string;
  wordpress_version: string;
  php_version: string;
  plugin_version: string;
  site_url: string;
  available_space: number;
  available_space_human: string;
}

export class WordPressClient {
  private readonly baseUrl: string;
  private readonly authHeader: string;

  constructor(siteUrl: string, username: string, appPassword: string) {
    this.baseUrl = siteUrl.replace(/\/$/, "");
    const credentials = Buffer.from(`${username}:${appPassword.replace(/\s/g, "")}`).toString("base64");
    this.authHeader = `Basic ${credentials}`;
  }

  private buildHeaders(extra: Record<string, string> = {}): Record<string, string> {
    return { Authorization: this.authHeader, ...extra };
  }

  private async request<T>(path: string, options: RequestInit = {}, allowedFailStatus?: number): Promise<T> {
    const url = `${this.baseUrl}/wp-json/ai1wm/v1${path}`;
    const isJson = !options.headers || !(options.headers as Record<string, string>)["Content-Type"]?.includes("octet");
    const headers = this.buildHeaders(
      isJson && options.body ? { "Content-Type": "application/json" } : {}
    );

    const response: Response = await fetch(url, {
      ...options,
      headers: { ...headers, ...(options.headers as Record<string, string> | undefined ?? {}) },
    });

    // 404 on the last chunk of an upload is expected — server closes endpoint after assembly
    if (response.status === 404 && allowedFailStatus === 404) {
      return {} as T;
    }

    if (!response.ok) {
      let errorMessage = `HTTP ${response.status}: ${response.statusText}`;
      try {
        const body = await response.json() as { message?: string; code?: string };
        errorMessage = body.message ?? errorMessage;
      } catch {
        // use default message
      }
      throw new Error(errorMessage);
    }

    return response.json() as Promise<T>;
  }

  async getCapabilities(): Promise<SiteCapabilities> {
    return this.request<SiteCapabilities>("/capabilities");
  }

  async listBackups(): Promise<BackupFile[]> {
    const result = await this.request<{ backups: BackupFile[] } | BackupFile[]>("/backups");
    // Handle both array and {backups:[]} response shapes
    return Array.isArray(result) ? result : (result as { backups: BackupFile[] }).backups ?? [];
  }

  async exportBackup(options: {
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
  } = {}): Promise<ExportResult> {
    // Strip undefined values so only explicitly set options are sent
    const filtered = Object.fromEntries(
      Object.entries(options).filter(([, v]) => v !== undefined)
    );
    const body = Object.keys(filtered).length ? { options: filtered } : {};
    return this.request<ExportResult>("/exports", {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  async pollExportStatus(jobId: string): Promise<JobStatus> {
    return this.request<JobStatus>(`/exports/${jobId}`);
  }

  /**
   * Start an import job and upload the file in chunks via raw binary POST.
   * The correct endpoint is /imports/{job_id} (not /file).
   * The last chunk returns 404 — this is expected (server closes endpoint after assembly).
   */
  async startImport(): Promise<ImportResult> {
    return this.request<ImportResult>("/imports", { method: "POST", body: JSON.stringify({}) });
  }

  async uploadChunk(
    jobId: string,
    chunk: Buffer,
    offset: number,
    totalSize: number
  ): Promise<JobStatus> {
    const end = offset + chunk.length - 1;
    return this.request<JobStatus>(
      `/imports/${jobId}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/octet-stream",
          "Content-Range": `bytes ${offset}-${end}/${totalSize}`,
        },
        body: chunk,
      },
      // 404 on the final chunk is expected — server seals the upload
      end === totalSize - 1 ? 404 : undefined
    );
  }

  async pollImportStatus(jobId: string): Promise<JobStatus> {
    return this.request<JobStatus>(`/imports/${jobId}`);
  }

  async confirmImport(jobId: string): Promise<JobStatus> {
    return this.request<JobStatus>(`/imports/${jobId}/confirm`, {
      method: "POST",
      body: JSON.stringify({ proceed: true }),
    });
  }

  async getJobStatus(jobId: string): Promise<JobStatus> {
    try {
      return await this.pollExportStatus(jobId);
    } catch {
      return this.pollImportStatus(jobId);
    }
  }

  formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  }
}
