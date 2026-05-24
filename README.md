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

permissions:
  contents: read

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5

      - uses: w7s-io/w7s-cloud@v1
        with:
          token: ${{ github.token }}
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

The action packages the working directory as a ZIP archive, excluding `.git`, `node_modules`, `.wrangler`, and `dist/.vite`, then posts it to the W7S deploy endpoint with repository, branch, and commit headers.

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
