# Supabase 云端同步部署

GitHub Pages 仍然只托管静态文件；Supabase 负责认证、答卷和个人批注。

## 1. 创建数据表和账号

在 Supabase SQL Editor 执行 [`supabase/schema.sql`](../supabase/schema.sql)。然后把 `data/registry.json` 中的账号导入 `law_users`。可以直接生成幂等 SQL：

```bash
node scripts/generate-supabase-users.js > /tmp/law-users.sql
```

在 Supabase SQL Editor 执行生成的文件，或手工执行：

```sql
insert into public.law_users (username, password_hash, paper_ids, enabled)
values ('liurui', 'sha-256:...', array['20260801'], true);
```

密码哈希仍沿用 `registry.json` 的 SHA-256 值，数据库不保存明文密码。

## 2. 部署 Edge Function

```bash
supabase functions deploy law-api
supabase secrets set LAW_JWT_SECRET="生成一个随机长字符串"
```

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

## 云端行为

- 登录成功后，进行中的答卷和历史记录从云端加载。
- 答案、标记和当前题号自动同步；网络中断时暂存 IndexedDB，恢复后重试。
- 交卷接口可重复调用而不会生成重复记录；交卷后答案锁定。
- 个人批注始终允许修改，且只对当前考生可见。
- 未配置 `functionsUrl` 时自动回退到原有本地模式。
