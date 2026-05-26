const fs = require("node:fs");

const [, , responsePath, deployUrl] = process.argv;

const token = process.env.W7S_DEPLOY_TOKEN || "";

const asArray = (value) => Array.isArray(value) ? value : [];
const code = (value) => `\`${String(value ?? "n/a")}\``;
const text = (value) => String(value ?? "n/a");

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

const renderWarnings = (usagePayload) => {
  const warnings = asArray(usagePayload?.data?.warnings);
  if (warnings.length === 0) return null;

  const lines = [
    "",
    "#### ⚠️ W7S Usage Warnings",
    "",
    "This deployment succeeded, but the repo is near or over one or more daily soft limits.",
    ""
  ];

  for (const warning of warnings) {
    const metric = warning.metric ?? "unknown";
    const status = warning.status ?? "warning";
    const used = warning.used ?? "n/a";
    const limit = warning.limit ?? "n/a";
    const remaining = warning.remaining ?? "n/a";
    lines.push(`- ${code(metric)} ${code(status)}: ${code(used)} used of ${code(limit)} daily units, ${code(remaining)} remaining.`);
  }

  lines.push("", "Soft limits are advisory today; W7S does not block traffic from these warnings yet.");
  return lines;
};

const appendSummary = (lines) => {
  if (!lines || lines.length === 0 || !process.env.GITHUB_STEP_SUMMARY) return;
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${lines.join("\n")}\n`);
};

const main = async () => {
  const deployPayload = readDeployResponse();
  const deployment = deployPayload?.data?.deployment;
  if (!deployment?.repository || !token) return;

  let usageUrl;
  try {
    usageUrl = usageUrlFor({
      deployUrl,
      repository: deployment.repository,
      environment: deployment.environment,
      deployedAt: deployment.deployedAt
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
    if (warnings.length === 0) {
      console.log("W7S usage warnings: none.");
      return;
    }

    console.log("W7S usage warnings:");
    for (const warning of warnings) {
      console.log(
        `- ${text(warning.metric)} ${text(warning.status)}: ${text(warning.used)}/${text(warning.limit)} daily units`
      );
    }
    appendSummary(renderWarnings(usagePayload));
  } catch (error) {
    console.log(`W7S usage warnings: skipped (${error instanceof Error ? error.message : String(error)}).`);
  }
};

main().catch((error) => {
  console.log(`W7S usage warnings: skipped (${error instanceof Error ? error.message : String(error)}).`);
});
