const fs = require("node:fs");
const path = require("node:path");

const [, , workingDirectory, outputDirectory] = process.argv;

if (!workingDirectory || !outputDirectory) {
  console.error("Usage: write-deploy-metadata.cjs <working-directory> <output-directory>");
  process.exit(1);
}

const splitNames = (value) =>
  String(value || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

const readManifest = () => {
  const manifestPath = path.join(workingDirectory, "w7s.json");
  if (!fs.existsSync(manifestPath)) return {};
  try {
    const parsed = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (error) {
    console.error(`Invalid w7s.json: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
};

const collect = (names) => {
  const values = {};
  for (const name of names) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
      console.error(`Invalid environment variable name: ${name}`);
      process.exit(1);
    }
    if (Object.prototype.hasOwnProperty.call(process.env, name)) {
      values[name] = process.env[name] ?? "";
    }
  }
  return values;
};

const encode = (value) => {
  const json = JSON.stringify(value);
  if (json === "{}") return "";
  return Buffer.from(json, "utf8").toString("base64url");
};

const manifest = readManifest();
const manifestVars = Array.isArray(manifest.vars) ? manifest.vars : [];
const manifestSecrets = Array.isArray(manifest.secrets) ? manifest.secrets : [];
const vars = collect(new Set([...manifestVars, ...splitNames(process.env.INPUT_VARS)]));
const secrets = collect(new Set([...manifestSecrets, ...splitNames(process.env.INPUT_SECRETS)]));

fs.mkdirSync(outputDirectory, { recursive: true });
fs.writeFileSync(path.join(outputDirectory, "vars.b64"), encode(vars));
fs.writeFileSync(path.join(outputDirectory, "secrets.b64"), encode(secrets));
