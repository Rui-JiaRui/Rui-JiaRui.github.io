# Supabase 云端同步部署

GitHub Pages 仍然只托管静态文件；Supabase 负责认证、答卷和个人批注。

## 1. 创建数据表和账号

在 Supabase SQL Editor 执行 [`supabase/schema.sql`](../supabase/schema.sql)。然后把 `data/registry.json` 中的账号导入 `law_users`。可以直接生成幂等 SQL：

```bash
node scripts/generate-supabase-users.js > /tmp/law-users.sql
```

Windows PowerShell 可使用：

```powershell
node scripts/generate-supabase-users.js > supabase-users.sql
```

在 Supabase SQL Editor 执行生成的文件，或手工执行：

```sql
insert into public.law_users (username, password_hash, paper_ids, enabled)
values ('liurui', 'sha-256:...', array['20260801'], true);
```

密码哈希仍沿用 `registry.json` 的 SHA-256 值，数据库不保存明文密码。

当前仓库同时预置了隐藏的测试账号：`test` / `test`。主页不会显示该账号；执行上面的迁移 SQL 后即可在云端登录测试。该账号默认只授权 `20260801` 试卷，避免误操作其他题库。若你希望更换测试密码，请修改 `data/registry.json` 后重新生成 SQL。

如果项目之前已经创建过 `law_attempts` 表，仍需重新执行一次最新的 `schema.sql`，其中的 `alter table ... add column if not exists annotations` 会补齐批注字段，不会删除已有答卷。

## 2. 部署 Edge Function

```bash
supabase functions deploy law-api
supabase secrets set LAW_JWT_SECRET="生成一个随机长字符串"
```

请在**更新 `law-api` 代码后重新部署**；只把前端文件推送到 GitHub Pages 不会更新 Supabase 函数。

部署后得到：

```text
https://<project-ref>.supabase.co/functions/v1/law-api
```

## 3. 配置前端

在 [`index.html`](../index.html) 的启动脚本中填写：

```js
window.__LAW_SUPABASE__ = {
  functionsUrl: 'https://<project-ref>.supabase.co/functions/v1/law-api',
  anonKey: '<supabase-anon-key>'
};
```

`anonKey` 可以公开放在 GitHub Pages；真正的数据权限由 Edge Function 的 JWT 和服务端校验保证。不要把 service role key 放入前端。

如果浏览器提示“账号或密码不正确”，先检查浏览器 Network 中登录请求的 HTTP 状态：

- `401`：账号未导入、账号被停用，或密码哈希不一致。重新执行 `generate-supabase-users.js` 生成的 SQL。
- `500` 且响应为 `login-query-failed`：`law_users` 表/列尚未创建，或 Edge Function 使用的数据库配置不完整。先执行最新 `schema.sql`，再重新部署函数。
- 请求根本无法发出或出现 CORS/网关错误：确认 `index.html` 中的 `functionsUrl` 与 Supabase project ref 一致；如果网关要求 API key，在同一配置对象中填写 `anonKey`。部署函数后必须刷新 GitHub Pages 缓存。

云端模式收到 HTTP 错误时不会静默改用本地登录，避免用户误以为答卷已经上传。只有网络完全不可达时才会允许本地回退；恢复网络后会重试同步。

## 云端行为

- 登录成功后，进行中的答卷和历史记录从云端加载。
- 答案、标记和当前题号自动同步；网络中断时暂存 IndexedDB，恢复后重试。
- 交卷接口可重复调用而不会生成重复记录；交卷后答案锁定。
- 个人批注始终允许修改，且只对当前考生可见。
- 未配置 `functionsUrl` 时自动回退到原有本地模式。
