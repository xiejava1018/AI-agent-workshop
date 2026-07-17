/**
 * app/api/v1/menus/user-menu/route.ts
 *
 * M4 RBAC 平台中台 — 当前用户可见菜单树(核心递归过滤)。
 *
 * GET /api/v1/menus/user-menu
 *   - 已登录即可(由前端 store 路由守卫调用)。
 *   - 输入:全表 enabled=true 的 SysMenu + 当前用户权限码集。
 *   - 输出:按 `set(SysMenu.meta.permissions) ∩ set(user.permissions)` 递归过滤后的菜单树。
 *
 * 过滤算法(参考 TF-TrailVerDev/backend/app/routers/system/menu.py:88-118 _filter_tree):
 *   - 节点 children 非空:
 *       - directory 类型(无 component):只看子菜单级联;若所有子菜单都被剥 → 整段隐藏
 *       - menu 类型:自身需 hasAccess(权限码交集非空),且子菜单过滤后保留(可空)
 *   - 叶子节点:hasAccess → 保留,否则剥
 *
 *   hasAccess(node):
 *     meta.permissions 为空 → true (公共菜单)
 *     meta.permissions 非空 → set(meta.permissions) ∩ user.permissions ≠ ∅
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUserPermissions } from "@/lib/permissions";

export const dynamic = "force-dynamic";

interface MenuNode {
  id: string;
  parentId: string | null;
  name: string;
  title: string;
  path: string;
  component: string;
  icon: string;
  type: string;
  authMark: string;
  sort: number;
  visible: boolean;
  enabled: boolean;
  meta: { permissions?: string[] } & Record<string, unknown>;
  children: MenuNode[];
}

function unauthorizedResponse(): NextResponse {
  return NextResponse.json({ error: "auth required" }, { status: 401 });
}

function rowToNode(row: {
  id: string;
  parentId: string | null;
  name: string;
  title: string;
  path: string;
  component: string;
  icon: string;
  type: string;
  authMark: string;
  sort: number;
  visible: boolean;
  enabled: boolean;
  meta: string;
}): MenuNode {
  let parsedMeta: MenuNode["meta"] = {};
  try {
    parsedMeta = row.meta ? JSON.parse(row.meta) : {};
  } catch {
    parsedMeta = {};
  }
  return {
    id: row.id,
    parentId: row.parentId,
    name: row.name,
    title: row.title,
    path: row.path,
    component: row.component,
    icon: row.icon,
    type: row.type,
    authMark: row.authMark,
    sort: row.sort,
    visible: row.visible,
    enabled: row.enabled,
    meta: parsedMeta,
    children: [],
  };
}

function buildTree(rows: MenuNode[]): MenuNode[] {
  const byId = new Map<string, MenuNode>();
  for (const r of rows) byId.set(r.id, { ...r, children: [] });
  const roots: MenuNode[] = [];
  for (const r of byId.values()) {
    if (r.parentId && byId.has(r.parentId)) {
      byId.get(r.parentId)!.children.push(r);
    } else {
      roots.push(r);
    }
  }
  const sortRec = (nodes: MenuNode[]) => {
    nodes.sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name));
    for (const n of nodes) sortRec(n.children);
  };
  sortRec(roots);
  return roots;
}

function filterTree(
  items: MenuNode[],
  userPerms: Set<string>
): MenuNode[] {
  const kept: MenuNode[] = [];
  for (const item of items) {
    const filteredChildren =
      item.children.length > 0 ? filterTree(item.children, userPerms) : [];

    // 目录菜单(type=directory 且无 component):自身不看权限,只看子菜单级联
    const isDir = item.type === "directory" || !item.component;
    if (isDir) {
      if (filteredChildren.length > 0) {
        kept.push({ ...item, children: filteredChildren });
      }
      continue;
    }

    // 普通菜单:自身需权限码交集非空,子菜单过滤后保留
    const required = Array.isArray(item.meta?.permissions)
      ? (item.meta!.permissions as string[])
      : [];
    const hasAccess =
      required.length === 0 ||
      required.some((c) => userPerms.has(c));

    if (hasAccess) {
      kept.push({ ...item, children: filteredChildren });
    }
  }
  return kept;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const userId = req.headers.get("x-user-id");
  if (!userId) return unauthorizedResponse();

  const [rows, userPerms] = await Promise.all([
    prisma.sysMenu.findMany({
      where: { enabled: true },
      orderBy: [{ sort: "asc" }, { name: "asc" }],
    }),
    getUserPermissions(userId),
  ]);

  const nodes = rows.map(rowToNode);
  const tree = buildTree(nodes);
  const filtered = filterTree(tree, new Set(userPerms));

  return NextResponse.json({
    code: 200,
    message: "success",
    data: filtered,
  });
}