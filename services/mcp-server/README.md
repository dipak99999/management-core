# @lumaara/mcp-server

Model Context Protocol server that exposes every Lumaara operation as an
LLM-callable tool. Ships **118 tools** across CRM, Accounting, HR, Stock,
Projects, and Reports.

## Two transports

### 1. Claude Desktop / editor integrations — `stdio`

Add to your Claude Desktop config (`~/Library/Application Support/Claude/claude_desktop_config.json` on Mac):

```json
{
  "mcpServers": {
    "lumaara": {
      "command": "pnpm",
      "args": ["--filter", "@lumaara/mcp-server", "dev:stdio"],
      "cwd": "/Users/datacaffe.ai/ERP-OpenNext/opennext-erp",
      "env": {
        "LUMAARA_AUTH_URL": "http://localhost:4101",
        "LUMAARA_ACCOUNTING_URL": "http://localhost:4102",
        "LUMAARA_STOCK_URL": "http://localhost:4103",
        "LUMAARA_CRM_URL": "http://localhost:4104",
        "LUMAARA_HR_URL": "http://localhost:4105",
        "LUMAARA_PROJECTS_URL": "http://localhost:4106",
        "LUMAARA_JWT": "<optional-preloaded-jwt-here>"
      }
    }
  }
}
```

If `LUMAARA_JWT` is set, tools work immediately. Otherwise the assistant
must call the `login` tool first with tenant + email + password.

### 2. Remote chatbots / your ERP UI — `HTTP + SSE`

Started automatically by `bash scripts/start-all-services.sh` (port 4110).

Connect:

```
GET  http://localhost:4110/sse
     Authorization: Bearer <jwt>          # optional preauth
```

The server sends an `endpoint` event with a `/message?sessionId=…` URL.
POST JSON-RPC messages there. Standard MCP.

## Auth model

- Every session (stdio process or SSE connection) has its own `LumaaraClient`
  with its own JWT — no cross-user leakage.
- `login` tool → obtains a JWT via `/auth/login` and caches it on the client.
- `whoami` tool → reflects the claims of the current JWT.
- Every other tool refuses to run until a JWT is set.

## What's in the toolbox

- **CRM**: leads · opportunities · quotations · sales orders · campaigns
  · convert lead→customer · submit quote → convert to SO → invoice
- **Accounting**: customers · suppliers · items · sales invoices ·
  purchase invoices · purchase orders · payments · journal entries ·
  submit/cancel sales invoice
- **HR**: employees · salary slips · leave apps · attendance · expense
  claims · job openings/applicants · holiday lists · approve/reject leave
  · submit salary slip
- **Stock**: warehouses · stock entries · delivery notes · work orders
  · material requests
- **Projects**: projects · tasks · timesheets
- **Todos**: create/list/complete personal reminders
- **Reports**: trial balance · P&L · balance sheet · cash flow · sales
  analytics

Every write tool is described with **"WRITE — confirm with user before
firing"** in its `description`, and destructive ops (delete, cancel) with
**"DESTRUCTIVE"**, so a well-prompted LLM will ask first.

## Smoke test

```bash
# Assumes services + mcp-server are up.
node /tmp/mcp-smoke.js
```

Expected: 118 tools, `whoami` succeeds, `list_customers` returns rows.
