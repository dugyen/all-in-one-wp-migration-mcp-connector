import fetch, { type RequestInit, type Response } from "node-fetch";
import FormData from "form-data";

export interface BackupFile {
  id: string;
  name: string;
  size: number;
  created_at: string;
  type: string;
  url?: string;
}

export interface ExportResult {
  job_id: string;
  status: "pending" | "running" | "completed" | "failed";
  download_url?: string;
  filename?: string;
  message?: string;
}

export interface ImportResult {
  job_id: string;
  status: "pending" | "running" | "completed" | "failed";
  message?: string;
}

export interface JobStatus {
  job_id: string;
  type: "export" | "import";
  status: "pending" | "running" | "completed" | "failed";
  progress?: number;
  message?: string;
  download_url?: string;
}

export class WordPressClient {
  private readonly baseUrl: string;
  private readonly authHeader: string;
  private readonly secretKey: string;

  constructor(siteUrl: string, username: string, appPassword: string, secretKey = "") {
    this.baseUrl = siteUrl.replace(/\/$/, "");
    const credentials = Buffer.from(`${username}:${appPassword.replace(/\s/g, "")}`).toString("base64");
    this.authHeader = `Basic ${credentials}`;
    this.secretKey = secretKey;
  }

  private buildHeaders(extra: Record<string, string> = {}): Record<string, string> {
    const headers: Record<string, string> = {
      Authorization: this.authHeader,
      ...extra,
    };
    if (this.secretKey) {
      headers["X-AI1WM-SECRET"] = this.secretKey;
    }
    return headers;
  }

  private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const url = `${this.baseUrl}/wp-json/ai1wm/v1${path}`;
    const headers = this.buildHeaders(
      options.body instanceof FormData ? {} : { "Content-Type": "application/json" }
    );

    const response: Response = await fetch(url, {
      ...options,
      headers: { ...headers, ...(options.headers as Record<string, string> | undefined ?? {}) },
    });

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

  async listBackups(): Promise<BackupFile[]> {
    return this.request<BackupFile[]>("/backups");
  }

  async exportBackup(options: { exclude_spam?: boolean; exclude_media?: boolean } = {}): Promise<ExportResult> {
    return this.request<ExportResult>("/exports", {
      method: "POST",
      body: JSON.stringify(options),
    });
  }

  async importBackup(fileUrl: string): Promise<ImportResult> {
    return this.request<ImportResult>("/imports", {
      method: "POST",
      body: JSON.stringify({ url: fileUrl }),
    });
  }

  async getExportStatus(jobId: string): Promise<JobStatus> {
    return this.request<JobStatus>(`/exports/${jobId}/status`);
  }

  async getImportStatus(jobId: string): Promise<JobStatus> {
    return this.request<JobStatus>(`/imports/${jobId}/status`);
  }

  async getJobStatus(jobId: string): Promise<JobStatus> {
    // Try export status first, fall back to import status
    try {
      return await this.getExportStatus(jobId);
    } catch {
      return this.getImportStatus(jobId);
    }
  }

  formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  }
}
