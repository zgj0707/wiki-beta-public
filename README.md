# wiki-beta

A Feishu (Lark) Base–backed knowledge site: public readers consume approved content from Bitable projections; document bodies are fetched server-side through the Feishu Open API.

**wiki-beta** is a reference implementation for teams who want a small public wiki front-end with optional in-site AI chat, rankings, and mechanism observatory views—all driven by configurable Feishu resources.

## Features

- Public site (Vite + React) and management shell that links to your Feishu Base views
- Server (NestJS) reads Base tables, document links, rankings, and attachments
- Optional PostgreSQL sync module for search/chat projections
- BYO API key for visitor-facing AI chat (OpenAI-compatible gateway)

## Requirements

- Node.js 20+
- Feishu app credentials with Base and document read scopes
- A Bitable base and table IDs matching your schema (see `.env.example`)

## Quick start

```bash
cp .env.example .env
# Fill in Feishu credentials and WIKI_BETA_* table/base tokens

npm install
npm run build
npm test
```

### Development

```bash
npm run dev
```

Configure `SERVER_HOST`, `SERVER_PORT`, and Feishu variables in `.env`. No production tenant or table identifiers are bundled in this repository—all resource IDs must be supplied via environment variables.

## Project layout

| Path | Role |
|------|------|
| `client/` | Public React UI |
| `server/` | NestJS API, Feishu readers, sync, chat |
| `shared/` | Cross-cutting types and ranking/tool conventions |
| `design/` | Generic UI design notes |
| `test/` | Unit tests |

## Security

- Keep `FEISHU_APP_SECRET`, tenant tokens, and LLM API keys out of git and client bundles.
- Use `.env` locally and your platform’s secret store in deployment.

## License

See repository license file if present; otherwise treat as private/source-available per your organization.

---

## 简介（中文）

面向飞书多维表格的内容 Wiki：公开页展示已审批、可发布的 Base 行；正文通过服务端调用飞书文档接口读取。

本地开发请复制 `.env.example` 为 `.env`，填入飞书应用凭证与 Base/表 ID。本仓库**不包含**任何真实租户、表 token 或运营数据；榜单静态兜底仅为虚构示例。
