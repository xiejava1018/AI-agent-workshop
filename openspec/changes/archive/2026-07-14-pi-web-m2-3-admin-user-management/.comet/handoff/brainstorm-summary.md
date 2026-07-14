# Brainstorm Summary

- Change: pi-web-m2-3-admin-user-management
- Date: 2026-07-13

## 确认的技术方案

- 仅 root/OWNER/ADMIN 可创建用户；普通用户自动注册关闭
- 本地密码 provider 实现 `PasswordAuthProvider` 接口；`OAuthProvider` 仅留接口占位
- access token 15min + refresh token 7d，均用 HttpOnly cookie
- refresh token 黑名单**持久化到 SQLite**（新增 `RefreshTokenBlacklist` 表），轮换/登出时撤销旧 token
- per-user session cap 默认 5，全局 50 兜底，均用内存 Map（AgentSession 无 close hook 限制）
- admin 创建用户返回一次性明文初始密码；新用户 `mustChangePassword=true`
- dashboard 给 admin 最小创建用户表单；登录页支持 refresh token 静默续期

## 关键取舍与风险

- refresh token 黑名单落地 DB：更安全，但需新增 schema/migration；M3 迁移 Postgres 时此表一并迁移
- per-user cap 仍内存计数：fork 的 `SessionManager` 没有 close 回调，M3 前无法可靠递减；定位为进程内隔离
- 关闭自动注册后，root bootstrap 必须成功，否则系统无法使用；admin 创建用户 API 提供后续入口

## 测试策略

- Vitest 单元测试：`lib/session-cap.ts` per-user 逻辑；`lib/token-blacklist.ts` 撤销/过期检查
- Playwright E2E：root 创建用户 → 新用户登录 → 强制改密 → 创建 5 个 session → 第 6 个 503；refresh token 轮换测试
- 手动 smoke：admin dashboard 创建用户、登出后 refresh token 失效

## Spec Patch

- `design.md`：刷新 token 黑名单决策从内存 Map 改为 SQLite 表
- `specs/refresh-token/spec.md`：补充黑名单持久化要求与场景
- `tasks.md`：新增 `RefreshTokenBlacklist` schema 与迁移任务
- 如有需要，补充 `auth-provider-user` spec 的 sign token 接口说明
