#!/usr/bin/env -S npx tsx
/**
 * Permission 种子脚本(幂等)
 *
 * 设计:openspec/changes/m4-rbac-platform/design.md §4
 * 运行:cd apps/web && pnpm tsx prisma/seed/permissions.ts
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// ====== 权限码定义(模块化,60+ 条) ======
// 设计参考 TF-TrailVerDev/backend/scripts/seed_permissions.py 模式
// code 格式 `<module>:<action>`,unique
type PermSeed = { code: string; name: string; module: string; description?: string; sort: number };

const PERMISSIONS: PermSeed[] = [
  // 用户管理
  { code: "user:view", name: "查看用户", module: "用户管理", sort: 1 },
  { code: "user:create", name: "创建用户", module: "用户管理", sort: 2 },
  { code: "user:edit", name: "编辑用户", module: "用户管理", sort: 3 },
  { code: "user:delete", name: "删除用户", module: "用户管理", sort: 4 },
  { code: "user:disable", name: "启用/停用用户", module: "用户管理", sort: 5 },
  { code: "user:reset-password", name: "重置用户密码", module: "用户管理", sort: 6 },
  { code: "user:assign-role", name: "分配全局角色", module: "用户管理", sort: 7 },

  // 角色管理
  { code: "role:view", name: "查看角色", module: "角色管理", sort: 11 },
  { code: "role:create", name: "创建角色", module: "角色管理", sort: 12 },
  { code: "role:edit", name: "编辑角色", module: "角色管理", sort: 13 },
  { code: "role:delete", name: "删除角色", module: "角色管理", sort: 14 },
  { code: "role:assign-permission", name: "分配权限码", module: "角色管理", sort: 15 },

  // 菜单管理
  { code: "menu:view", name: "查看菜单", module: "菜单管理", sort: 21 },
  { code: "menu:create", name: "创建菜单", module: "菜单管理", sort: 22 },
  { code: "menu:edit", name: "编辑菜单", module: "菜单管理", sort: 23 },
  { code: "menu:delete", name: "删除菜单", module: "菜单管理", sort: 24 },

  // 团队管理
  { code: "team:view", name: "查看团队", module: "团队管理", sort: 31 },
  { code: "team:create", name: "创建团队", module: "团队管理", sort: 32 },
  { code: "team:edit", name: "编辑团队", module: "团队管理", sort: 33 },
  { code: "team:invite", name: "生成邀请链接", module: "团队管理", sort: 34 },
  { code: "team:add-member", name: "添加团队成员", module: "团队管理", sort: 35 },
  { code: "team:remove-member", name: "移除团队成员", module: "团队管理", sort: 36 },
  { code: "team:change-role", name: "修改团队成员角色", module: "团队管理", sort: 37 },

  // 数字员工
  { code: "agent:view", name: "查看数字员工", module: "数字员工", sort: 41 },
  { code: "agent:create", name: "创建数字员工", module: "数字员工", sort: 42 },
  { code: "agent:edit", name: "编辑数字员工", module: "数字员工", sort: 43 },
  { code: "agent:delete", name: "删除数字员工", module: "数字员工", sort: 44 },
  { code: "agent:clone", name: "克隆数字员工", module: "数字员工", sort: 45 },
  { code: "agent:bind-skill", name: "绑定技能", module: "数字员工", sort: 46 },
  { code: "agent:bind-mcp", name: "绑定 MCP", module: "数字员工", sort: 47 },

  // 技能管理
  { code: "skill:view", name: "查看技能", module: "技能管理", sort: 51 },
  { code: "skill:install", name: "安装技能", module: "技能管理", sort: 52 },
  { code: "skill:create", name: "创建技能", module: "技能管理", sort: 53 },
  { code: "skill:edit", name: "编辑技能", module: "技能管理", sort: 54 },
  { code: "skill:delete", name: "删除技能", module: "技能管理", sort: 55 },
  { code: "skill:scope", name: "设置技能作用域", module: "技能管理", sort: 56 },

  // MCP 管理
  { code: "mcp:view", name: "查看 MCP", module: "MCP 管理", sort: 61 },
  { code: "mcp:create", name: "新增 MCP", module: "MCP 管理", sort: 62 },
  { code: "mcp:edit", name: "编辑 MCP", module: "MCP 管理", sort: 63 },
  { code: "mcp:delete", name: "删除 MCP", module: "MCP 管理", sort: 64 },
  { code: "mcp:bind", name: "绑定 MCP", module: "MCP 管理", sort: 65 },
  { code: "mcp:credential", name: "管理 MCP 凭证", module: "MCP 管理", sort: 66 },

  // 会话管理
  { code: "session:view", name: "查看会话", module: "会话管理", sort: 71 },
  { code: "session:create", name: "创建会话", module: "会话管理", sort: 72 },
  { code: "session:edit", name: "编辑会话", module: "会话管理", sort: 73 },
  { code: "session:delete", name: "删除会话", module: "会话管理", sort: 74 },
  { code: "session:share", name: "分享会话", module: "会话管理", sort: 75 },

  // 模型管理
  { code: "model:view", name: "查看模型", module: "模型管理", sort: 81 },
  { code: "model:create", name: "新增模型", module: "模型管理", sort: 82 },
  { code: "model:edit", name: "编辑模型", module: "模型管理", sort: 83 },
  { code: "model:delete", name: "删除模型", module: "模型管理", sort: 84 },
  { code: "model:default", name: "设置默认模型", module: "模型管理", sort: 85 },
  { code: "model:set-fallback", name: "设置故障回退顺序", module: "模型管理", sort: 86 },

  // 凭据管理
  { code: "apikey:view", name: "查看 API Key", module: "凭据管理", sort: 91 },
  { code: "apikey:edit", name: "编辑自己的 API Key", module: "凭据管理", sort: 92 },

  // 审计管理
  { code: "audit:view", name: "查看审计日志", module: "审计管理", sort: 101 },

  // 监控管理
  { code: "monitor:view", name: "查看监控大盘", module: "监控管理", sort: 111 },

  // 平台准入(把关 /api/admin/*)
  { code: "platform:access", name: "进入平台管理", module: "平台准入", sort: 200 },
];

async function main() {
  let created = 0;
  let skipped = 0;

  for (const p of PERMISSIONS) {
    const existing = await prisma.permission.findUnique({ where: { code: p.code } });
    if (existing) {
      // 幂等:已存在跳过(name/sort 不强制更新,允许外部调整)
      skipped++;
      continue;
    }
    await prisma.permission.create({
      data: {
        code: p.code,
        name: p.name,
        module: p.module,
        description: p.description ?? "",
        sort: p.sort,
      },
    });
    created++;
    // eslint-disable-next-line no-console
    console.log(`  [add] permission '${p.code}' (${p.module})`);
  }

  // eslint-disable-next-line no-console
  console.log("\n" + "=".repeat(60));
  // eslint-disable-next-line no-console
  console.log(`Permission seed done. created=${created} skipped=${skipped} total=${PERMISSIONS.length}`);
  // eslint-disable-next-line no-console
  console.log("=".repeat(60));
}

main()
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error("[FAIL]", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());