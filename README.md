# AI Agent for Article Writing

A TypeScript-based AI agent that generates full articles based on predefined topics. The system follows a config-driven approach with strict version pinning and governance controls.

## 🚀 Features

- **Config-Driven Topics**: All writing instructions come from JSON configurations
- **Multi-Stage Pipeline**: Research → Outline → Draft → Refine/SEO → Export
- **Multi-Model Support**: OpenAI, Anthropic, and Azure AI models
- **Web Research**: Automated research using DuckDuckGo search
- **SEO Optimization**: Built-in SEO analysis and optimization
- **Version Governance**: Strict version pinning with audit trails
- **Multiple Export Formats**: Markdown, HTML, and JSON output
- **File-Based Storage**: Simple, reliable file storage system

## 📋 Architecture

```
Topic Selection → Research → Outline → Draft → Refine/SEO → Export & Store
      ↓              ↓          ↓        ↓         ↓           ↓
   JSON/API    DuckDuckGo   AI Model  AI Model  AI Model   MD/HTML/JSON
```

## 🛠 Installation

1. **Clone and Install Dependencies**
   ```bash
   npm install
   ```

2. **Configure Environment**
   ```bash
   cp .env.example .env
   # Edit .env with your API keys
   ```

3. **Set Up API Keys**
   ```bash
   # Required: At least one AI provider
   OPENAI_API_KEY=your_openai_key
   ANTHROPIC_API_KEY=your_anthropic_key
   
   # Optional: Azure OpenAI
   AZURE_OPENAI_API_KEY=your_azure_key
   AZURE_OPENAI_ENDPOINT=your_azure_endpoint
   ```

4. **Build and Start**
   ```bash
   npm run build
   npm run start
   ```

   For development:
   ```bash
   npm run start:dev
   ```

## 🎯 Quick Start

1. **Check Available Topics**
   ```bash
   curl http://localhost:3000/topics
   ```

2. **Generate an Article**
   ```bash
   curl -X POST http://localhost:3000/articles/generate \
     -H "Content-Type: application/json" \
     -d '{
       "topicId": "gen-ui-2025",
       "version": "1.0.0"
     }'
   ```

3. **Monitor Progress**
   ```bash
   curl http://localhost:3000/articles/runs/{runId}/status
   ```

4. **Get the Article**
   ```bash
   curl http://localhost:3000/articles/{articleId}
   ```

## 📝 Topic Configuration

Topics are defined in JSON files with comprehensive configuration:

```json
{
  "id": "example-topic",
  "version": "1.0.0",
  "title": "Article Title",
  "audience": "developers",
  "tone": "professional",
  "length": "1200-1500",
  "models": {
    "outline": "gpt-4o",
    "draft": "anthropic/claude-3-5-sonnet",
    "refine": "gpt-4o"
  },
  "research": {
    "enabled": true,
    "sources": ["duckduckgo"],
    "min_sources": 3
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

## 🔧 API Endpoints

### Topics
- `GET /topics` - List all topics
- `GET /topics/:id?version=x.x.x` - Get specific topic
- `GET /topics/:id/versions` - Get all versions

### Article Generation
- `POST /articles/generate` - Start article generation
- `GET /articles/runs/:runId` - Get generation run details
- `GET /articles/runs/:runId/status` - Get generation status

### Articles
- `GET /articles` - List generated articles
- `GET /articles/:id` - Get specific article
- `GET /articles/:id/export/:format` - Export article

### Governance
- `POST /governance/pin` - Pin topic version
- `POST /governance/rollback` - Rollback to previous version
- `GET /governance/audit/:topicId` - Get audit trail

## 🏗 Project Structure

```
src/
├── agents/           # AI agents for each stage
│   ├── research.agent.ts
│   ├── outline.agent.ts
│   ├── draft.agent.ts
│   └── seo-refine.agent.ts
├── services/         # Core services
│   ├── topic-loader.service.ts
│   ├── article-orchestrator.service.ts
│   ├── storage.service.ts
│   ├── exporter.service.ts
│   └── governance.service.ts
├── schemas/          # Zod validation schemas
│   ├── topic-config.schema.ts
│   └── article.schema.ts
└── app.module.ts     # NestJS module
```

## 🔒 Governance & Version Control

### Version Pinning
```bash
# Pin a specific version
curl -X POST http://localhost:3000/governance/pin \
  -d '{"topicId": "example", "version": "1.0.0", "reason": "Stable release"}'
```

### Audit Trail
```bash
# Get complete audit trail
curl http://localhost:3000/governance/audit/example-topic
```

### Rollback
```bash
# Rollback to previous version
curl -X POST http://localhost:3000/governance/rollback \
  -d '{"topicId": "example", "toVersion": "1.0.0", "reason": "Bug fix"}'
```

## 🧪 Development

### Adding New Models
1. Update the agent's `initializeModels()` method
2. Add model configuration to topic schema
3. Test with a sample topic

### Creating Custom Agents
1. Extend the base agent pattern
2. Implement required methods
3. Add to orchestrator pipeline

### Custom Export Formats
1. Add format to `ExportFormat` type
2. Implement export method in `ExporterService`
3. Update topic output configuration

## 📊 Monitoring & Logging

- **Generation Logs**: `./logs/`
- **Article Storage**: `./storage/articles/`
- **Run History**: `./storage/runs/`
- **Governance Records**: `./storage/governance/`

## 🚨 Production Considerations

1. **API Keys**: Store securely, rotate regularly
2. **Rate Limits**: Implement proper rate limiting
3. **Storage**: Consider database for large-scale usage
4. **Monitoring**: Add proper logging and metrics
5. **Backup**: Regular backup of storage directory

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## 📄 License

ISC License - see LICENSE file for details

## 🆘 Support

- Check the logs in `./logs/` for errors
- Verify API keys are correctly configured
- Ensure topic configurations are valid JSON
- Review governance audit trails for version issues

## 🔮 Roadmap

- [ ] Database storage backend
- [ ] Web UI for topic management
- [ ] Advanced analytics and reporting
- [ ] Integration with CMS platforms
- [ ] Multi-language support
- [ ] Custom AI model fine-tuning