const fs = require("node:fs");

const [, , responsePath, httpStatus] = process.argv;
const raw = fs.readFileSync(responsePath, "utf8");
let payload = null;
try {
  payload = JSON.parse(raw);
} catch {}

const asArray = (value) => Array.isArray(value) ? value : [];
const code = (value) => `\`${String(value ?? "n/a")}\``;
const text = (value) => String(value ?? "n/a");
const commandValue = (value) =>
  String(value ?? "").replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
const prettyRaw = payload ? JSON.stringify(payload, null, 2) : raw;
const deployment = payload?.data?.deployment;
const deploymentWarnings = asArray(payload?.data?.deploymentWarnings);
const customDomains = asArray(payload?.data?.customDomains);
const customDomainWarnings = asArray(payload?.data?.customDomainWarnings);
const blockedCustomDomains = asArray(payload?.data?.blockedCustomDomains);
const bindings = deployment?.bindings ?? {};
const success = Number(httpStatus) >= 200 && Number(httpStatus) < 300 && payload?.status === "success";

const logLines = [
  `W7S deploy: ${text(payload?.status ?? "invalid response")} (HTTP ${httpStatus})`
];
if (deployment) {
  logLines.push(`Repository: ${text(deployment.repository)}`);
  logLines.push(`Environment: ${text(deployment.environment)}`);
  logLines.push(`Worker entrypoint: ${text(deployment.targets?.worker?.entrypoint)}`);
  logLines.push(`Static files: ${text(deployment.targets?.static?.fileCount ?? 0)}`);
  const bindingSummary = [
    asArray(bindings.kv).length ? `${asArray(bindings.kv).length} KV` : "",
    asArray(bindings.r2).length ? `${asArray(bindings.r2).length} R2` : "",
    asArray(bindings.d1).length ? `${asArray(bindings.d1).length} D1` : "",
    asArray(bindings.vars).length ? `${asArray(bindings.vars).length} vars` : "",
    asArray(bindings.secrets).length ? `${asArray(bindings.secrets).length} secrets` : ""
  ].filter(Boolean);
  if (bindingSummary.length > 0) logLines.push(`Bindings: ${bindingSummary.join(", ")}`);
}
if (payload?.data?.url) logLines.push(`URL: ${payload.data.url}`);
if (deploymentWarnings.length > 0) {
  logLines.push("", "Deploy warnings:");
  for (const warning of deploymentWarnings) {
    const message = warning.message ?? warning.code ?? "W7S reported a deploy warning.";
    logLines.push(`- ${message}`);
    console.log(`::warning title=W7S deploy warning::${commandValue(message)}`);
  }
}
if (customDomains.length > 0) logLines.push(`Custom domains: ${customDomains.map(text).join(", ")}`);
if (customDomainWarnings.length > 0) {
  logLines.push("", "CNAME TXT Security Warning:");
  for (const warning of customDomainWarnings) {
    const hostname = warning.hostname ?? "custom domain";
    const txtName = warning.txtName ?? "_w7s.<domain>";
    const txtValue = warning.txtValue ?? deployment?.repository ?? "owner/repo";
    logLines.push(`- ${hostname}: add TXT ${txtName}=${txtValue}`);
  }
}
if (blockedCustomDomains.length > 0) {
  logLines.push("", "Blocked custom domains:");
  for (const blocked of blockedCustomDomains) {
    const hostname = blocked.hostname ?? "custom domain";
    const txtName = blocked.txtName ?? "_w7s.<domain>";
    const txtValue = blocked.txtValue ?? deployment?.repository ?? "owner/repo";
    const reason = blocked.reason ?? "blocked";
    logLines.push(`- ${hostname} (${reason}): add TXT ${txtName}=${txtValue}`);
    if (blocked.currentRepository) logLines.push(`  Current repository: ${blocked.currentRepository}`);
  }
}
if (payload?.error || payload?.message) logLines.push(`Error: ${payload.error ?? payload.message}`);
if (!success) {
  logLines.push("", "Raw W7S response:", prettyRaw);
}
console.log(logLines.join("\n"));

const lines = [
  "### W7S Deploy",
  "",
  `- HTTP status: \`${httpStatus}\``
];

if (payload && typeof payload === "object") {
  lines.push(`- W7S status: \`${payload.status ?? "unknown"}\``);
  if (deployment) {
    lines.push(`- Repository: \`${deployment.repository ?? "n/a"}\``);
    lines.push(`- Environment: \`${deployment.environment ?? "n/a"}\``);
    lines.push(`- Worker entrypoint: \`${deployment.targets?.worker?.entrypoint ?? "n/a"}\``);
    lines.push(`- Static files: \`${deployment.targets?.static?.fileCount ?? 0}\``);
    if (
      asArray(bindings.kv).length > 0 ||
      asArray(bindings.r2).length > 0 ||
      asArray(bindings.d1).length > 0 ||
      asArray(bindings.vars).length > 0 ||
      asArray(bindings.secrets).length > 0
    ) {
      lines.push(`- KV bindings: \`${asArray(bindings.kv).length}\``);
      lines.push(`- R2 bindings: \`${asArray(bindings.r2).length}\``);
      lines.push(`- D1 bindings: \`${asArray(bindings.d1).length}\``);
      if (asArray(bindings.vars).length > 0) {
        lines.push(`- Runtime vars: ${asArray(bindings.vars).map(code).join(", ")}`);
      }
      if (asArray(bindings.secrets).length > 0) {
        lines.push(`- Runtime secrets: \`${asArray(bindings.secrets).length}\``);
      }
    }
  }
  if (payload.data?.url) {
    lines.push(`- URL: ${payload.data.url}`);
  }
  if (customDomains.length > 0) {
    lines.push(`- Custom domains: ${customDomains.map(code).join(", ")}`);
  }

  if (deploymentWarnings.length > 0) {
    lines.push("", "#### ⚠️ Deploy Warnings", "");
    for (const warning of deploymentWarnings) {
      const message = warning.message ?? warning.code ?? "W7S reported a deploy warning.";
      lines.push(`- ${text(message)}`);
    }
  }

  if (customDomainWarnings.length > 0) {
    lines.push("", "#### ⚠️ CNAME TXT Security Warning", "");
    lines.push("These custom domains were attached, but domain ownership is not locked yet. Add the recommended TXT record to prevent another repo from moving the hostname later.");
    lines.push("");
    for (const warning of customDomainWarnings) {
      const hostname = warning.hostname ?? "custom domain";
      const txtName = warning.txtName ?? "_w7s.<domain>";
      const txtValue = warning.txtValue ?? deployment?.repository ?? "owner/repo";
      lines.push(`- ${code(hostname)}: add TXT ${code(txtName)} with value ${code(txtValue)}`);
    }
  }

  if (blockedCustomDomains.length > 0) {
    lines.push("", "#### ⚠️ Blocked Custom Domains", "");
    lines.push("The app deployed, but these hostnames were not attached. Add the listed TXT record or remove the conflicting claim, then deploy again.");
    lines.push("");
    for (const blocked of blockedCustomDomains) {
      const hostname = blocked.hostname ?? "custom domain";
      const txtName = blocked.txtName ?? "_w7s.<domain>";
      const txtValue = blocked.txtValue ?? deployment?.repository ?? "owner/repo";
      const reason = blocked.reason ?? "blocked";
      lines.push(`- ${code(hostname)} (${code(reason)}): add TXT ${code(txtName)} with value ${code(txtValue)}`);
      if (blocked.currentRepository) lines.push(`  Current repository: ${code(blocked.currentRepository)}`);
    }
  }

  if (payload.error || payload.message) {
    lines.push(`- Error: \`${payload.error ?? payload.message}\``);
  }
} else {
  lines.push("- Response: invalid JSON");
}

if (!success) {
  lines.push("", "<details><summary>Raw response</summary>", "", "```json", prettyRaw, "```", "</details>");
}
if (process.env.GITHUB_STEP_SUMMARY) {
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${lines.join("\n")}\n`);
}

if (!success) process.exit(1);
