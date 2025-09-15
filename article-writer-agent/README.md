# AI Article Writer Agent

A TypeScript-based AI agent for generating high-quality articles using predefined topic configurations. Built with NestJS, LangChain.js, and support for multiple LLM providers.

## Features

- **Config-Driven Generation**: All article parameters defined in versioned topic configurations
- **Multi-Model Support**: OpenAI (GPT-4, GPT-3.5), Anthropic (Claude 3), Azure OpenAI
- **Research Integration**: DuckDuckGo search with domain filtering and freshness controls
- **SEO Optimization**: Keyword density management, meta descriptions, link suggestions
- **Multiple Export Formats**: Markdown, HTML, JSON with full metadata
- **Version Governance**: Strict version pinning, immutable run logs, audit trails
- **File-Based Storage**: Organized storage with metadata and run history

## Architecture

```
Topic Selection → Research → Outline → Draft → Refine/SEO → Export & Store
```

### Components

- **Topic Loader**: Loads and validates topic configurations from JSON files or API
- **Research Agent**: Conducts web research using DuckDuckGo
- **Outline Agent**: Generates structured article outlines
- **Draft Agent**: Writes article content section by section
- **Refine/SEO Agent**: Polishes content and optimizes for SEO
- **Exporter**: Converts articles to multiple formats
- **Storage Service**: Manages file storage and logging
- **Orchestrator**: Coordinates the entire pipeline

## Installation

```bash
# Install dependencies
npm install

# Copy and configure environment variables
cp .env.example .env
# Edit .env with your API keys
```

## Configuration

### Environment Variables

```env
# Required for LLM functionality
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...

# Optional
AZURE_OPENAI_API_KEY=...
TOPIC_API_URL=http://localhost:3001/api/topics
STORAGE_BASE_DIR=./storage
```

### Topic Configuration

Topics are defined in JSON files with the following structure:

```json
{
  "id": "topic-id",
  "version": "1.0.0",
  "status": "active",
  "title": "Article Title",
  "audience": "developers",
  "tone": "professional",
  "reading_level": "B2",
  "length": "1200-1500",
  "models": {
    "outline": "gpt-4o",
    "draft": "gpt-4o",
    "refine": "gpt-4o"
  },
  "research": {
    "enabled": true,
    "sources": ["duckduckgo"],
    "min_sources": 3
  },
  "outline": {
    "required_sections": ["Introduction", "Conclusion"]
  },
  "seo": {
    "keywords": ["keyword1", "keyword2"],
    "keyword_density": "1-2%"
  },
  "output": {
    "formats": ["md", "html", "json"]
  }
}
```

## Usage

### Start the Server

```bash
# Development
npm run start:dev

# Production
npm run build
npm run start:prod
```

### API Endpoints

#### Generate Article

```bash
POST /api/articles/generate
{
  "topicSource": "file",
  "topicPath": "topics/gen-ui-2025.json",
  "skipResearch": false,
  "skipRefinement": false
}
```

#### Stream Generation Progress

```bash
GET /api/articles/generate/stream?topicSource=file&topicPath=topics/gen-ui-2025.json
```

#### Get Article

```bash
GET /api/articles/{articleId}
```

#### List Articles

```bash
GET /api/articles?topic_id=gen-ui-2025&date_from=2025-01-01
```

#### Load Topic Configuration

```bash
POST /api/topics/load
{
  "source": "file",
  "path": "topics/gen-ui-2025.json"
}
```

#### Get Run Logs

```bash
GET /api/runs?topic_id=gen-ui-2025&status=completed
```

#### Get Statistics

```bash
GET /api/stats/generation
GET /api/stats/storage
```

#### Health Check

```bash
GET /api/health
```

## Storage Structure

```
storage/
├── articles/
│   └── 2025/
│       └── 01/
│           └── gen-ui-2025-{article-id}/
│               ├── article.md
│               ├── article.html
│               ├── article.json
│               └── metadata.json
├── logs/
│   └── 2025-01-15/
│       ├── {run-id}.json
│       └── daily.jsonl
├── metadata/
└── article-index.json
```

## Development

### Project Structure

```
src/
├── agents/           # AI agents for each pipeline stage
│   ├── research/
│   ├── outline/
│   ├── draft/
│   └── refine/
├── controllers/      # REST API endpoints
├── schemas/          # Zod validation schemas
├── services/         # Core services
│   ├── topic-loader/
│   ├── exporter/
│   ├── storage/
│   └── orchestrator/
└── app.module.ts     # Main NestJS module
```

### Testing

```bash
# Unit tests
npm run test

# E2E tests
npm run test:e2e

# Test coverage
npm run test:cov
```

### Adding New Models

To add support for new LLM providers:

1. Install the provider's SDK
2. Update the model initialization in the respective agent
3. Add environment variables for API keys
4. Update the health check endpoint

## Governance

### Version Pinning

- All topic configurations must specify exact versions (e.g., "1.0.0")
- No wildcards or "latest" versions allowed in production
- Each run is logged with the exact topic version used

### Audit Logging

- Every article generation creates an immutable run log
- Logs include all parameters, models used, and timestamps
- Failed runs are logged with error details

### Rollback Support

Previous topic versions remain accessible through:
- File-based: Keep old JSON files
- API-based: Query specific versions

## Performance

- **Outline Generation**: < 10 seconds
- **Draft Writing**: Streaming output available
- **Full Pipeline**: 1-3 minutes for 1500-word article
- **Parallel Processing**: Multiple articles can be generated simultaneously

## Troubleshooting

### Common Issues

1. **No LLM models available**
   - Ensure API keys are set in `.env`
   - Check API key validity

2. **Research failing**
   - DuckDuckGo may be rate-limited
   - Check network connectivity
   - Verify allowlist domains are accessible

3. **Storage errors**
   - Ensure write permissions for storage directory
   - Check disk space availability

4. **Version pinning errors**
   - Remove any "latest" or wildcard versions
   - Use semantic versioning (X.Y.Z format)

## Roadmap

- [ ] Add support for more LLM providers (Gemini, Cohere)
- [ ] Implement caching for research results
- [ ] Add image generation capabilities
- [ ] Support for multi-language articles
- [ ] Real-time collaboration features
- [ ] Advanced analytics dashboard
- [ ] Webhook notifications for completed articles
- [ ] Batch processing for multiple topics

## License

MIT

## Contributing

1. Fork the repository
2. Create a feature branch
3. Commit your changes
4. Push to the branch
5. Create a Pull Request

## Support

For issues and questions, please create an issue in the repository.