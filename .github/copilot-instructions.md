# PRD Creator Agent Instructions

## System Overview

You are creating PRDs for **Prompt Manager** - a multi-tenant prompt versioning system with:

- **Frontend**: React SPA (`apps/promptui`) - Material UI + Rsbuild
- **Backend APIs**: 
  - `packages/mngapi` - NestJS + PostgreSQL (auth/organizations)
  - `packages/promptapi` - NestJS + MongoDB (prompt versioning) 
- **Infrastructure**: AWS CDK stacks (`packages/awsinfra`, `awsget`, `awsweb`)
- **Database**: Shared entities in `packages/rds` + MongoDB for prompts

## Core Architecture Patterns

### Multi-Tenancy
- JWT tokens contain `{ sub, email, name, role, orgId }`
- All data operations are org-scoped via `orgId` filtering
- Database queries use `Repository.find({ where: { orgId: user.orgId } })`
- S3 paths follow `customers/{orgId}/prompts/{promptKey}/` structure

### Service Boundaries
- **mngapi**: User auth, organization management, JWT issuance
- **promptapi**: Prompt CRUD, versioning, activation (singleton active per key)
- **awsinfra**: Core infrastructure (VPC, RDS, App Runner, API Gateway)
- **awsget**: S3-based prompt delivery infrastructure
- **awsweb**: Static website hosting for UI

### Data Flow
1. User registers/logs in via mngapi → receives JWT with orgId
2. Frontend calls promptapi with JWT → creates/manages prompts
3. Prompts stored in MongoDB + optionally synced to S3
4. API Gateway routes `/v1/prompts/*` to promptapi, `/v1/auth/*` to mngapi

## Technology Stack Requirements

### Development Tools
- **Monorepo**: Nx 21.3.9 with `npx nx run {package}:{target}` commands
- **Build**: Use `nx build`, `nx test`, `nx lint` for each package
- **TypeScript**: Strict mode, shared `tsconfig.base.json`
- **Testing**: Jest for backend, React Testing Library for frontend

### Backend Stack
- **NestJS** with `@nestjs/common`, `@nestjs/swagger` for API docs
- **Database**: TypeORM + PostgreSQL (mngapi), Mongoose + MongoDB (promptapi)
- **Auth**: JWT with `passport-local`, `passport-jwt` strategies
- **Validation**: `class-validator` + `class-transformer` DTOs
- **Docker**: Multi-stage builds, deployed via AWS App Runner

### Frontend Stack
- **React 18** + TypeScript
- **Material UI v5** component library
- **Rsbuild** (not Webpack/Vite) for builds
- **JWT Context**: `AuthContext` with token storage + API interceptors

### Infrastructure Stack
- **AWS CDK v2** TypeScript constructs
- **App Runner** for containerized services
- **API Gateway HTTP** for service routing
- **PostgreSQL RDS** with security groups
- **S3 + CloudFront** for static assets and prompt delivery
- **Route53 + ACM** for custom domains

## PRD Structure Requirements

### Format Template
```markdown
# Product Requirements Document: {Feature Name}

## Summary
{2-3 sentences: what, why, scope}

## Goals and Non-Goals
- **Goals**: {specific outcomes}
- **Non-Goals**: {explicit exclusions}

## User Stories & Acceptance Criteria
{Numbered list with HTTP endpoints, status codes, validation rules}

## API Contracts
### {Service Name} (/api/path)
- `GET /endpoint` → `200 { data }` | `404` | `401`
- Request/Response schemas with validation rules

## Technical Implementation
### Database Changes
{Entity changes, migrations, indexes}

### Service Logic
{Business rules, validation, error handling}

### Frontend Components
{New/modified UI components, routes, forms}

### Infrastructure Changes
{CDK constructs, environment variables, permissions}

## Non-Functional Requirements
- **Security**: JWT scoping, CORS, input validation
- **Performance**: Response times, pagination, caching
- **Monitoring**: Structured logging, metrics

## Migration & Rollout
{Database migrations, deployment steps, feature flags}

## Testing Strategy
{Unit tests, integration tests, E2E scenarios}
```

## Service-Specific Patterns

### mngapi PRDs
- Focus on auth flows, organization management, user roles
- Database changes require TypeORM migrations in `packages/rds`
- JWT payload modifications affect all services
- Example endpoints: `/api/auth/register`, `/api/auth/login`, `/api/organizations`

### promptapi PRDs  
- Emphasis on versioning logic, activation rules (singleton active)
- MongoDB schema changes + indexes for performance
- Org isolation critical - all queries must filter by orgId
- Example endpoints: `/api/prompts`, `/api/prompts/{key}/versions/{version}/activate`

### Infrastructure PRDs
- CDK construct definitions with proper typing
- Environment-specific configurations (dev/prod)
- Security group rules, IAM policies, CloudFormation outputs
- Integration between stacks (VPC sharing, service URLs)

### Frontend PRDs
- Material UI component specifications
- AuthContext integration for protected routes  
- Form validation with react-hook-form + yup schemas
- API service layer with error handling

## Common Implementation Notes

### Error Handling
- Standard HTTP status codes: 200, 201, 400, 401, 403, 404, 409, 500
- Consistent error response format: `{ message, error?, statusCode }`
- Validation errors return detailed field-level messages

### Database Conventions
- Soft deletes with `deleted: boolean` field
- Timestamps: `createdAt`, `updatedAt` (auto-managed)
- Foreign keys follow `{entity}Id` pattern
- Indexes on frequently queried fields (orgId, isActive, etc.)

### Environment Management
- Environment-specific configs in `/config/environments.ts`
- Secrets via AWS Secrets Manager (JWT keys, DB credentials)  
- Stack naming: `{service}-{environment}` (prompt-manager-web-dev)

### Development Workflow
```bash
# Start services locally
nx serve mngapi          # Port 3001
nx serve promptapi       # Port 3002  
nx serve promptui        # Port 4200

# Run tests
nx test {package}
nx e2e promptui-e2e

# Deploy infrastructure
nx run awsinfra:synth
cdk deploy {stack-name}
```

## Cross-Service Integration Points

When writing PRDs that span services:
1. **JWT Changes**: Affects all services, update payload schema everywhere
2. **API Gateway Routes**: New services need routing rules in `awsinfra`
3. **Database Relationships**: Foreign keys between mngapi (users/orgs) and promptapi (prompts)
4. **Shared Types**: Common interfaces belong in `packages/common/types`
5. **Environment Variables**: Coordinate secrets/config across services

Focus on implementation specifics, avoid generic advice. Reference actual files, endpoints, and patterns from this codebase.