import { Injectable, Logger } from '@nestjs/common';
import { TopicLoaderService } from '../topic-loader/topic-loader.service';
import { ResearchAgent } from '../../agents/research/research.agent';
import { OutlineAgent } from '../../agents/outline/outline.agent';
import { DraftAgent } from '../../agents/draft/draft.agent';
import { RefineSEOAgent } from '../../agents/refine/refine-seo.agent';
import { ExporterService } from '../exporter/exporter.service';
import { StorageService } from '../storage/storage.service';
import { TopicConfig } from '../../schemas/topic-config.schema';
import { Article, RunMetadata, Citation } from '../../schemas/article.schema';
import { v4 as uuidv4 } from 'uuid';

export interface GenerationOptions {
  topicSource: 'file' | 'api';
  topicPath?: string;
  topicId?: string;
  topicVersion?: string;
  apiUrl?: string;
  skipResearch?: boolean;
  skipRefinement?: boolean;
  streamProgress?: boolean;
}

export interface GenerationProgress {
  stage: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  message?: string;
  progress?: number;
  data?: any;
}

@Injectable()
export class OrchestratorService {
  private readonly logger = new Logger(OrchestratorService.name);

  constructor(
    private readonly topicLoader: TopicLoaderService,
    private readonly researchAgent: ResearchAgent,
    private readonly outlineAgent: OutlineAgent,
    private readonly draftAgent: DraftAgent,
    private readonly refineSEOAgent: RefineSEOAgent,
    private readonly exporter: ExporterService,
    private readonly storage: StorageService,
  ) {}

  /**
   * Main orchestration method for article generation
   */
  async generateArticle(
    options: GenerationOptions,
    progressCallback?: (progress: GenerationProgress) => void
  ): Promise<Article> {
    const runId = uuidv4();
    const startedAt = new Date().toISOString();
    
    // Initialize run metadata
    const runMetadata: RunMetadata = {
      run_id: runId,
      topic_id: '',
      topic_version: '',
      started_at: startedAt,
      status: 'running',
      stages: [],
      models_used: {},
    };

    try {
      // Stage 1: Load Topic Configuration
      const topicConfig = await this.executeStage(
        'load_topic',
        async () => this.loadTopic(options),
        runMetadata,
        progressCallback
      );

      runMetadata.topic_id = topicConfig.id;
      runMetadata.topic_version = topicConfig.version;

      // Stage 2: Research (optional)
      const citations = await this.executeStage(
        'research',
        async () => {
          if (options.skipResearch) {
            this.logger.log('Skipping research stage');
            return [];
          }
          return this.researchAgent.research(
            topicConfig.title,
            topicConfig.seo.keywords,
            topicConfig.research
          );
        },
        runMetadata,
        progressCallback,
        options.skipResearch ? 'skipped' : undefined
      );

      // Stage 3: Generate Outline
      const outline = await this.executeStage(
        'outline',
        async () => this.outlineAgent.generateOutline(topicConfig, citations),
        runMetadata,
        progressCallback
      );

      runMetadata.models_used.outline = topicConfig.models.outline;

      // Stage 4: Generate Draft
      const draftSections = await this.executeStage(
        'draft',
        async () => this.draftAgent.generateDraft(outline, topicConfig, citations),
        runMetadata,
        progressCallback
      );

      runMetadata.models_used.draft = topicConfig.models.draft;

      // Stage 5: Refine and SEO Optimize (optional)
      const { sections, seoMetadata } = await this.executeStage(
        'refine_seo',
        async () => {
          if (options.skipRefinement) {
            this.logger.log('Skipping refinement stage');
            return {
              sections: draftSections,
              seoMetadata: await this.generateBasicSEOMetadata(topicConfig, draftSections),
            };
          }
          return this.refineSEOAgent.refineAndOptimize(draftSections, topicConfig);
        },
        runMetadata,
        progressCallback,
        options.skipRefinement ? 'skipped' : undefined
      );

      if (!options.skipRefinement) {
        runMetadata.models_used.refine = topicConfig.models.refine;
      }

      // Create Article object
      const article: Article = {
        id: uuidv4(),
        topic_id: topicConfig.id,
        topic_version: topicConfig.version,
        title: outline.title,
        sections,
        citations,
        seo_metadata: seoMetadata,
        word_count: sections.reduce((sum, s) => sum + s.word_count, 0),
        reading_time_minutes: Math.ceil(
          sections.reduce((sum, s) => sum + s.word_count, 0) / 200
        ),
        created_at: startedAt,
        updated_at: new Date().toISOString(),
      };

      // Stage 6: Export Article
      const exports = await this.executeStage(
        'export',
        async () => this.exporter.exportArticle(article, topicConfig.output),
        runMetadata,
        progressCallback
      );

      // Stage 7: Store Article
      const storageResult = await this.executeStage(
        'storage',
        async () => this.storage.storeArticle(article, exports, runMetadata),
        runMetadata,
        progressCallback
      );

      // Update run metadata with output files
      runMetadata.output_files = storageResult.files;
      runMetadata.completed_at = new Date().toISOString();
      runMetadata.status = 'completed';

      // Store final run metadata
      await this.storage.storeRunLog(runMetadata);

      this.logger.log(`Article generation completed: ${article.id}`);
      
      if (progressCallback) {
        progressCallback({
          stage: 'complete',
          status: 'completed',
          message: 'Article generation completed successfully',
          data: { articleId: article.id, files: storageResult.files },
        });
      }

      return article;

    } catch (error) {
      runMetadata.status = 'failed';
      runMetadata.error = error.message;
      runMetadata.completed_at = new Date().toISOString();
      
      await this.storage.storeRunLog(runMetadata);
      
      this.logger.error(`Article generation failed: ${error.message}`, error.stack);
      
      if (progressCallback) {
        progressCallback({
          stage: 'error',
          status: 'failed',
          message: error.message,
        });
      }
      
      throw error;
    }
  }

  /**
   * Execute a stage with error handling and progress reporting
   */
  private async executeStage<T>(
    stageName: string,
    stageFunction: () => Promise<T>,
    runMetadata: RunMetadata,
    progressCallback?: (progress: GenerationProgress) => void,
    skipStatus?: 'skipped'
  ): Promise<T> {
    const stage = {
      name: stageName,
      status: skipStatus || 'running' as any,
      started_at: new Date().toISOString(),
    };

    runMetadata.stages.push(stage);

    if (progressCallback) {
      progressCallback({
        stage: stageName,
        status: stage.status,
        message: skipStatus ? `Skipping ${stageName}` : `Starting ${stageName}...`,
      });
    }

    if (skipStatus === 'skipped') {
      stage.status = 'skipped';
      stage.completed_at = new Date().toISOString();
      return null as any;
    }

    try {
      this.logger.log(`Starting stage: ${stageName}`);
      const result = await stageFunction();
      
      stage.status = 'completed';
      stage.completed_at = new Date().toISOString();
      
      if (progressCallback) {
        progressCallback({
          stage: stageName,
          status: 'completed',
          message: `Completed ${stageName}`,
          progress: 100,
        });
      }
      
      this.logger.log(`Completed stage: ${stageName}`);
      return result;
      
    } catch (error) {
      stage.status = 'failed';
      stage.completed_at = new Date().toISOString();
      stage.error = error.message;
      
      if (progressCallback) {
        progressCallback({
          stage: stageName,
          status: 'failed',
          message: `Failed ${stageName}: ${error.message}`,
        });
      }
      
      this.logger.error(`Failed stage ${stageName}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Load topic configuration based on options
   */
  private async loadTopic(options: GenerationOptions): Promise<TopicConfig> {
    if (options.topicSource === 'file') {
      if (!options.topicPath) {
        throw new Error('Topic path is required for file source');
      }
      return this.topicLoader.loadFromFile(options.topicPath);
    } else {
      if (!options.topicId || !options.topicVersion) {
        throw new Error('Topic ID and version are required for API source');
      }
      return this.topicLoader.loadFromAPI(
        options.topicId,
        options.topicVersion,
        options.apiUrl
      );
    }
  }

  /**
   * Generate basic SEO metadata when refinement is skipped
   */
  private async generateBasicSEOMetadata(
    config: TopicConfig,
    sections: any[]
  ): Promise<any> {
    const fullContent = sections.map(s => s.content).join(' ');
    const wordCount = fullContent.split(/\s+/).length;

    return {
      title: config.title.substring(0, 60),
      meta_description: `${config.description || config.title}. ${config.seo.keywords.join(', ')}.`.substring(0, 160),
      keywords: config.seo.keywords,
      keyword_density: config.seo.keywords.reduce((acc, keyword) => {
        const regex = new RegExp(keyword, 'gi');
        const matches = fullContent.match(regex) || [];
        acc[keyword] = (matches.length / wordCount) * 100;
        return acc;
      }, {} as Record<string, number>),
    };
  }

  /**
   * Stream article generation with real-time updates
   */
  async *streamGenerateArticle(
    options: GenerationOptions
  ): AsyncGenerator<GenerationProgress> {
    const stages = [
      'load_topic',
      'research',
      'outline',
      'draft',
      'refine_seo',
      'export',
      'storage',
    ];

    for (const stage of stages) {
      yield {
        stage,
        status: 'pending',
        message: `Preparing ${stage}...`,
      };
    }

    // Use callback-based generation with yield
    const progressUpdates: GenerationProgress[] = [];
    
    const article = await this.generateArticle(options, (progress) => {
      progressUpdates.push(progress);
    });

    for (const update of progressUpdates) {
      yield update;
    }
  }

  /**
   * Validate topic configuration before generation
   */
  async validateTopicConfig(config: TopicConfig): Promise<{
    valid: boolean;
    errors: string[];
    warnings: string[];
  }> {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Check version pinning
    if (config.version === 'latest' || config.version.includes('*')) {
      errors.push('Version must be pinned (no "latest" or wildcards)');
    }

    // Check status
    if (config.status === 'deprecated') {
      warnings.push('Topic is marked as deprecated');
    }

    // Check model availability
    const models = [config.models.outline, config.models.draft, config.models.refine];
    for (const model of models) {
      if (!this.isModelAvailable(model)) {
        warnings.push(`Model ${model} may not be available`);
      }
    }

    // Check required sections
    if (config.outline.required_sections.length === 0) {
      warnings.push('No required sections defined');
    }

    // Check SEO configuration
    if (config.seo.keywords.length === 0) {
      warnings.push('No SEO keywords defined');
    }

    // Check length configuration
    const [minLength, maxLength] = config.length.split('-').map(Number);
    if (maxLength - minLength < 100) {
      warnings.push('Length range is very narrow, may be difficult to achieve');
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * Check if a model is available
   */
  private isModelAvailable(modelName: string): boolean {
    // Check for API keys based on model name
    if (modelName.includes('gpt')) {
      return !!process.env.OPENAI_API_KEY;
    }
    if (modelName.includes('claude') || modelName.includes('anthropic')) {
      return !!process.env.ANTHROPIC_API_KEY;
    }
    if (modelName.includes('azure')) {
      return !!process.env.AZURE_OPENAI_API_KEY;
    }
    return false;
  }

  /**
   * Get generation statistics
   */
  async getGenerationStats(): Promise<{
    totalRuns: number;
    successfulRuns: number;
    failedRuns: number;
    averageDuration: number;
    byTopic: Record<string, number>;
  }> {
    const logs = await this.storage.getRunLogs();
    
    const stats = {
      totalRuns: logs.length,
      successfulRuns: logs.filter(l => l.status === 'completed').length,
      failedRuns: logs.filter(l => l.status === 'failed').length,
      averageDuration: 0,
      byTopic: {} as Record<string, number>,
    };

    let totalDuration = 0;
    let durationCount = 0;

    for (const log of logs) {
      // Count by topic
      stats.byTopic[log.topic_id] = (stats.byTopic[log.topic_id] || 0) + 1;
      
      // Calculate duration
      if (log.completed_at && log.started_at) {
        const duration = new Date(log.completed_at).getTime() - new Date(log.started_at).getTime();
        totalDuration += duration;
        durationCount++;
      }
    }

    if (durationCount > 0) {
      stats.averageDuration = totalDuration / durationCount / 1000; // Convert to seconds
    }

    return stats;
  }
}