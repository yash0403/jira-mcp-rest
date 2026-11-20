#!/usr/bin/env node
/**
 * Local Jira MCP Server
 *
 * Exposes two tools to Copilot Chat:
 *   - get_jira_issue    : fetch full issue body (description, acceptance criteria, etc.)
 *   - get_jira_subtasks : fetch parent issue + all its subtasks
 *
 * Required environment variables (set in .vscode/mcp.json under "env"):
 *   JIRA_BASE_URL   e.g. https://<org_id>.atlassian.net
 *   JIRA_EMAIL      your Atlassian account email
 *   JIRA_API_TOKEN  API token from https://id.atlassian.com/manage-profile/security/api-tokens
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const BASE_URL = process.env.JIRA_BASE_URL;
const EMAIL    = process.env.JIRA_EMAIL;
const TOKEN    = process.env.JIRA_API_TOKEN;

if (!BASE_URL || !EMAIL || !TOKEN) {
  process.stderr.write(
    "ERROR: JIRA_BASE_URL, JIRA_EMAIL, and JIRA_API_TOKEN must be set.\n"
  );
  process.exit(1);
}

const authHeader = "Basic " + Buffer.from(`${EMAIL}:${TOKEN}`).toString("base64");

/**
 * Call Jira REST API v3 and return parsed JSON.
 */
async function jiraGet(path) {
  return jiraRequest(path, {
    method: "GET"
  });
}

/**
 * Call Jira REST API v3 and return parsed JSON.
 */
async function jiraRequest(path, options = {}) {
  const url = `${BASE_URL}/rest/api/3${path}`;
  const headers = {
    Authorization: authHeader,
    Accept: "application/json"
  };

  if (options.body) {
    headers["Content-Type"] = "application/json";
  }

  const res = await fetch(url, {
    method: options.method || "GET",
    headers,
    body: options.body
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Jira API error ${res.status}: ${body}`);
  }

  return res.json();
}

/**
 * Search Jira using the enhanced JQL endpoint, following pagination tokens.
 */
async function jiraSearchJql(jql, fields, maxResults = 100) {
  const issues = [];
  let nextPageToken;

  do {
    const payload = {
      jql,
      fields,
      maxResults
    };

    if (nextPageToken) {
      payload.nextPageToken = nextPageToken;
    }

    const result = await jiraRequest("/search/jql", {
      method: "POST",
      body: JSON.stringify(payload)
    });

    issues.push(...(result.issues || []));
    nextPageToken = result.nextPageToken;

    if (result.isLast) {
      break;
    }
  } while (nextPageToken);

  return issues;
}

/**
 * Convert Atlassian Document Format (ADF) node tree to plain text.
 * Handles paragraph, text, heading, bulletList, orderedList, table, codeBlock.
 */
function adfToText(node, indent = 0) {
  if (!node) return "";

  const pad = "  ".repeat(indent);

  switch (node.type) {
    case "doc":
      return (node.content || []).map((n) => adfToText(n, indent)).join("\n");

    case "paragraph":
      return pad + (node.content || []).map((n) => adfToText(n)).join("") + "\n";

    case "text":
      return node.text || "";

    case "hardBreak":
      return "\n";

    case "heading": {
      const level = node.attrs && node.attrs.level ? node.attrs.level : 1;
      const prefix = "#".repeat(level) + " ";
      return pad + prefix + (node.content || []).map((n) => adfToText(n)).join("") + "\n";
    }

    case "bulletList":
      return (node.content || []).map((n) => adfToText(n, indent)).join("");

    case "orderedList":
      return (node.content || []).map((n, i) => {
        const text = (n.content || []).map((c) => adfToText(c, 0)).join("").trim();
        return pad + `${i + 1}. ${text}\n`;
      }).join("");

    case "listItem":
      return pad + "- " + (node.content || []).map((n) => adfToText(n, 0)).join("").trim() + "\n";

    case "codeBlock": {
      const lang = node.attrs && node.attrs.language ? node.attrs.language : "";
      const code = (node.content || []).map((n) => adfToText(n)).join("");
      return `\`\`\`${lang}\n${code}\`\`\`\n`;
    }

    case "table":
      return (node.content || []).map((row) => {
        const cells = (row.content || []).map((cell) =>
          (cell.content || []).map((n) => adfToText(n, 0)).join("").trim()
        ).join(" | ");
        return pad + "| " + cells + " |";
      }).join("\n") + "\n";

    case "rule":
      return pad + "---\n";

    case "inlineCard":
      return (node.attrs && node.attrs.url) ? `[${node.attrs.url}]` : "";

    case "mention":
      return (node.attrs && node.attrs.text) ? `@${node.attrs.text}` : "";

    default:
      // Recurse into any content we don't explicitly handle
      return (node.content || []).map((n) => adfToText(n, indent)).join("");
  }
}

/**
 * Format a Jira issue object into readable text.
 */
function formatIssue(issue) {
  const f = issue.fields;
  const lines = [];

  lines.push(`# ${issue.key}: ${f.summary}`);
  lines.push(`Type: ${f.issuetype && f.issuetype.name}`);
  lines.push(`Status: ${f.status && f.status.name}`);
  lines.push(`Assignee: ${f.assignee ? f.assignee.displayName : "Unassigned"}`);
  lines.push(`Priority: ${f.priority && f.priority.name}`);
  lines.push(`URL: ${BASE_URL}/browse/${issue.key}`);
  lines.push("");

  if (f.description) {
    lines.push("## Description");
    lines.push(adfToText(f.description));
  }

  if (f.parent) {
    lines.push(`Parent: ${f.parent.key} — ${f.parent.fields && f.parent.fields.summary}`);
    lines.push("");
  }

  if (Array.isArray(f.subtasks) && f.subtasks.length > 0) {
    lines.push("## Subtasks");
    f.subtasks.forEach((s) => {
      lines.push(`- ${s.key}: ${s.fields.summary} [${s.fields.status.name}]`);
    });
    lines.push("");
  }

  if (Array.isArray(f.issuelinks) && f.issuelinks.length > 0) {
    lines.push("## Linked Issues");
    f.issuelinks.forEach((link) => {
      const linked = link.outwardIssue || link.inwardIssue;
      if (linked) {
        lines.push(`- ${link.type.name}: ${linked.key} — ${linked.fields.summary}`);
      }
    });
    lines.push("");
  }

  return lines.join("\n");
}

// ─── MCP Server ────────────────────────────────────────────────────────────

const server = new McpServer({
  name: "jira-mcp",
  version: "1.0.0"
});

// Tool 1: get_jira_issue
server.tool(
  "get_jira_issue",
  "Fetch the full body of a single Jira issue by key (e.g. FM-1075). Returns summary, description, acceptance criteria, subtasks, and linked issues as plain text.",
  { issue_key: z.string().describe("Jira issue key, e.g. FM-1075") },
  async ({ issue_key }) => {
    const fields = [
      "summary", "description", "issuetype", "status", "assignee",
      "priority", "parent", "subtasks", "issuelinks", "comment"
    ].join(",");

    const issue = await jiraGet(`/issue/${issue_key}?fields=${fields}&expand=renderedFields`);
    const text  = formatIssue(issue);

    return { content: [{ type: "text", text }] };
  }
);

// Tool 2: get_jira_subtasks
server.tool(
  "get_jira_subtasks",
  "Fetch a parent Jira issue and all its subtasks with full bodies. Useful for reading an entire story + all BE/FE subtasks at once.",
  { parent_key: z.string().describe("Parent Jira issue key, e.g. FM-1072") },
  async ({ parent_key }) => {
    const fields = [
      "summary", "description", "issuetype", "status", "assignee",
      "priority", "parent", "subtasks", "issuelinks"
    ];

    // Fetch parent + all subtasks via the enhanced JQL search endpoint.
    const jql = `key = "${parent_key}" OR parent = "${parent_key}"`;
    const issues = await jiraSearchJql(jql, fields);

    const parts = issues.map(formatIssue);
    const text = parts.join("\n\n---\n\n");

    return { content: [{ type: "text", text: text || "No issues found." }] };
  }
);

// Start transport
const transport = new StdioServerTransport();
await server.connect(transport);
