import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { assertPlatformAdmin } from "@/lib/permissions";
import {
  buildAuditLogWhere,
  MAX_AUDIT_EXPORT_ROWS,
  parseAuditLogFilters,
} from "@/lib/audit-query";

export const dynamic = "force-dynamic";

const CSV_COLUMNS = [
  "id",
  "created_at",
  "user_id",
  "action",
  "resource_type",
  "resource_id",
  "metadata",
] as const;

function escapeCsv(value: string | null): string {
  const text = value ?? "";
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const admin = await assertPlatformAdmin(req);
  if (!admin) {
    return NextResponse.json(
      { error: req.headers.get("x-user-id") ? "forbidden" : "auth required" },
      { status: req.headers.get("x-user-id") ? 403 : 401 },
    );
  }

  const where = buildAuditLogWhere(parseAuditLogFilters(req.nextUrl.searchParams));
  const entries = await prisma.auditLog.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: MAX_AUDIT_EXPORT_ROWS,
  });
  const rows = entries.map((entry) =>
    [
      entry.id,
      entry.createdAt.toISOString(),
      entry.userId,
      entry.action,
      entry.resourceType,
      entry.resourceId,
      entry.metadata,
    ]
      .map(escapeCsv)
      .join(","),
  );
  const csv = `﻿${[CSV_COLUMNS.join(","), ...rows].join("\r\n")}\r\n`;
  const filename = `audit_logs_${new Date().toISOString().slice(0, 10)}.csv`;

  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
