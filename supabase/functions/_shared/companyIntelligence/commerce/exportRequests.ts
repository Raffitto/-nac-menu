export type ExportRequestStatus =
  | "requested"
  | "direct_download_received"
  | "waiting_async_delivery"
  | "authenticated_read_received"
  | "failed"
  | "expired"
  | "unmatched";

export type ExportRequestRecord = {
  id: string;
  source: "foodics";
  dataset: string;
  branchId: string;
  periodStart: string;
  periodEnd: string;
  requestedAt: string;
  sourceRequestId: string | null;
  sourceResponse: Record<string, unknown>;
  deliveryMode: "direct_download" | "async_email" | "authenticated_read" | "auto_detect" | null;
  companionDataset: string | null;
  status: ExportRequestStatus;
  retryCount: number;
};

export function detectAcquisitionMode(input: {
  downloadedBytes?: number;
  contentDisposition?: string | null;
  responseBody?: string | Record<string, unknown> | null;
  httpStatus?: number;
}): "direct_download" | "async_email" | "unknown" {
  if ((input.downloadedBytes || 0) > 32 || /attachment|filename=/i.test(String(input.contentDisposition || ""))) {
    return "direct_download";
  }
  const body = typeof input.responseBody === "string"
    ? input.responseBody
    : JSON.stringify(input.responseBody || "");
  if (/being processing|being processed|queued|email|export/i.test(body)) {
    return "async_email";
  }
  return "unknown";
}

export function createExportRequest(input: Omit<ExportRequestRecord, "status" | "retryCount" | "source"> & {
  status?: ExportRequestStatus;
  retryCount?: number;
}): ExportRequestRecord {
  return {
    ...input,
    source: "foodics",
    status: input.status || "requested",
    retryCount: input.retryCount || 0,
  };
}

export function markExportResponse(
  request: ExportRequestRecord,
  mode: ReturnType<typeof detectAcquisitionMode>,
): ExportRequestRecord {
  if (mode === "direct_download") {
    return { ...request, deliveryMode: "direct_download", status: "direct_download_received" };
  }
  if (mode === "async_email") {
    return { ...request, deliveryMode: "async_email", status: "waiting_async_delivery" };
  }
  return { ...request, status: "failed" };
}
