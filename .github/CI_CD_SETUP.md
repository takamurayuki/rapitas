# CI/CD Setup Guide for Rapitas

This guide explains how to set up the CI/CD pipeline for the Rapitas project.

## Required GitHub Secrets

To enable the CI/CD pipeline, you need to configure the following secrets in your GitHub repository:

### 1. Code Signing (Optional but Recommended)

For production releases, it's recommended to sign your Tauri application:

- **`TAURI_SIGNING_PRIVATE_KEY`**: Your Tauri signing private key
- **`TAURI_SIGNING_PRIVATE_KEY_PASSWORD`**: Password for the signing key

To generate signing keys:
```bash
cd rapitas-desktop
pnpm tauri signer generate
```

### 2. GitHub Token

The `GITHUB_TOKEN` is automatically provided by GitHub Actions and doesn't need manual configuration.

## Workflow Files

The CI/CD pipeline consists of several workflow files:

### 1. `tauri-build.yml`
- **Purpose**: Build Tauri applications for all platforms
- **Triggers**: Push to main branches, tags, PRs, manual dispatch
- **Outputs**: Platform-specific installers (exe, msi, dmg, AppImage, deb, rpm)
- **Platforms**: Windows, macOS (Intel & Apple Silicon), Linux

### 2. `test-lint.yml`
- **Purpose**: Run tests and linting checks
- **Triggers**: Push to main branches, PRs
- **Jobs**:
  - Backend tests with PostgreSQL
  - Frontend tests and type checking
  - Code linting for TypeScript
  - Rust code formatting and Clippy checks

### 3. `security-scan.yml`
- **Purpose**: Security vulnerability scanning
- **Triggers**: Push to main branches, PRs, weekly schedule
- **Scans**:
  - Trivy for general vulnerabilities
  - cargo-audit for Rust dependencies
  - npm/pnpm audit for JavaScript dependencies
  - CodeQL for code-level security issues

### 4. `pr-preview.yml`
- **Purpose**: Quick build checks for PRs
- **Triggers**: Pull requests with code changes
- **Features**: Posts build status as PR comment

### 5. `update-releases.yml`
- **Purpose**: Generate update metadata for Tauri auto-updater
- **Triggers**: Release events, manual dispatch
- **Output**: `update.json` file for Tauri updater

## Setting Up the Pipeline

1. **Enable GitHub Actions**:
   - Go to Settings → Actions → General
   - Select "Allow all actions and reusable workflows"

2. **Configure Secrets**:
   - Go to Settings → Secrets and variables → Actions
   - Add the required secrets mentioned above

3. **Create Release Tags**:
   ```bash
   git tag v1.0.0
   git push origin v1.0.0
   ```

4. **Monitor Builds**:
   - Check the Actions tab in your GitHub repository
   - Review build logs for any issues

## Build Artifacts

Build artifacts are automatically uploaded for each platform:

- **Windows**: `.exe` (NSIS installer) and `.msi` files
- **macOS**: `.dmg` files and `.app` bundles
- **Linux**: `.AppImage`, `.deb`, and `.rpm` files

## Auto-Update Configuration

The Tauri auto-updater is configured to check for updates using the `update.json` file generated during releases.

To enable auto-updates in your application:
1. Ensure the `update-releases.yml` workflow runs on releases
2. Configure the updater endpoint in your Tauri configuration
3. Implement update checking in your application code

## Troubleshooting

### Build Failures

1. **Dependency Issues**: Ensure all lock files are committed
2. **Rust Compilation**: Check target compatibility
3. **System Dependencies**: Review platform-specific requirements

### Security Scan Issues

1. **High Severity Vulnerabilities**: Update affected dependencies
2. **False Positives**: Add exceptions with justification
3. **Audit Failures**: Review and update dependencies regularly

## Best Practices

1. **Version Tagging**: Use semantic versioning (e.g., v1.0.0)
2. **Branch Protection**: Enable required status checks
3. **Regular Updates**: Keep dependencies and tools updated
4. **Security First**: Address security issues promptly
5. **Cache Usage**: Leverage caching for faster builds

## Support

For CI/CD issues:
1. Check workflow logs in the Actions tab
2. Review this documentation
3. Open an issue with relevant logs and context