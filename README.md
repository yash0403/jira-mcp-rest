# jira-mcp

Local MCP server for fetching full Jira issue details (including long descriptions) in Copilot Chat.

## What this solves

Atlassian search tools often return truncated snippets. This MCP server calls Jira REST API directly and returns fuller issue content.

## Tools exposed

1. `get_jira_issue`
- Input: `issue_key` (example: `FM-1058`)
- Output: Full formatted issue details (summary, status, description, subtasks, linked issues)

2. `get_jira_subtasks`
- Input: `parent_key` (example: `FM-1058`)
- Output: Parent issue + all subtasks in one response

## Requirements

- Node.js 18+ (Node 22 recommended)
- Jira API token
- Jira account email
- Jira site URL

## Local setup

1. Install dependencies

```bash
cd C:/tools/jira-mcp
npm install
```

2. Configure global MCP server in VS Code user `mcp.json`

### Windows path

`C:/Users/<you>/AppData/Roaming/Code/User/mcp.json`

### macOS path

`/Users/<you>/Library/Application Support/Code/User/mcp.json`

Add this server entry under `servers`:

```json
"jira-mcp": {
  "type": "stdio",
  "command": "node",
  "args": ["C:/tools/jira-mcp/server.js"],
  "env": {
    "JIRA_BASE_URL": "${input:jiraBaseUrl}",
    "JIRA_EMAIL": "${input:jiraEmail}",
    "JIRA_API_TOKEN": "${input:jiraApiToken}"
  }
}
```

Add these under `inputs`:

```json
{
  "id": "jiraBaseUrl",
  "type": "promptString",
  "description": "Jira base URL",
  "default": "https://<org_id>.atlassian.net"
},
{
  "id": "jiraEmail",
  "type": "promptString",
  "description": "Jira account email"
},
{
  "id": "jiraApiToken",
  "type": "promptString",
  "description": "Jira API token",
  "password": true
}
```

3. Reload VS Code.

## Team sharing (Windows + macOS)

- Put this folder in a shared internal repo (recommended)
- Each developer clones to any local path
- Each developer updates `args` in their own `mcp.json` to match their local path:
  - Windows example: `C:/tools/jira-mcp/server.js`
  - macOS example: `/Users/<you>/tools/jira-mcp/server.js`

## Usage examples in Copilot Chat

- `Get FM-1058`
- `Get FM-1058 and its subtasks`
- `Fetch FM-1075 full details`

## Troubleshooting

1. Error: `JIRA_BASE_URL, JIRA_EMAIL, and JIRA_API_TOKEN must be set`
- Your MCP inputs are missing or not configured correctly.

2. 401/403 from Jira
- Token is invalid or missing permissions.

3. Tool not visible in chat
- Reload VS Code after editing `mcp.json`.

4. Mac path issues
- Ensure path in `args` is absolute and uses `/` separators.

## Security notes

- Never commit API tokens in source code.
- Keep token entry in MCP `inputs` with `password: true`.
- Rotate tokens if shared accidentally.
