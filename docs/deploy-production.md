# 生产环境发布手册（单台 VPS + 已有 Nginx + systemd）

面向一台自建服务器：Nginx 已装好，Node 进程由 systemd 托管，数据是本地 SQLite 文件。
全文用以下占位符，按实际替换：

| 占位符 | 示例 | 说明 |
|---|---|---|
| `vote.example.com` | 你的域名 | 必须能解析到这台服务器 |
| `/srv/vote-project` | 代码目录 | git checkout 的位置 |
| `/var/lib/vote-project` | 数据目录 | SQLite 文件与备份，**不放在代码目录里** |
| `/etc/vote-project` | 配置目录 | systemd 读取的环境变量文件 |
| `vote` | 运行用户 | 不是 root |

> 其他发行版（Debian、Rocky 等）命令略有差异，逻辑相同。

## 0. 这套部署的硬性前提

- **单实例**：SQLite 是单文件数据库，只能有一个 API 进程写它。不要起多个副本、不要做负载均衡。
- **同域部署**：Web 通过相对路径 `/api/...` 调后端（`apps/web/src/api.ts`），所以 Nginx 必须把 `/api` 反代到同一个域名下。
- **必须 HTTPS**：登录态是 `localStorage` 里的 JWT，明文 HTTP 等于把 token 交给中间人。
- **`prisma/migrations` 不完整**：schema 用 `prisma db push` 同步，不是 `migrate deploy`。这意味着**变更前必须备份数据库**（见第 6 节）。
- **`IDENTITY_PROVIDER` 在 production 不设置会直接启动失败**；`mock` 只用于本地，生产要接真实的 `http` 核验服务。

## 1. 代理与跨域（代码已内置，确认即可）

### 1.1 trust proxy 已开启

`apps/api/src/app.ts` 里有 `app.set("trust proxy", 1)`：注册 / 重新核验限流按 `req.ip` 计数，不信任代理头的话所有用户会被识别成 `127.0.0.1`，全站共用一个限额——注册 5 次后，第 6 个人起一小时都注册不了。

代价是 Nginx 必须如实传 `X-Forwarded-For`（第 2.7 节的配置已经带了）。如果哪天把 API 直接暴露到公网、前面没有代理，必须去掉这一行，否则客户端可以伪造 IP 绕过限流。

### 1.2 CORS 默认关闭

同域部署不需要 CORS 头，所以默认不发；只有确实要跨域访问时才在 `api.env` 里指定：

```ini
CORS_ORIGIN=https://vote.example.com
```

多个来源用逗号分隔。不要设成 `*`。

## 2. 首次部署

### 2.1 装 Node 20 LTS

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs sqlite3 git
node -v   # 应为 v20.x
```

### 2.2 建运行用户与目录

```bash
sudo useradd --system --create-home --shell /usr/sbin/nologin vote
sudo mkdir -p /srv/vote-project /var/lib/vote-project /etc/vote-project /var/backups/vote-project
sudo chown -R vote:vote /srv/vote-project /var/lib/vote-project /var/backups/vote-project
sudo chown root:vote /etc/vote-project
sudo chmod 750 /etc/vote-project
```

### 2.3 拉代码（用部署用户）

```bash
sudo -u vote git clone https://github.com/jwm001/vote-project.git /srv/vote-project
cd /srv/vote-project
sudo -u vote git log --oneline -1   # 记下这次发布的 commit，回滚要用
```

### 2.4 写环境变量文件

先用随机密钥生成值：

```bash
openssl rand -base64 48   # JWT_SECRET
openssl rand -base64 48   # ENCRYPTION_KEY
openssl rand -base64 48   # ID_HASH_SECRET
```

创建 `/etc/vote-project/api.env`（`sudoedit` 或 `sudo nano`）：

```ini
NODE_ENV=production
PORT=3000

# 数据库放在数据目录，不要用 file:./prod.db（会落到代码目录里）
DATABASE_URL=file:/var/lib/vote-project/prod.db

JWT_SECRET=<上一步生成>
ENCRYPTION_KEY=<上一步生成>
ID_HASH_SECRET=<上一步生成>

# 生产必须接真实核验服务；mock 只用于本地
IDENTITY_PROVIDER=http
IDENTITY_API_URL=<核验服务地址>
IDENTITY_API_KEY=<核验服务密钥>

# 同域部署不需要；确实要跨域时再打开，多个来源用逗号分隔
# CORS_ORIGIN=https://vote.example.com
```

```bash
sudo chown root:vote /etc/vote-project/api.env
sudo chmod 640 /etc/vote-project/api.env
```

要点：

- 不要给值加引号，systemd 的 `EnvironmentFile` 按原样传递。
- **`ID_HASH_SECRET` 一旦有真实用户就不能再换**，否则一人一号去重失效；`ENCRYPTION_KEY` 换了则历史姓名无法解密。这两个值要和数据库一起备份。
- Prisma CLI 也会读 `apps/api/.env`。让命令行和 systemd 用同一份配置：

```bash
sudo -u vote ln -s /etc/vote-project/api.env /srv/vote-project/apps/api/.env
```

（`.env` 已在 `.gitignore` 里，不会污染 git。）

### 2.5 安装依赖、生成 Client、建表、构建

```bash
cd /srv/vote-project
sudo -u vote npm ci
cd apps/api && sudo -u vote npx prisma generate
sudo -u vote npx prisma db push        # 首次会建表；已有数据的库见第 6 节
cd /srv/vote-project
sudo -u vote npm run build             # 产出 apps/api/dist 与 apps/web/dist
```

说明：

- 首次 `db push` 面对空库不会提示；对已有数据的库它可能提示「会丢数据」，**看到提示先停下备份**，不要随手确认。
- 保留 devDependencies 是有意的：`prisma` CLI 和 `tsc` 都靠它。磁盘不紧张就别 `npm prune --omit=dev`。
- 构建产物 `apps/web/dist` 就是 Nginx 的站点根目录，发布时由 `npm run build` 就地更新。

### 2.6 systemd 服务

创建 `/etc/systemd/system/vote-api.service`：

```ini
[Unit]
Description=vote-project API
After=network.target

[Service]
Type=simple
User=vote
Group=vote
WorkingDirectory=/srv/vote-project/apps/api
EnvironmentFile=/etc/vote-project/api.env
ExecStart=/usr/bin/node dist/index.js
Restart=always
RestartSec=3

# 只允许写数据目录，其余文件系统只读
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/lib/vote-project

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now vote-api
sudo systemctl status vote-api --no-pager
curl -fsS http://127.0.0.1:3000/health   # {"status":"ok"}
```

API 只监听 3000，外部通过 Nginx 访问；防火墙不要放行 3000。

### 2.7 Nginx（已有 Nginx，只加 server 块）

新建 `/etc/nginx/sites-available/vote-project`：

```nginx
server {
    listen 80;
    listen [::]:80;
    server_name vote.example.com;

    root /srv/vote-project/apps/web/dist;
    index index.html;

    client_max_body_size 2m;

    # API：保留原始路径，注意 proxy_pass 末尾没有 / 和路径
    location /api/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 120s;
    }

    location = /health {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        access_log off;
    }

    # 带 hash 的静态资源可以长缓存
    location /assets/ {
        expires 30d;
        add_header Cache-Control "public, immutable";
        try_files $uri =404;
    }

    # SPA 路由回退
    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/vote-project /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

### 2.8 HTTPS

如果用 certbot 且它已接管 Nginx：

```bash
sudo certbot --nginx -d vote.example.com
sudo systemctl reload nginx
curl -I https://vote.example.com/health
```

已有证书的话，手动在 server 块加 `listen 443 ssl;`、`ssl_certificate` / `ssl_certificate_key`，并加一个 80 → 443 的 301 跳转。

### 2.9 防火墙

```bash
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw enable
sudo ufw status
```

确认 3000 没有对外暴露。

## 3. 首次上线验收清单

- [ ] `curl -fsS https://vote.example.com/health` 返回 `{"status":"ok"}`
- [ ] 打开首页不报错，刷新任意子路由（如 `/login`）不 404
- [ ] 用真实身份注册一次：核验通过后状态为 `APPROVED`；过期/伪造身份证应被拒
- [ ] 登录 → 创建一场公开投票 → 用另一个账号投票 → 下载 PDF，确认**中文标题和选项正常显示**（不是 `?`）
- [ ] 投票结束后再导一次 PDF，确认标注「已封存」，再次导出一致
- [ ] `sudo journalctl -u vote-api -n 50 --no-pager` 没有报错
- [ ] `ls -l /var/lib/vote-project/` 能看到 `prod.db`，属主是 `vote`

## 4. 日常发布流程（每次改代码）

```bash
# 1) 备份数据库（务必先做）
sudo -u vote sqlite3 /var/lib/vote-project/prod.db \
  ".backup '/var/backups/vote-project/pre-deploy-$(date +%F-%H%M).db'"

# 2) 拉取目标版本
cd /srv/vote-project
sudo -u vote git fetch --all --tags
sudo -u vote git checkout <tag 或 commit>
sudo -u vote git log --oneline -1

# 3) 安装依赖（package-lock 变了才需要 npm ci，但每次都跑最稳）
sudo -u vote npm ci

# 4) 生成 Prisma Client（install scripts 被拦时也必须手动跑）
cd apps/api && sudo -u vote npx prisma generate

# 5) 同步 schema —— 有提示会丢数据时先停手，回到第 1 步
sudo -u vote npx prisma db push

# 6) 构建 API 与 Web
cd /srv/vote-project && sudo -u vote npm run build

# 7) 重启并验证
sudo systemctl restart vote-api
sleep 1
curl -fsS http://127.0.0.1:3000/health
curl -fsS https://vote.example.com/health
sudo journalctl -u vote-api -n 30 --no-pager
```

不需要 reload Nginx（静态文件是就地更新的，`index.html` 不缓存）。

发布前在本地跑一遍：

```bash
npm test
npm run typecheck
npm run build
```

## 5. 回滚

**只有代码出问题时**（数据库结构没变）：

```bash
cd /srv/vote-project
sudo -u vote git checkout <上一个可用 commit>
sudo -u vote npm ci
cd apps/api && sudo -u vote npx prisma generate
cd /srv/vote-project && sudo -u vote npm run build
sudo systemctl restart vote-api
```

**数据库结构也变了、或者数据被写坏时**：

```bash
sudo systemctl stop vote-api
# 先用最近一次备份覆盖（同时清掉 -wal / -shm，避免新旧文件混用）
sudo -u vote cp /var/backups/vote-project/pre-deploy-YYYY-MM-DD-HHMM.db /var/lib/vote-project/prod.db
sudo rm -f /var/lib/vote-project/prod.db-wal /var/lib/vote-project/prod.db-shm
sudo systemctl start vote-api
curl -fsS http://127.0.0.1:3000/health
```

注意：回滚数据库 = 丢掉备份之后产生的投票和注册，先确认影响范围再动手。

## 6. 备份（强烈建议当天就配好）

`sqlite3 .backup` 是最稳妥的在线备份方式（直接 `cp` 正在写的库可能拿到半截文件）。

`/usr/local/bin/backup-vote-db.sh`：

```bash
#!/usr/bin/env bash
set -euo pipefail
umask 077
DEST=/var/backups/vote-project
mkdir -p "$DEST"
sqlite3 /var/lib/vote-project/prod.db ".backup '$DEST/prod-$(date +%F-%H%M).db'"
find "$DEST" -name 'prod-*.db' -mtime +14 -delete
# 环境变量文件也要一起留档，否则数据库无法解密 / 无法去重
cp /etc/vote-project/api.env "$DEST/api.env.$(date +%F)"
find "$DEST" -name 'api.env.*' -mtime +30 -delete
```

```bash
sudo chmod +x /usr/local/bin/backup-vote-db.sh
sudo -u vote /usr/local/bin/backup-vote-db.sh   # 先手动验证一次
# 每天 03:15 跑一次
echo "15 3 * * * vote /usr/local/bin/backup-vote-db.sh" | sudo tee /etc/cron.d/vote-backup
```

- 备份目录不要只留在同一台机器上，定期同步到对象存储或另一台机器。
- `api.env` 属于敏感信息，备份文件的权限保持 `600`，不要进 git。
- 恢复演练至少做过一次，否则等于没有备份。

## 7. 运维小抄

| 事项 | 命令 |
|---|---|
| 看服务状态 | `sudo systemctl status vote-api` |
| 实时日志 | `sudo journalctl -u vote-api -f` |
| 重启 API | `sudo systemctl restart vote-api` |
| 健康检查 | `curl -fsS http://127.0.0.1:3000/health` |
| 看数据库大小 | `ls -lh /var/lib/vote-project/` |
| 手动备份 | `sudo -u vote /usr/local/bin/backup-vote-db.sh` |
| Nginx 配置校验 | `sudo nginx -t` |

## 8. 常见故障

| 现象 | 排查 |
|---|---|
| 服务起不来，日志写 `IDENTITY_PROVIDER must be configured` | `/etc/vote-project/api.env` 没写 `IDENTITY_PROVIDER`，或 `NODE_ENV` 不是 production 却用了 mock |
| 502 Bad Gateway | `vote-api` 没在跑，或 `curl 127.0.0.1:3000/health` 不通 |
| 刷新子路由 404 | Nginx 少了 SPA 回退 `try_files $uri /index.html` |
| 登录后接口全 401 | `/api` 没反代到 3000，或前端不是同域访问 |
| 注册第 6 个人开始全部 429 | 确认 Nginx 传了 `X-Forwarded-For`；`app.set("trust proxy", 1)` 已内置，缺的是代理头 |
| PDF 中文变成 `?` | 用了旧版本代码，或 `apps/api/assets/fonts/` 的字体文件没部署 |
| `db push` 提示会丢数据 | 立即停下，先备份再决定，必要时先在测试库演练 |
| 下载 PDF 报 403 | 访问控制规则（见 README「全量记录 PDF」），不是部署问题 |

## 9. 不可逆的坑

- `ID_HASH_SECRET` 换掉 → 历史用户的身份证摘要对不上，一人一号失效。
- `ENCRYPTION_KEY` 换掉 → 历史姓名无法解密。
- `DATABASE_URL` 写成相对路径（`file:./prod.db`）→ 数据库落在代码目录，`git clean` 或换目录部署时会「丢库」。
- 对生产库直接 `prisma db push` 删列 → 数据不可恢复，只能靠备份。
- 用 `mock` 核验上生产 → 任何人都能拿白名单身份证号注册。
