# w7s-cloud Github Action

Reusable GitHub Action for deploying a repository to <org>.W7S.cloud/<repo> or any custom CNAME domain.

More information at https://w7s.io/

## Usage

```yaml
name: Deploy

on:
  push:
    branches:
      - main
  workflow_dispatch:
  schedule:
    - cron: "17 9 * * *"

permissions:
  contents: read
  issues: write

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
        if: github.event_name != 'schedule'

      - uses: w7s-io/w7s-cloud@v1
        with:
          token: ${{ github.token }}
          usage-check-only: ${{ github.event_name == 'schedule' }}
```

## Inputs

- `deploy-url`: W7S deploy endpoint. Defaults to `https://w7s.cloud/api/v1/deploy`.
- `token`: GitHub token used for W7S deploy authorization. Defaults to `github.token`.
- `environment`: Optional W7S environment override.
- `install-command`: Optional command run before packaging.
- `build-command`: Optional command run before packaging.
- `vars`: Optional comma-separated environment variable names to pass as plain-text Worker bindings.
- `secrets`: Optional comma-separated environment variable names to pass as secret Worker bindings.
- `working-directory`: Directory to package and deploy. Defaults to `.`.
- `usage-warnings-issue`: Open or update a GitHub issue when W7S reports usage warnings or suspension state. Defaults to `true`.
- `usage-check-only`: Read W7S usage, Cloudflare-synced metrics, and suspension state without packaging or deploying the repository. Defaults to `false`.
- `logs-check-only`: Read recent W7S user Worker logs without packaging or deploying the repository. Defaults to `false`.
- `logs-hours`: Number of trailing hours of logs to fetch. Defaults to `1`.
- `logs-limit`: Maximum number of log records to fetch. Defaults to `50`.
- `logs-kind`: Optional log kind filter: `console`, `exception`, or `outcome`.
- `logs-level`: Optional console log level filter: `debug`, `info`, `log`, `warn`, or `error`.

The action packages the working directory as a ZIP archive, excluding `.git`, `node_modules`, `.wrangler`, and `dist/.vite`, then posts it to the W7S deploy endpoint with repository, branch, and commit headers.

If the workflow deploys a build directory with `working-directory` and that directory does not contain a `CNAME`, the action copies the repository root `CNAME` into the deploy directory before packaging. A `CNAME` already present in the deploy directory is left unchanged.

Deploy API warnings, such as a skipped `backend/` folder with no supported entrypoint, are shown in the GitHub Actions log and step summary.

After a successful deploy, the action reads the repo's W7S usage for the deployed day. If any daily limits are near or over the configured policy, or W7S has suspended the app after hourly Cloudflare usage sync, the action adds a warning section to the GitHub Actions step summary and opens or updates one GitHub issue per repo/environment/UTC day. Later checks on the same day update that issue with the latest stats instead of creating more issues. Issue notifications require `issues: write`; set `usage-warnings-issue: false` to keep warnings in the workflow summary only.

Scheduled workflows can set `usage-check-only: true` to check the current day's limits and update the warning issue without deploying again.

Manual or scheduled workflows can set `logs-check-only: true` to fetch the latest user Worker `console.*`, exception, and non-OK outcome logs directly into the GitHub Actions log and step summary:

```yaml
name: W7S Logs

on:
  workflow_dispatch:

permissions:
  contents: read

jobs:
  logs:
    runs-on: ubuntu-latest
    steps:
      - uses: w7s-io/w7s-cloud@v1
        with:
          token: ${{ github.token }}
          logs-check-only: true
          logs-hours: 1
          logs-limit: 50
```

The same logs API can be called with curl using a GitHub token that can access the repository:

```sh
curl "https://w7s.cloud/api/v1/logs/<owner>/<repo>?hours=1&limit=50" \
  -H "Authorization: Bearer $GITHUB_TOKEN"
```

If the repo contains `w7s.json`, any names listed in its `vars` and `secrets` arrays are collected from the workflow environment automatically. Explicit `vars` and `secrets` inputs can add more names.

Example with runtime values:

```yaml
- uses: w7s-io/w7s-cloud@v1
  env:
    PUBLIC_API_KEY: ${{ vars.PUBLIC_API_KEY }}
    PRIVATE_API_KEY: ${{ secrets.PRIVATE_API_KEY }}
  with:
    token: ${{ github.token }}
    vars: PUBLIC_API_KEY
    secrets: PRIVATE_API_KEY
```

Storage bindings are declared in the deployed repo's `w7s.json`:

```json
{
  "bindings": {
    "kv": ["CACHE"],
    "r2": ["FILES"],
    "d1": [{ "binding": "DB", "migrations": "migrations" }]
  }
}
```
