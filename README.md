# w7s-cloud

Reusable GitHub Action for deploying a repository to W7S.

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
- `working-directory`: Directory to package and deploy. Defaults to `.`.

The action packages the working directory as a ZIP archive, excluding `.git`, `node_modules`, `.wrangler`, and `dist/.vite`, then posts it to the W7S deploy endpoint with repository, branch, and commit headers.
