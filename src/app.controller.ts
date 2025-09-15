import { Controller, Get, Post, Param, Body, Query, Logger, BadRequestException } from '@nestjs/common';
import { TopicLoaderService } from './services/topic-loader.service';
import { ArticleOrchestrator } from './services/article-orchestrator.service';
import { StorageService } from './services/storage.service';
import { TopicConfig, TopicList } from './schemas/topic-config.schema';
import { Article, ArticleRun } from './schemas/article.schema';

export interface GenerateArticleRequest {
  topicId: string;
  version: string;
  options?: {
    skipResearch?: boolean;
    dryRun?: boolean;
    saveOutput?: boolean;
  };
}

@Controller()
export class AppController {
  private readonly logger = new Logger(AppController.name);

  constructor(
    private readonly topicLoader: TopicLoaderService,
    private readonly orchestrator: ArticleOrchestrator,
    private readonly storage: StorageService,
  ) {}

  @Get('health')
  getHealth() {
    return { 
      status: 'ok', 
      timestamp: new Date().toISOString(),
      service: 'article-agent' 
    };
  }

  @Get('topics')
  async listTopics(
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ): Promise<TopicList> {
    this.logger.log(`Listing topics (page: ${page}, limit: ${limit})`);
    return this.topicLoader.listTopics(page, limit);
  }

  @Get('topics/:topicId')
  async getTopic(
    @Param('topicId') topicId: string,
    @Query('version') version?: string,
  ): Promise<TopicConfig> {
    if (!version) {
      throw new BadRequestException('Version parameter is required');
    }
    
    this.logger.log(`Getting topic: ${topicId}@${version}`);
    return this.topicLoader.loadTopic(topicId, version);
  }

  @Get('topics/:topicId/versions')
  async getTopicVersions(@Param('topicId') topicId: string): Promise<{ versions: string[] }> {
    this.logger.log(`Getting versions for topic: ${topicId}`);
    const versions = await this.topicLoader.getTopicVersions(topicId);
    return { versions };
  }

  @Post('articles/generate')
  async generateArticle(@Body() request: GenerateArticleRequest): Promise<{ runId: string }> {
    this.logger.log(`Starting article generation for ${request.topicId}@${request.version}`);
    
    if (!request.topicId || !request.version) {
      throw new BadRequestException('topicId and version are required');
    }

    if (request.version === 'latest') {
      throw new BadRequestException('Version "latest" is not allowed. Please specify an exact version.');
    }

    const runId = await this.orchestrator.generateArticle(
      request.topicId,
      request.version,
      request.options || {}
    );

    return { runId };
  }

  @Get('articles/runs/:runId')
  async getArticleRun(@Param('runId') runId: string): Promise<ArticleRun> {
    this.logger.log(`Getting article run: ${runId}`);
    return this.storage.getArticleRun(runId);
  }

  @Get('articles/runs/:runId/status')
  async getArticleRunStatus(@Param('runId') runId: string): Promise<{ 
    runId: string; 
    status: string; 
    currentStage?: string;
    progress?: number;
  }> {
    this.logger.log(`Getting status for run: ${runId}`);
    const run = await this.storage.getArticleRun(runId);
    
    const completedStages = run.stages.filter(s => s.status === 'completed').length;
    const totalStages = run.stages.length;
    const progress = totalStages > 0 ? (completedStages / totalStages) * 100 : 0;
    
    const currentStage = run.stages.find(s => s.status === 'in_progress')?.stage;

    return {
      runId: run.id,
      status: run.status,
      currentStage,
      progress: Math.round(progress),
    };
  }

  @Get('articles/:articleId')
  async getArticle(@Param('articleId') articleId: string): Promise<Article> {
    this.logger.log(`Getting article: ${articleId}`);
    return this.storage.getArticle(articleId);
  }

  @Get('articles')
  async listArticles(
    @Query('topicId') topicId?: string,
    @Query('status') status?: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ): Promise<{ articles: Article[]; total: number }> {
    this.logger.log(`Listing articles (topicId: ${topicId}, status: ${status})`);
    return this.storage.listArticles({ topicId, status }, page, limit);
  }

  @Get('articles/:articleId/export/:format')
  async exportArticle(
    @Param('articleId') articleId: string,
    @Param('format') format: 'md' | 'html' | 'json',
  ): Promise<{ content: string; filename: string }> {
    this.logger.log(`Exporting article ${articleId} as ${format}`);
    
    const article = await this.storage.getArticle(articleId);
    const exporterService = new (await import('./services/exporter.service')).ExporterService();
    
    const content = await exporterService.exportArticle(article, format);
    const filename = `${article.topic_id}-${article.id}.${format}`;
    
    return { content, filename };
  }

  @Post('articles/:articleId/regenerate')
  async regenerateArticle(
    @Param('articleId') articleId: string,
    @Body() options?: { stages?: string[] }
  ): Promise<{ runId: string }> {
    this.logger.log(`Regenerating article: ${articleId}`);
    
    const article = await this.storage.getArticle(articleId);
    const runId = await this.orchestrator.regenerateArticle(
      articleId, 
      article.topic_id, 
      article.topic_version,
      options?.stages
    );

    return { runId };
  }
}