import type { Prisma } from "@prisma/client";

export const DEFAULT_AUDIT_PAGE = 1;
export const DEFAULT_AUDIT_LIMIT = 50;
export const MAX_AUDIT_LIMIT = 100;
export const MAX_AUDIT_EXPORT_ROWS = 10_000;

export interface AuditLogFilters {
  userId?: string;
  action?: string;
  resourceType?: string;
  resourceId?: string;
  from?: Date;
  to?: Date;
}

export function parsePositiveInt(raw: string | null, fallback: number): number {
  if (raw == null) return fallback;
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) && value >= 1 ? value : fallback;
}

function parseIsoDate(raw: string | null): Date | undefined {
  if (!raw?.trim()) return undefined;
  const value = new Date(raw);
  return Number.isNaN(value.getTime()) ? undefined : value;
}

export function parseAuditLogFilters(searchParams: URLSearchParams): AuditLogFilters {
  const userId = searchParams.get("userId")?.trim();
  const action = searchParams.get("action")?.trim();
  const resourceType = searchParams.get("resourceType")?.trim();
  const resourceId = searchParams.get("resourceId")?.trim();
  const from = parseIsoDate(searchParams.get("from"));
  const to = parseIsoDate(searchParams.get("to"));

  return {
    ...(userId ? { userId } : {}),
    ...(action ? { action } : {}),
    ...(resourceType ? { resourceType } : {}),
    ...(resourceId ? { resourceId } : {}),
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
  };
}

export function buildAuditLogWhere(filters: AuditLogFilters): Prisma.AuditLogWhereInput {
  const where: Prisma.AuditLogWhereInput = {};
  if (filters.userId) where.userId = filters.userId;
  if (filters.action) where.action = filters.action;
  if (filters.resourceType) where.resourceType = filters.resourceType;
  if (filters.resourceId) where.resourceId = filters.resourceId;
  if (filters.from || filters.to) {
    where.createdAt = {
      ...(filters.from ? { gte: filters.from } : {}),
      ...(filters.to ? { lte: filters.to } : {}),
    };
  }
  return where;
}
