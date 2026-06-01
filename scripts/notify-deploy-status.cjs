const fs = require("node:fs");

const [, , stage, deployUrlArg, responsePath, httpStatus] = process.argv;

const deployToken = process.env.W7S_DEPLOY_TOKEN || "";
const chatId = process.env.W7S_TELEGRAM_CHAT_ID || "";
const events = process.env.W7S_TELEGRAM_EVENTS || "";
const botToken = process.env.W7S_TELEGRAM_BOT_TOKEN || "";
const threadId = process.env.W7S_TELEGRAM_THREAD_ID || "";
const messageIdPath = process.env.W7S_TELEGRAM_MESSAGE_ID_PATH || "";

const asArray = (value) => Array.isArray(value) ? value : [];
const value = (input, fallback = "") => {
  const text = String(input ?? "").trim();
  return text || fallback;
};

const statusUrlFor = (deployUrl) => {
  const url = new URL(deployUrl || "https://w7s.cloud/api/v1/deploy");
  url.pathname = url.pathname.replace(/\/api\/v1\/deploy\/?$/, "/api/v1/deploy/status");
  return url.toString();
};

const runUrlFor = () => {
  const server = process.env.GITHUB_SERVER_URL_VALUE || process.env.GITHUB_SERVER_URL || "https://github.com";
  const repository = process.env.GITHUB_REPOSITORY_NAME || process.env.GITHUB_REPOSITORY || "";
  const runId = process.env.GITHUB_RUN_ID_VALUE || process.env.GITHUB_RUN_ID || "";
  return repository && runId ? `${server}/${repository}/actions/runs/${runId}` : "";
};

const readPayload = () => {
  if (!responsePath || !fs.existsSync(responsePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(responsePath, "utf8"));
  } catch {
    return null;
  }
};

const stageLabels = {
  start: "Deployment started",
  package: "Packaging repository",
  upload: "Uploading archive",
  success: "Deployment completed",
  warning: "Deployment completed with warnings",
  error: "Deployment failed"
};

const buildBody = () => {
  const payload = readPayload();
  const deployment = payload?.data?.deployment;
  const warnings = [
    ...asArray(payload?.data?.deploymentWarnings),
    ...asArray(payload?.data?.customDomainWarnings),
    ...asArray(payload?.data?.blockedCustomDomains)
  ];

  return {
    stage,
    httpStatus: httpStatus ? Number(httpStatus) : null,
    status: payload?.status || null,
    error: payload?.error || payload?.message || null,
    url: payload?.data?.url || null,
    warningCount: warnings.length,
    deployment: deployment || null,
    telegram: {
      chatId: chatId || null,
      events: events || null
    },
    github: {
      repository: value(deployment?.repository || process.env.GITHUB_REPOSITORY_NAME || process.env.GITHUB_REPOSITORY),
      branch: value(deployment?.branch || process.env.GITHUB_REF_NAME_VALUE || process.env.GITHUB_REF_NAME),
      commitSha: value(deployment?.commitSha || process.env.GITHUB_SHA_VALUE || process.env.GITHUB_SHA),
      workflow: value(process.env.GITHUB_WORKFLOW_VALUE || process.env.GITHUB_WORKFLOW),
      runId: value(process.env.GITHUB_RUN_ID_VALUE || process.env.GITHUB_RUN_ID),
      runAttempt: value(process.env.GITHUB_RUN_ATTEMPT_VALUE || process.env.GITHUB_RUN_ATTEMPT),
      runUrl: runUrlFor()
    },
    environment: value(deployment?.environment || process.env.W7S_DEPLOY_ENVIRONMENT || "production")
  };
};

const shortSha = (input) => input ? String(input).slice(0, 12) : "n/a";

const buildTelegramMessage = () => {
  const body = buildBody();
  const deployment = body.deployment;
  const repository = value(deployment?.repository || body.github.repository, "n/a");
  const branch = value(deployment?.branch || body.github.branch, "n/a");
  const environment = value(deployment?.environment || body.environment, "production");
  const commit = shortSha(deployment?.commitSha || body.github.commitSha);
  const label = stageLabels[stage] || value(stage, "Deployment update");
  const lines = [
    `W7S ${label}`,
    "",
    `Repository: ${repository}`,
    `Environment: ${environment}`,
    `Branch: ${branch}`,
    `Commit: ${commit}`
  ];

  if (body.github.workflow) lines.push(`Workflow: ${body.github.workflow}`);
  if (body.url) lines.push(`URL: ${body.url}`);
  if (body.httpStatus) lines.push(`HTTP: ${body.httpStatus}`);
  if (body.warningCount > 0) lines.push(`Warnings: ${body.warningCount}`);
  if (body.error) lines.push(`Error: ${String(body.error).slice(0, 300)}`);
  if (body.github.runUrl) lines.push("", body.github.runUrl);

  return lines.join("\n").slice(0, 4096);
};

const telegramRequest = async (method, body) => {
  const response = await fetch(`https://api.telegram.org/bot${botToken}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || payload?.ok === false) {
    const description = payload?.description || `HTTP ${response.status}`;
    if (String(description).toLowerCase().includes("message is not modified")) return payload;
    throw new Error(description);
  }
  return payload;
};

const notifyTelegramDirectly = async () => {
  const existingMessageId = messageIdPath && fs.existsSync(messageIdPath)
    ? fs.readFileSync(messageIdPath, "utf8").trim()
    : "";
  const body = {
    chat_id: chatId,
    text: buildTelegramMessage(),
    disable_web_page_preview: true
  };
  if (threadId) body.message_thread_id = threadId;

  if (existingMessageId) {
    await telegramRequest("editMessageText", {
      ...body,
      message_id: existingMessageId
    });
    return;
  }

  const payload = await telegramRequest("sendMessage", body);
  const messageId = payload?.result?.message_id;
  if (messageId && messageIdPath) fs.writeFileSync(messageIdPath, String(messageId));
};

const notifyW7s = async () => {
  if (!deployToken) return;

  const response = await fetch(statusUrlFor(deployUrlArg), {
    method: "POST",
    headers: {
      "authorization": `Bearer ${deployToken}`,
      "content-type": "application/json",
      "x-github-repository": process.env.GITHUB_REPOSITORY_NAME || process.env.GITHUB_REPOSITORY || "",
      "x-github-branch": process.env.GITHUB_REF_NAME_VALUE || process.env.GITHUB_REF_NAME || "",
      "x-github-sha": process.env.GITHUB_SHA_VALUE || process.env.GITHUB_SHA || ""
    },
    body: JSON.stringify(buildBody())
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(text || `HTTP ${response.status}`);
  }
};

(async () => {
  if (!chatId) return;
  if (botToken) await notifyTelegramDirectly();
  else await notifyW7s();
})().catch((error) => {
  const message = String(error.message || error)
    .replace(/%/g, "%25")
    .replace(/\r/g, "%0D")
    .replace(/\n/g, "%0A");
  console.log(`::warning title=W7S deploy status notification failed::${message}`);
});
