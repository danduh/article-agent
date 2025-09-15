import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Query,
  HttpException,
  HttpStatus,
  Sse,
  MessageEvent,
} from '@nestjs/common';
import { Observable, interval, map } from 'rxjs';
import { OrchestratorService, GenerationOptions } from '../services/orchestrator/orchestrator.service';
import { TopicLoaderService } from '../services/topic-loader/topic-loader.service';
import { StorageService } from '../services/storage/storage.service';
import { TopicConfig } from '../schemas/topic-config.schema';

interface GenerateArticleDto {
  topicSource: 'file' | 'api';
  topicPath?: string;
  topicId?: string;
  topicVersion?: string;
  apiUrl?: string;
  skipResearch?: boolean;
  skipRefinement?: boolean;
}

interface LoadTopicDto {
  source: 'file' | 'api';
  path?: string;
  id?: string;
  version?: string;
  apiUrl?: string;
}

@Controller('api')
export class ArticleController {
  constructor(
    private readonly orchestrator: OrchestratorService,
    private readonly topicLoader: TopicLoaderService,
    private readonly storage: StorageService,
  ) {}

  /**
   * Generate a new article
   */
  @Post('articles/generate')
  async generateArticle(@Body() dto: GenerateArticleDto) {
    try {
      const options: GenerationOptions = {
        topicSource: dto.topicSource,
        topicPath: dto.topicPath,
        topicId: dto.topicId,
        topicVersion: dto.topicVersion,
        apiUrl: dto.apiUrl,
        skipResearch: dto.skipResearch,
        skipRefinement: dto.skipRefinement,
      };

      const article = await this.orchestrator.generateArticle(options);
      
      return {
        success: true,
        article: {
          id: article.id,
          title: article.title,
          topic_id: article.topic_id,
          topic_version: article.topic_version,
          word_count: article.word_count,
          reading_time_minutes: article.reading_time_minutes,
          created_at: article.created_at,
        },
      };
    } catch (error) {
      throw new HttpException(
        {
          success: false,
          error: error.message,
        },
        HttpStatus.BAD_REQUEST
      );
    }
  }

  /**
   * Stream article generation progress
   */
  @Sse('articles/generate/stream')
  async streamGenerateArticle(@Query() query: GenerateArticleDto): Promise<Observable<MessageEvent>> {
    const options: GenerationOptions = {
      topicSource: query.topicSource,
      topicPath: query.topicPath,
      topicId: query.topicId,
      topicVersion: query.topicVersion,
      apiUrl: query.apiUrl,
      skipResearch: query.skipResearch,
      skipRefinement: query.skipRefinement,
      streamProgress: true,
    };

    // Create an async generator to stream progress
    const generator = this.orchestrator.streamGenerateArticle(options);
    
    // Convert to Observable for SSE
    return new Observable(subscriber => {
      (async () => {
        try {
          for await (const progress of generator) {
            subscriber.next({
              data: progress,
            });
          }
          subscriber.complete();
        } catch (error) {
          subscriber.error(error);
        }
      })();
    });
  }

  /**
   * Get article by ID
   */
  @Get('articles/:id')
  async getArticle(@Param('id') id: string) {
    const article = await this.storage.retrieveArticle(id);
    
    if (!article) {
      throw new HttpException(
        {
          success: false,
          error: 'Article not found',
        },
        HttpStatus.NOT_FOUND
      );
    }

    return {
      success: true,
      article: article.metadata,
      files: article.files,
    };
  }

  /**
   * List all articles
   */
  @Get('articles')
  async listArticles(
    @Query('topic_id') topicId?: string,
    @Query('topic_version') topicVersion?: string,
    @Query('date_from') dateFrom?: string,
    @Query('date_to') dateTo?: string,
  ) {
    const articles = await this.storage.listArticles({
      topic_id: topicId,
      topic_version: topicVersion,
      date_from: dateFrom,
      date_to: dateTo,
    });

    return {
      success: true,
      articles,
      count: articles.length,
    };
  }

  /**
   * Load and validate a topic configuration
   */
  @Post('topics/load')
  async loadTopic(@Body() dto: LoadTopicDto) {
    try {
      let topic: TopicConfig;
      
      if (dto.source === 'file') {
        if (!dto.path) {
          throw new Error('Path is required for file source');
        }
        topic = await this.topicLoader.loadFromFile(dto.path);
      } else {
        if (!dto.id || !dto.version) {
          throw new Error('ID and version are required for API source');
        }
        topic = await this.topicLoader.loadFromAPI(dto.id, dto.version, dto.apiUrl);
      }

      const validation = await this.orchestrator.validateTopicConfig(topic);

      return {
        success: true,
        topic,
        validation,
      };
    } catch (error) {
      throw new HttpException(
        {
          success: false,
          error: error.message,
        },
        HttpStatus.BAD_REQUEST
      );
    }
  }

  /**
   * List topics from a directory
   */
  @Get('topics/list')
  async listTopics(@Query('directory') directory: string = 'topics') {
    try {
      const topics = await this.topicLoader.loadFromDirectory(directory);
      
      return {
        success: true,
        topics: topics.map(t => ({
          id: t.id,
          version: t.version,
          title: t.title,
          status: t.status,
          audience: t.audience,
        })),
        count: topics.length,
      };
    } catch (error) {
      throw new HttpException(
        {
          success: false,
          error: error.message,
        },
        HttpStatus.BAD_REQUEST
      );
    }
  }

  /**
   * Get cached topics
   */
  @Get('topics/cached')
  async getCachedTopics() {
    const topics = this.topicLoader.listCached();
    
    return {
      success: true,
      topics: topics.map(t => ({
        id: t.id,
        version: t.version,
        title: t.title,
        status: t.status,
      })),
      count: topics.length,
    };
  }

  /**
   * Get run logs
   */
  @Get('runs')
  async getRunLogs(
    @Query('run_id') runId?: string,
    @Query('topic_id') topicId?: string,
    @Query('date') date?: string,
    @Query('status') status?: string,
  ) {
    const logs = await this.storage.getRunLogs({
      run_id: runId,
      topic_id: topicId,
      date,
      status,
    });

    return {
      success: true,
      logs,
      count: logs.length,
    };
  }

  /**
   * Get generation statistics
   */
  @Get('stats/generation')
  async getGenerationStats() {
    const stats = await this.orchestrator.getGenerationStats();
    
    return {
      success: true,
      stats,
    };
  }

  /**
   * Get storage statistics
   */
  @Get('stats/storage')
  async getStorageStats() {
    const stats = await this.storage.getStorageStats();
    
    return {
      success: true,
      stats,
    };
  }

  /**
   * Clean up old files
   */
  @Post('maintenance/cleanup')
  async cleanupOldFiles(@Body('days_to_keep') daysToKeep: number = 30) {
    const deletedCount = await this.storage.cleanupOldFiles(daysToKeep);
    
    return {
      success: true,
      deleted_count: deletedCount,
    };
  }

  /**
   * Health check
   */
  @Get('health')
  async healthCheck() {
    const checks = {
      api: true,
      openai: !!process.env.OPENAI_API_KEY,
      anthropic: !!process.env.ANTHROPIC_API_KEY,
      azure: !!process.env.AZURE_OPENAI_API_KEY,
      storage: await this.checkStorageHealth(),
    };

    const healthy = Object.values(checks).every(v => v === true);

    return {
      success: true,
      healthy,
      checks,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Check storage health
   */
  private async checkStorageHealth(): Promise<boolean> {
    try {
      await this.storage.getStorageStats();
      return true;
    } catch (error) {
      return false;
    }
  }
}