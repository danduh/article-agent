# Docker Build and Deployment Workflows

This directory contains GitHub Actions workflows for building and deploying Docker images for the backend services in this monorepo.

## Available Workflows

### 1. `docker_mngapi.yml` - Management API Service
Builds and deploys the `mngapi` service (PostgreSQL-based management API).

### 2. `docker_promptapi.yml` - Prompt API Service  
Builds and deploys the `promptapi` service (MongoDB-based prompt management API).

### 3. `docker_multi_service.yml` - Multi-Service Deployment
Builds and deploys both services in a single workflow with intelligent change detection.

## Workflow Features

### 🚀 Automatic Triggers
- **Push to main**: Automatically builds when changes are detected in relevant service directories
- **Manual dispatch**: Trigger builds manually with custom parameters
- **Path-based filtering**: Only builds services that have actual changes

### 🏷️ Smart Tagging Strategy
Each Docker image gets multiple tags for flexibility:
- `{environment}-{build_number}` - Primary deployment tag
- `{environment}-latest` - Latest version for environment
- `{commit_hash}` - Specific commit reference
- `{timestamp}` - Build timestamp for auditing

### 🧪 Built-in Testing
- **Unit tests**: Runs `npx nx test {service}` before building
- **Linting**: Runs `npx nx lint {service}` for code quality
- **Smoke tests**: Verifies Docker container can start successfully
- **Security scanning**: Trivy vulnerability scanning for production builds

### 🏗️ Build Process
1. **Setup**: Node.js 20, npm cache, dependencies installation
2. **Quality Gates**: Tests and linting must pass
3. **Build**: Uses Nx to build the application with production optimizations
4. **Docker**: Multi-platform build (linux/amd64) using buildx
5. **Push**: Pushes to AWS ECR with multiple tags
6. **Verify**: Basic container startup test

## Usage

### Manual Deployment

#### Single Service
```bash
# Deploy mngapi to development
gh workflow run docker_mngapi.yml -f environment=dev

# Deploy promptapi to production with custom tag
gh workflow run docker_promptapi.yml -f environment=prod -f tag=v2.1.0
```

#### Multi-Service
```bash
# Deploy all services to staging
gh workflow run docker_multi_service.yml -f environment=staging

# Deploy only mngapi to production
gh workflow run docker_multi_service.yml -f services=mngapi -f environment=prod

# Force build both services (ignore change detection)
gh workflow run docker_multi_service.yml -f services=all -f force_build=true
```

### Automatic Deployment
Workflows automatically trigger on pushes to `main` when files change in:
- `packages/mngapi/**` (triggers mngapi build)
- `packages/promptapi/**` (triggers promptapi build)
- `packages/common/**` (triggers both)
- `package.json` or `package-lock.json` (triggers both)

## Environment Configuration

### GitHub Secrets Required
The workflows require these secrets to be configured in your repository:

```bash
AWS_ACCESS_KEY_ID       # AWS access key for ECR push
AWS_SECRET_ACCESS_KEY   # AWS secret key for ECR push
```

### Environment-Specific Variables
You can configure environment-specific variables in GitHub Environments:

- **dev**: Development environment settings
- **staging**: Staging environment settings  
- **prod**: Production environment settings (includes security scanning)

## AWS ECR Configuration

### Repository Setup
The workflows push to these ECR repositories:
- `411429114957.dkr.ecr.us-west-2.amazonaws.com/promptver/mngapi`
- `411429114957.dkr.ecr.us-west-2.amazonaws.com/promptver/promptapi`

### Authentication
Uses AWS CLI authentication via GitHub Actions:
```bash
aws ecr get-login-password --region us-west-2 | docker login --username AWS --password-stdin 411429114957.dkr.ecr.us-west-2.amazonaws.com
```

## Docker Image Usage

### Pull Latest Development Image
```bash
# mngapi
docker pull 411429114957.dkr.ecr.us-west-2.amazonaws.com/promptver/mngapi:dev-latest

# promptapi
docker pull 411429114957.dkr.ecr.us-west-2.amazonaws.com/promptver/promptapi:dev-latest
```

### Run Locally
```bash
# mngapi (PostgreSQL)
docker run -p 3100:3100 \
  -e DB_HOST=your-postgres-host \
  -e DB_USER=your-user \
  -e DB_PASS=your-password \
  411429114957.dkr.ecr.us-west-2.amazonaws.com/promptver/mngapi:dev-latest

# promptapi (MongoDB)  
docker run -p 3100:3100 \
  -e MONGODB_URI=mongodb://user:pass@host:27017/database \
  411429114957.dkr.ecr.us-west-2.amazonaws.com/promptver/promptapi:dev-latest
```

## Security

### Vulnerability Scanning
- **Trivy**: Automated security scanning on production builds
- **SARIF Upload**: Results uploaded to GitHub Security tab
- **Gated Deployments**: Failed security scans can block deployments

### Best Practices
- ✅ Multi-stage Docker builds for smaller images
- ✅ Non-root user in containers
- ✅ Minimal Alpine base images
- ✅ Secrets via environment variables
- ✅ Platform-specific builds (linux/amd64)

## Troubleshooting

### Common Issues

#### Build Failures
```bash
# Check workflow logs in GitHub Actions tab
# Common causes:
# - Test failures: Fix failing tests in the service
# - Lint errors: Run `npx nx lint {service}` locally  
# - Dependency issues: Update package.json/package-lock.json
```

#### Authentication Errors
```bash
# Verify AWS credentials in repository secrets
# Ensure ECR repositories exist and permissions are set
# Check if AWS region matches workflow configuration
```

#### Container Startup Issues
```bash
# Check Dockerfile configuration
# Verify environment variables are properly set
# Review application logs for startup errors
```

### Local Testing
Test Docker builds locally before pushing:

```bash
# Test mngapi build
docker buildx build --platform linux/amd64 -t test-mngapi -f packages/mngapi/mngapi.Dockerfile .
docker run --rm -p 3100:3100 test-mngapi

# Test promptapi build  
docker buildx build --platform linux/amd64 -t test-promptapi -f packages/promptapi/promptapi.Dockerfile .
docker run --rm -p 3100:3100 test-promptapi
```

## Next Steps

- [ ] Add health check endpoints to services
- [ ] Implement blue-green deployment strategy
- [ ] Add performance testing to pipeline
- [ ] Set up automatic rollback on deployment failures
- [ ] Add Slack/email notifications for deployment status
