const fs = require("node:fs");

const [, , responsePath, deployUrl] = process.argv;

const token = process.env.W7S_DEPLOY_TOKEN || "";
const issueToken = process.env.W7S_GITHUB_TOKEN || token;
const issueWarningsInput = process.env.INPUT_USAGE_WARNINGS_ISSUE;

const asArray = (value) => Array.isArray(value) ? value : [];
const code = (value) => `\`${String(value ?? "n/a")}\``;
const text = (value) => String(value ?? "n/a");
const markdownEscape = (value) => String(value ?? "n/a").replace(/\|/g, "\\|");
const issueMarkerFor = (environment, date) =>
  `<!-- w7s-usage-warnings:${String(environment || "production")}:${String(date || usageDate())} -->`;
const legacyIssueMarkerFor = (environment) =>
  `<!-- w7s-usage-warnings:${String(environment || "production")} -->`;

const booleanInput = (value, fallback) => {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
};
const usageCheckOnly = booleanInput(process.env.W7S_USAGE_CHECK_ONLY, false);

const readDeployResponse = () => {
  if (!responsePath || !fs.existsSync(responsePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(responsePath, "utf8"));
  } catch {
    return null;
  }
};

const usageDate = (deployedAt) => {
  const date = deployedAt ? new Date(deployedAt) : new Date();
  if (Number.isNaN(date.getTime())) return new Date().toISOString().slice(0, 10);
  return date.toISOString().slice(0, 10);
};

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

const usageUrlFor = (params) => {
  const repositoryParts = String(params.repository || "").split("/");
  if (repositoryParts.length !== 2 || !repositoryParts[0] || !repositoryParts[1]) return null;

  const url = new URL(params.deployUrl || "https://w7s.cloud/api/v1/deploy");
  const apiPrefix = url.pathname.replace(/\/api\/v1\/deploy\/?$/, "/api/v1");
  url.pathname = `${apiPrefix}/usage/${encodeURIComponent(repositoryParts[0])}/${encodeURIComponent(repositoryParts[1])}`;
  url.search = "";
  url.searchParams.set("date", usageDate(params.deployedAt));
  if (params.environment) url.searchParams.set("environment", params.environment);
  return url;
};

const readUsageTarget = (deployPayload) => {
  const deployment = deployPayload?.data?.deployment;
  const repository = deployment?.repository ||
    process.env.W7S_USAGE_REPOSITORY ||
    process.env.GITHUB_REPOSITORY_NAME ||
    process.env.GITHUB_REPOSITORY;
  if (!repository) return null;

  const branch = deployment?.branch ||
    process.env.W7S_USAGE_BRANCH ||
    process.env.GITHUB_REF_NAME_VALUE ||
    process.env.GITHUB_REF_NAME ||
    "";
  const explicitEnvironment = deployment?.environment ||
    process.env.W7S_USAGE_ENVIRONMENT ||
    process.env.INPUT_ENVIRONMENT ||
    "";
  const environment = explicitEnvironment.trim()
    ? sanitizeEnvironment(explicitEnvironment)
    : environmentForBranch(branch);
  const deployedAt = deployment?.deployedAt || process.env.W7S_USAGE_AT || new Date().toISOString();
  const commitSha = deployment?.commitSha ||
    process.env.W7S_USAGE_COMMIT_SHA ||
    process.env.GITHUB_SHA_VALUE ||
    process.env.GITHUB_SHA ||
    "";

  return {
    deployment: deployment ?? {
      repository,
      environment,
      branch,
      commitSha,
      deployedAt
    },
    deploymentUrl: deployPayload?.data?.url || null,
    repository,
    environment,
    deployedAt
  };
};

const renderWarnings = (usagePayload, issueResult = null, options = {}) => {
  const warnings = asArray(usagePayload?.data?.warnings);
  const appLimitState = usagePayload?.data?.appLimitState;
  if (warnings.length === 0 && !appLimitState) return null;

  const lines = [
    "",
    "#### ⚠️ W7S Usage Warnings",
    "",
    options.checkOnly
      ? "This usage check found the repo near or over one or more daily limits."
      : "This deployment succeeded, but the repo is near or over one or more daily limits.",
    ""
  ];

  const usage = usagePayload?.data?.usage;
  if (usage?.cloudflareSyncedAt) {
    lines.push(`- Cloudflare usage synced at: ${code(usage.cloudflareSyncedAt)}`);
  }
  if (Array.isArray(usage?.cloudflareHours) && usage.cloudflareHours.length > 0) {
    lines.push(`- Cloudflare hourly records: ${code(usage.cloudflareHours.length)}`);
  }
  if (appLimitState) {
    lines.push(`- App status: ${code(appLimitState.status)}`);
    if (appLimitState.reason) lines.push(`- Reason: ${text(appLimitState.reason)}`);
    if (appLimitState.resumeAfter) lines.push(`- Resume after: ${code(appLimitState.resumeAfter)}`);
  }
  if (usage?.cloudflareSyncedAt || appLimitState) lines.push("");

  for (const warning of warnings) {
    const metric = warning.metric ?? "unknown";
    const status = warning.status ?? "warning";
    const used = warning.used ?? "n/a";
    const limit = warning.limit ?? "n/a";
    const remaining = warning.remaining ?? "n/a";
    lines.push(`- ${code(metric)} ${code(status)}: ${code(used)} used of ${code(limit)} daily units, ${code(remaining)} remaining.`);
  }

  lines.push("", "W7S returns HTTP `429` when a request would exceed an enforced daily limit.");
  if (issueResult?.htmlUrl) {
    const action = issueResult.action === "updated"
      ? "Updated issue"
      : issueResult.action === "reopened"
        ? "Reopened issue"
        : "Opened issue";
    lines.push("", `${action}: [#${issueResult.number}](${issueResult.htmlUrl})`);
  } else if (issueResult?.skipped) {
    lines.push("", `Issue notification skipped: ${issueResult.skipped}`);
  }
  return lines;
};

const appendSummary = (lines) => {
  if (!lines || lines.length === 0 || !process.env.GITHUB_STEP_SUMMARY) return;
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${lines.join("\n")}\n`);
};

const githubApiBase = () =>
  String(process.env.GITHUB_API_URL_VALUE || process.env.GITHUB_API_URL || "https://api.github.com").replace(/\/+$/, "");

const githubRequest = async (params) => {
  const response = await fetch(`${githubApiBase()}${params.path}`, {
    method: params.method || "GET",
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${params.token}`,
      "content-type": "application/json",
      "x-github-api-version": "2022-11-28",
      "user-agent": "w7s-cloud-action"
    },
    body: params.body ? JSON.stringify(params.body) : undefined
  });
  const raw = await response.text();
  let payload = null;
  try {
    payload = raw ? JSON.parse(raw) : null;
  } catch {}
  return { response, payload, raw };
};

const githubRepoPath = (repository) => {
  const [owner, repo] = String(repository || "").split("/");
  if (!owner || !repo) return null;
  return `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
};

const runUrlFor = (deployment) => {
  const serverUrl = String(process.env.GITHUB_SERVER_URL_VALUE || process.env.GITHUB_SERVER_URL || "https://github.com").replace(/\/+$/, "");
  const repository = deployment?.repository || process.env.GITHUB_REPOSITORY_NAME || process.env.GITHUB_REPOSITORY;
  const runId = process.env.GITHUB_RUN_ID_VALUE || process.env.GITHUB_RUN_ID;
  if (!repository || !runId) return null;
  return `${serverUrl}/${repository}/actions/runs/${runId}`;
};

const commitUrlFor = (deployment) => {
  const serverUrl = String(process.env.GITHUB_SERVER_URL_VALUE || process.env.GITHUB_SERVER_URL || "https://github.com").replace(/\/+$/, "");
  if (!deployment?.repository || !deployment?.commitSha) return null;
  return `${serverUrl}/${deployment.repository}/commit/${deployment.commitSha}`;
};

const warningTable = (warnings) => [
  "| Metric | Status | Used | Limit | Remaining |",
  "| --- | --- | ---: | ---: | ---: |",
  ...warnings.map((warning) =>
    `| ${markdownEscape(warning.metric)} | ${markdownEscape(warning.status)} | ${markdownEscape(warning.used)} | ${markdownEscape(warning.limit)} | ${markdownEscape(warning.remaining)} |`
  )
];

const issueBodyFor = (params) => {
  const deployment = params.deployment;
  const deploymentUrl = params.deploymentUrl;
  const checkOnly = Boolean(params.checkOnly);
  const warnings = asArray(params.usagePayload?.data?.warnings);
  const appLimitState = params.usagePayload?.data?.appLimitState;
  const usage = params.usagePayload?.data?.usage;
  const date = usage?.date || usageDate(deployment?.deployedAt);
  const environment = deployment?.environment || usage?.environment || "production";
  const runUrl = runUrlFor(deployment);
  const commitUrl = commitUrlFor(deployment);
  const runAttempt = process.env.GITHUB_RUN_ATTEMPT_VALUE || process.env.GITHUB_RUN_ATTEMPT;
  const lines = [
    issueMarkerFor(environment, date),
    "",
    "W7S reported daily usage limit warnings or suspension state for this repository.",
    "",
    "This issue is scoped to one UTC day. Later W7S checks on the same day update this issue with the latest stats instead of opening more issues.",
    "",
    `- Repository: ${code(deployment?.repository)}`,
    `- Environment: ${code(environment)}`,
    `- Date: ${code(date)}`,
    `- Last checked: ${code(new Date().toISOString())}`,
    `- Branch: ${code(deployment?.branch)}`,
    `- Commit: ${commitUrl ? `[${String(deployment?.commitSha || "").slice(0, 12)}](${commitUrl})` : code(deployment?.commitSha)}`,
    checkOnly
      ? "- Check: usage only"
      : `- Deployment: ${deploymentUrl ? `[${deploymentUrl}](${deploymentUrl})` : code("n/a")}`
  ];
  if (runUrl) {
    lines.push(`- Workflow run: [${text(process.env.GITHUB_WORKFLOW_VALUE || "Deploy")}](${runUrl})${runAttempt ? `, attempt ${code(runAttempt)}` : ""}`);
  }
  if (usage?.cloudflareSyncedAt) lines.push(`- Cloudflare usage synced at: ${code(usage.cloudflareSyncedAt)}`);
  if (Array.isArray(usage?.cloudflareHours)) lines.push(`- Cloudflare hourly records: ${code(usage.cloudflareHours.length)}`);
  if (appLimitState) {
    lines.push(`- App status: ${code(appLimitState.status)}`);
    if (appLimitState.reason) lines.push(`- Reason: ${text(appLimitState.reason)}`);
    if (appLimitState.resumeAfter) lines.push(`- Resume after: ${code(appLimitState.resumeAfter)}`);
  }
  if (warnings.length > 0) {
    lines.push("", ...warningTable(warnings), "");
  } else {
    lines.push("", "No metric warnings were returned with the current usage response.", "");
  }
  lines.push("W7S returns HTTP `429` when a request would exceed an enforced daily limit.");
  lines.push("This issue is updated by `w7s-io/w7s-cloud@v1` while warnings continue on the same UTC day.");
  return lines.join("\n");
};

const findUsageIssue = async (params) => {
  const repoPath = githubRepoPath(params.repository);
  if (!repoPath) return null;
  const marker = issueMarkerFor(params.environment, params.date);
  const legacyMarker = legacyIssueMarkerFor(params.environment);
  const { response, payload, raw } = await githubRequest({
    token: params.token,
    path: `${repoPath}/issues?state=all&per_page=100`
  });
  if (!response.ok) {
    return {
      error: `GitHub issues lookup failed (HTTP ${response.status}${raw ? `: ${raw.slice(0, 180)}` : ""}).`
    };
  }
  const issue = asArray(payload).find((candidate) =>
    !candidate.pull_request &&
    (
      String(candidate.body || "").includes(marker) ||
      candidate.title === params.title ||
      (
        params.allowLegacyMatch &&
        String(candidate.body || "").includes(legacyMarker) &&
        candidate.title === `W7S usage warning for ${params.environment}`
      )
    )
  );
  return issue || null;
};

const upsertUsageIssue = async (params) => {
  if (!booleanInput(issueWarningsInput, true)) {
    return { skipped: "`usage-warnings-issue` is disabled." };
  }
  if (!params.repository || !params.token) {
    return { skipped: "missing GitHub token or repository." };
  }

  const repoPath = githubRepoPath(params.repository);
  if (!repoPath) return { skipped: "repository is not in owner/repo form." };

  const usage = params.usagePayload?.data?.usage;
  const environment = params.deployment?.environment || usage?.environment || "production";
  const date = usage?.date || usageDate(params.deployment?.deployedAt);
  const title = `W7S usage warning for ${environment} on ${date}`;
  const body = issueBodyFor({
    deployment: params.deployment,
    deploymentUrl: params.deploymentUrl,
    checkOnly: params.checkOnly,
    usagePayload: params.usagePayload
  });

  const existing = await findUsageIssue({
    token: params.token,
    repository: params.repository,
    environment,
    date,
    title,
    allowLegacyMatch: date === usageDate(params.deployment?.deployedAt)
  });
  if (existing?.error) return { skipped: existing.error };

  const request = existing ? {
    method: "PATCH",
    path: `${repoPath}/issues/${existing.number}`,
    body: {
      title,
      body,
      ...(existing.state === "closed" ? { state: "open" } : {})
    }
  } : {
    method: "POST",
    path: `${repoPath}/issues`,
    body: { title, body }
  };

  const { response, payload, raw } = await githubRequest({
    token: params.token,
    ...request
  });
  if (!response.ok) {
    return {
      skipped: `GitHub issue ${existing ? "update" : "create"} failed (HTTP ${response.status}${raw ? `: ${raw.slice(0, 180)}` : ""}).`
    };
  }
  return {
    action: existing?.state === "closed" ? "reopened" : existing ? "updated" : "opened",
    number: payload?.number,
    htmlUrl: payload?.html_url
  };
};

const main = async () => {
  const deployPayload = readDeployResponse();
  const target = readUsageTarget(deployPayload);
  if (!target?.repository || !token) return;

  let usageUrl;
  try {
    usageUrl = usageUrlFor({
      deployUrl,
      repository: target.repository,
      environment: target.environment,
      deployedAt: target.deployedAt
    });
  } catch (error) {
    console.log(`W7S usage warnings: skipped (${error instanceof Error ? error.message : String(error)}).`);
    return;
  }
  if (!usageUrl) return;

  try {
    const response = await fetch(usageUrl, {
      headers: {
        authorization: `Bearer ${token}`
      }
    });
    const raw = await response.text();
    let usagePayload = null;
    try {
      usagePayload = JSON.parse(raw);
    } catch {}

    if (!response.ok || usagePayload?.status !== "success") {
      console.log(`W7S usage warnings: skipped usage lookup (HTTP ${response.status}).`);
      return;
    }

    const warnings = asArray(usagePayload?.data?.warnings);
    const appLimitState = usagePayload?.data?.appLimitState;
    if (warnings.length === 0 && !appLimitState) {
      console.log("W7S usage warnings: none.");
      return;
    }

    console.log("W7S usage warnings:");
    for (const warning of warnings) {
      console.log(
        `- ${text(warning.metric)} ${text(warning.status)}: ${text(warning.used)}/${text(warning.limit)} daily units`
      );
    }
    if (appLimitState) {
      console.log(`- app ${text(appLimitState.status)}: ${text(appLimitState.reason)}`);
    }
    const issueResult = await upsertUsageIssue({
      token: issueToken,
      repository: target.repository,
      deployment: target.deployment,
      deploymentUrl: target.deploymentUrl,
      checkOnly: usageCheckOnly,
      usagePayload
    });
    if (issueResult.htmlUrl) {
      console.log(`W7S usage warnings issue ${issueResult.action}: ${issueResult.htmlUrl}`);
    } else if (issueResult.skipped) {
      console.log(`W7S usage warnings issue skipped: ${issueResult.skipped}`);
    }
    appendSummary(renderWarnings(usagePayload, issueResult, { checkOnly: usageCheckOnly }));
  } catch (error) {
    console.log(`W7S usage warnings: skipped (${error instanceof Error ? error.message : String(error)}).`);
  }
};

main().catch((error) => {
  console.log(`W7S usage warnings: skipped (${error instanceof Error ? error.message : String(error)}).`);
});
