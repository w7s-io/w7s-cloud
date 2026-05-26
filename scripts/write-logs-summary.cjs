const fs = require("node:fs");

const [, , deployUrlArg] = process.argv;

const token = process.env.W7S_DEPLOY_TOKEN || "";
const repository =
  process.env.W7S_LOGS_REPOSITORY ||
  process.env.GITHUB_REPOSITORY_NAME ||
  process.env.GITHUB_REPOSITORY ||
  "";

const code = (value) => `\`${String(value ?? "n/a")}\``;
const text = (value) => String(value ?? "");
const truncate = (value, length = 240) => {
  const normalized = text(value).replace(/\s+/g, " ").trim();
  return normalized.length > length ? `${normalized.slice(0, length - 14)}...[truncated]` : normalized;
};
const markdownEscape = (value) =>
  text(value)
    .replace(/\\/g, "\\\\")
    .replace(/\|/g, "\\|")
    .replace(/\n/g, "<br>");

const sanitizeEnvironment = (value) => {
  const sanitized = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 63);
  return sanitized || "production";
};

const environmentForBranch = (branch) => {
  const normalized = String(branch || "").trim();
  if (!normalized || normalized === "main" || normalized === "master") return "production";
  return sanitizeEnvironment(normalized);
};

const readEnvironment = () => {
  const explicit = String(process.env.W7S_LOGS_ENVIRONMENT || process.env.INPUT_ENVIRONMENT || "").trim();
  if (explicit) return sanitizeEnvironment(explicit);
  return environmentForBranch(process.env.W7S_LOGS_BRANCH || process.env.GITHUB_REF_NAME_VALUE || process.env.GITHUB_REF_NAME);
};

const queryInteger = (name, fallback, min, max) => {
  const raw = String(process.env[name] || "").trim();
  if (!raw) return String(fallback);
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return raw;
  return String(Math.max(min, Math.min(max, Math.floor(parsed))));
};

const logsUrlFor = (params) => {
  const repositoryParts = String(params.repository || "").split("/");
  if (repositoryParts.length !== 2 || !repositoryParts[0] || !repositoryParts[1]) {
    throw new Error("W7S logs check requires a GitHub repository in owner/repo form.");
  }

  const url = new URL(params.deployUrl || "https://w7s.cloud/api/v1/deploy");
  const apiPrefix = url.pathname.replace(/\/api\/v1\/deploy\/?$/, "/api/v1");
  url.pathname = `${apiPrefix}/logs/${encodeURIComponent(repositoryParts[0])}/${encodeURIComponent(repositoryParts[1])}`;
  url.search = "";
  url.searchParams.set("environment", params.environment);
  url.searchParams.set("hours", params.hours);
  url.searchParams.set("limit", params.limit);
  if (params.kind) url.searchParams.set("kind", params.kind);
  if (params.level) url.searchParams.set("level", params.level);
  return url;
};

const requestLogs = async (url) => {
  const response = await fetch(url, {
    headers: {
      accept: "application/json",
      authorization: `Bearer ${token}`,
      "user-agent": "w7s-cloud-action"
    }
  });
  const raw = await response.text();
  let payload = null;
  try {
    payload = raw ? JSON.parse(raw) : null;
  } catch {}
  return { response, payload, raw };
};

const recordMessage = (record) => {
  if (record?.text) return record.text;
  if (Array.isArray(record?.message)) {
    return record.message.map((part) => {
      if (typeof part === "string") return part;
      try {
        return JSON.stringify(part);
      } catch {
        return String(part);
      }
    }).join(" ");
  }
  if (record?.exception?.message) return `${record.exception.name || "Error"}: ${record.exception.message}`;
  return "";
};

const recordPath = (record) => {
  const request = record?.request || {};
  const method = request.method || "";
  const path = request.path || "";
  const status = request.status ? ` ${request.status}` : "";
  return truncate(`${method} ${path}${status}`.trim(), 80);
};

const appendSummary = (lines) => {
  if (!lines || lines.length === 0 || !process.env.GITHUB_STEP_SUMMARY) return;
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${lines.join("\n")}\n`);
};

const writeOutputs = (params) => {
  if (!process.env.GITHUB_OUTPUT) return;
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `logs-count=${params.count}\n`);
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `logs-url=${params.url}\n`);
};

const renderSummary = (logs, url) => {
  const records = Array.isArray(logs?.records) ? logs.records : [];
  const lines = [
    "",
    "### W7S Logs",
    "",
    `- Repository: ${code(logs?.repository || repository)}`,
    `- Environment: ${code(logs?.environment || readEnvironment())}`,
    `- Window: ${code(logs?.from)} to ${code(logs?.to)}`,
    `- Records: ${code(records.length)}`,
    `- API: ${code(url)}`
  ];

  if (records.length === 0) {
    lines.push("", "No log records matched the query.");
    return lines;
  }

  lines.push(
    "",
    "| Time | Kind | Level | Request | Message |",
    "| --- | --- | --- | --- | --- |"
  );

  for (const record of records.slice(0, 50)) {
    lines.push(
      `| ${markdownEscape(record.timestamp)} | ${markdownEscape(record.kind)} | ${markdownEscape(record.level || "")} | ${markdownEscape(recordPath(record))} | ${markdownEscape(truncate(recordMessage(record), 220))} |`
    );
  }

  const exceptions = records.filter((record) => record?.exception?.stack);
  if (exceptions.length > 0) {
    lines.push("", "<details>", "<summary>Exception stacks</summary>", "");
    for (const record of exceptions.slice(0, 10)) {
      lines.push(`#### ${markdownEscape(record.timestamp)} ${markdownEscape(record.text || "Exception")}`, "", "```text");
      lines.push(text(record.exception.stack).slice(0, 4000));
      lines.push("```", "");
    }
    lines.push("</details>");
  }

  if (logs?.cursor) {
    lines.push("", `More records are available with cursor ${code(logs.cursor)}.`);
  }

  return lines;
};

const main = async () => {
  if (!token) throw new Error("W7S logs check requires a GitHub token.");

  const environment = readEnvironment();
  const logsUrl = logsUrlFor({
    deployUrl: deployUrlArg,
    repository,
    environment,
    hours: queryInteger("W7S_LOGS_HOURS", 1, 1, 168),
    limit: queryInteger("W7S_LOGS_LIMIT", 50, 1, 500),
    kind: String(process.env.W7S_LOGS_KIND || "").trim(),
    level: String(process.env.W7S_LOGS_LEVEL || "").trim()
  });

  const { response, payload, raw } = await requestLogs(logsUrl);
  if (!response.ok || payload?.status === "error") {
    const message = payload?.error || raw || `HTTP ${response.status}`;
    throw new Error(`W7S logs request failed: ${message}`);
  }

  const logs = payload?.data?.logs || {};
  const records = Array.isArray(logs.records) ? logs.records : [];
  console.log(`W7S logs: ${records.length} record(s) for ${logs.repository || repository} (${logs.environment || environment})`);
  console.log(`W7S logs API: ${logsUrl.toString()}`);
  for (const record of records) {
    const level = record.level ? `/${record.level}` : "";
    const request = recordPath(record);
    const requestPart = request ? ` ${request}` : "";
    console.log(`[${record.timestamp || "n/a"}] ${record.kind || "log"}${level}${requestPart} ${truncate(recordMessage(record), 500)}`);
  }

  writeOutputs({ count: records.length, url: logsUrl.toString() });
  appendSummary(renderSummary(logs, logsUrl.toString()));
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
