import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { v4 as uuidv4 } from 'uuid';
import { TopicLoaderService } from './topic-loader.service';
import { StorageService } from './storage.service';
import { ResearchAgent } from '../agents/research.agent';
import { OutlineAgent } from '../agents/outline.agent';
import { DraftAgent } from '../agents/draft.agent';
import { SEORefineAgent } from '../agents/seo-refine.agent';
import { ExporterService } from './exporter.service';
import { 
  TopicConfig 
} from '../schemas/topic-config.schema';
import { 
  Article, 
  ArticleRun, 
  GenerationStage,
  ResearchResult,
  ArticleOutline,
  ArticleContent,
  SEOMetadata
} from '../schemas/article.schema';

export interface GenerationOptions {
  skipResearch?: boolean;
  dryRun?: boolean;
  saveOutput?: boolean;
  stageTimeout?: number; // Timeout per stage in ms
}

@Injectable()
export class ArticleOrchestrator {
  private readonly logger = new Logger(ArticleOrchestrator.name);
  private readonly activeRuns = new Map<string, Promise<void>>();

  constructor(
    private readonly configService: ConfigService,
    private readonly topicLoader: TopicLoaderService,
    private readonly storage: StorageService,
    private readonly researchAgent: ResearchAgent,
    private readonly outlineAgent: OutlineAgent,
    private readonly draftAgent: DraftAgent,
    private readonly seoRefineAgent: SEORefineAgent,
    private readonly exporter: ExporterService,
  ) {}

  /**
   * Generate a complete article based on topic configuration
   */
  async generateArticle(
    topicId: string, 
    version: string, 
    options: GenerationOptions = {}
  ): Promise<string> {
    const runId = uuidv4();
    this.logger.log(`Starting article generation run: ${runId} for ${topicId}@${version}`);

    // Load and validate topic configuration
    const topic = await this.topicLoader.loadTopic(topicId, version);
    
    // Create article run record
    const stages: GenerationStage[] = [
      { stage: 'research', status: 'pending' },
      { stage: 'outline', status: 'pending' },
      { stage: 'draft', status: 'pending' },
      { stage: 'refine', status: 'pending' },
      { stage: 'export', status: 'pending' },
    ];

    if (options.skipResearch) {
      stages[0].status = 'cancelled';
    }

    const articleRun: ArticleRun = {
      id: runId,
      topic_id: topicId,
      topic_version: version,
      status: 'in_progress',
      stages,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    await this.storage.saveArticleRun(articleRun);

    // Start the generation process asynchronously
    const generationPromise = this.executeGeneration(runId, topic, options);
    this.activeRuns.set(runId, generationPromise);

    // Clean up completed runs
    generationPromise.finally(() => {
      this.activeRuns.delete(runId);
    });

    return runId;
  }

  /**
   * Regenerate specific stages of an existing article
   */
  async regenerateArticle(
    articleId: string,
    topicId: string,
    version: string,
    stages?: string[]
  ): Promise<string> {
    const runId = uuidv4();
    this.logger.log(`Starting article regeneration run: ${runId} for article ${articleId}`);

    const topic = await this.topicLoader.loadTopic(topicId, version);
    const existingArticle = await this.storage.getArticle(articleId);

    const stagesToRun = stages || ['refine', 'export'];
    const generationStages: GenerationStage[] = [
      { stage: 'research', status: stagesToRun.includes('research') ? 'pending' : 'cancelled' },
      { stage: 'outline', status: stagesToRun.includes('outline') ? 'pending' : 'cancelled' },
      { stage: 'draft', status: stagesToRun.includes('draft') ? 'pending' : 'cancelled' },
      { stage: 'refine', status: stagesToRun.includes('refine') ? 'pending' : 'cancelled' },
      { stage: 'export', status: stagesToRun.includes('export') ? 'pending' : 'cancelled' },
    ];

    const articleRun: ArticleRun = {
      id: runId,
      topic_id: topicId,
      topic_version: version,
      status: 'in_progress',
      stages: generationStages,
      article_id: articleId,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    await this.storage.saveArticleRun(articleRun);

    const generationPromise = this.executeRegeneration(runId, topic, existingArticle, stagesToRun);
    this.activeRuns.set(runId, generationPromise);

    generationPromise.finally(() => {
      this.activeRuns.delete(runId);
    });

    return runId;
  }

  /**
   * Get status of an active generation run
   */
  async getRunStatus(runId: string): Promise<ArticleRun> {
    return this.storage.getArticleRun(runId);
  }

  /**
   * Cancel an active generation run
   */
  async cancelRun(runId: string): Promise<void> {
    this.logger.log(`Cancelling run: ${runId}`);
    
    const run = await this.storage.getArticleRun(runId);
    if (run.status === 'completed' || run.status === 'failed') {
      throw new BadRequestException(`Cannot cancel run in status: ${run.status}`);
    }

    run.status = 'failed';
    run.error = 'Cancelled by user';
    run.updated_at = new Date().toISOString();
    
    await this.storage.saveArticleRun(run);
  }

  /**
   * Execute the complete article generation pipeline
   */
  private async executeGeneration(
    runId: string,
    topic: TopicConfig,
    options: GenerationOptions
  ): Promise<void> {
    const startTime = Date.now();
    let article: Partial<Article> = {
      id: uuidv4(),
      topic_id: topic.id,
      topic_version: topic.version,
      status: 'draft',
      citations: [],
      created_at: new Date().toISOString(),
    };

    try {
      // Stage 1: Research
      let researchResult: ResearchResult | null = null;
      if (!options.skipResearch && topic.research.enabled) {
        researchResult = await this.executeStage(runId, 'research', async () => {
          this.logger.log(`[${runId}] Starting research stage`);
          return await this.researchAgent.conductResearch(topic);
        });
        
        if (researchResult) {
          article.citations = researchResult.sources;
        }
      }

      // Stage 2: Outline Generation
      const outline = await this.executeStage(runId, 'outline', async () => {
        this.logger.log(`[${runId}] Starting outline stage`);
        return await this.outlineAgent.generateOutline(topic, researchResult);
      });

      article.outline = outline;

      // Stage 3: Draft Writing
      const content = await this.executeStage(runId, 'draft', async () => {
        this.logger.log(`[${runId}] Starting draft stage`);
        return await this.draftAgent.generateDraft(topic, outline, researchResult);
      });

      article.content = content;

      // Stage 4: SEO and Refinement
      const { refinedContent, seoMetadata } = await this.executeStage(runId, 'refine', async () => {
        this.logger.log(`[${runId}] Starting refine stage`);
        return await this.seoRefineAgent.refineAndOptimize(topic, content, article.citations);
      });

      article.content = refinedContent;
      article.seo = seoMetadata;

      // Stage 5: Export and Storage
      await this.executeStage(runId, 'export', async () => {
        this.logger.log(`[${runId}] Starting export stage`);
        
        // Complete the article object
        const completeArticle: Article = {
          ...article as Article,
          status: 'published',
          metadata: {
            models_used: {
              outline: topic.models.outline,
              draft: topic.models.draft,
              refine: topic.models.refine,
            },
            generation_time_ms: Date.now() - startTime,
            api_calls: 0, // TODO: Track API calls
            tokens_used: 0, // TODO: Track token usage
          },
          updated_at: new Date().toISOString(),
        };

        // Save article
        await this.storage.saveArticle(completeArticle);

        // Export to configured formats
        if (!options.dryRun && (options.saveOutput ?? true)) {
          for (const format of topic.output.formats) {
            const exportedContent = await this.exporter.exportArticle(completeArticle, format);
            await this.storage.saveExport(completeArticle.id, format, exportedContent);
          }
        }

        return { articleId: completeArticle.id };
      });

      // Mark run as completed
      await this.updateRunStatus(runId, 'completed');
      this.logger.log(`[${runId}] Article generation completed successfully`);

    } catch (error) {
      this.logger.error(`[${runId}] Article generation failed:`, error);
      await this.updateRunStatus(runId, 'failed', error.message);
      throw error;
    }
  }

  /**
   * Execute article regeneration for specific stages
   */
  private async executeRegeneration(
    runId: string,
    topic: TopicConfig,
    existingArticle: Article,
    stages: string[]
  ): Promise<void> {
    const startTime = Date.now();
    let article = { ...existingArticle };

    try {
      let researchResult: ResearchResult | null = null;
      let outline = article.outline;
      let content = article.content;

      // Re-run research if requested
      if (stages.includes('research') && topic.research.enabled) {
        researchResult = await this.executeStage(runId, 'research', async () => {
          return await this.researchAgent.conductResearch(topic);
        });
        article.citations = researchResult.sources;
      } else {
        // Use existing research data
        researchResult = {
          query: `${topic.title} research`,
          sources: article.citations,
          summary: '',
          key_points: [],
          retrieved_at: new Date().toISOString(),
        };
      }

      // Re-run outline if requested
      if (stages.includes('outline')) {
        outline = await this.executeStage(runId, 'outline', async () => {
          return await this.outlineAgent.generateOutline(topic, researchResult);
        });
        article.outline = outline;
      }

      // Re-run draft if requested
      if (stages.includes('draft')) {
        content = await this.executeStage(runId, 'draft', async () => {
          return await this.draftAgent.generateDraft(topic, outline, researchResult);
        });
        article.content = content;
      }

      // Re-run refinement if requested
      if (stages.includes('refine')) {
        const { refinedContent, seoMetadata } = await this.executeStage(runId, 'refine', async () => {
          return await this.seoRefineAgent.refineAndOptimize(topic, content, article.citations);
        });
        article.content = refinedContent;
        article.seo = seoMetadata;
      }

      // Re-export if requested
      if (stages.includes('export')) {
        await this.executeStage(runId, 'export', async () => {
          article.updated_at = new Date().toISOString();
          await this.storage.saveArticle(article);

          for (const format of topic.output.formats) {
            const exportedContent = await this.exporter.exportArticle(article, format);
            await this.storage.saveExport(article.id, format, exportedContent);
          }

          return { articleId: article.id };
        });
      }

      await this.updateRunStatus(runId, 'completed');
      this.logger.log(`[${runId}] Article regeneration completed successfully`);

    } catch (error) {
      this.logger.error(`[${runId}] Article regeneration failed:`, error);
      await this.updateRunStatus(runId, 'failed', error.message);
      throw error;
    }
  }

  /**
   * Execute a single stage with error handling and progress tracking
   */
  private async executeStage<T>(
    runId: string,
    stageName: string,
    stageFunction: () => Promise<T>
  ): Promise<T> {
    const timeout = this.configService.get<number>('STAGE_TIMEOUT_MS', 300000); // 5 minutes default
    
    await this.updateStageStatus(runId, stageName, 'in_progress');

    try {
      const result = await Promise.race([
        stageFunction(),
        new Promise<never>((_, reject) => 
          setTimeout(() => reject(new Error(`Stage ${stageName} timed out`)), timeout)
        ),
      ]);

      await this.updateStageStatus(runId, stageName, 'completed');
      return result;
    } catch (error) {
      await this.updateStageStatus(runId, stageName, 'failed', error.message);
      throw error;
    }
  }

  /**
   * Update the status of a specific stage in a run
   */
  private async updateStageStatus(
    runId: string,
    stageName: string,
    status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'cancelled',
    error?: string
  ): Promise<void> {
    const run = await this.storage.getArticleRun(runId);
    const stage = run.stages.find(s => s.stage === stageName);
    
    if (stage) {
      stage.status = status;
      stage.error = error;
      
      if (status === 'in_progress') {
        stage.started_at = new Date().toISOString();
      } else if (status === 'completed' || status === 'failed') {
        stage.completed_at = new Date().toISOString();
      }
    }

    run.updated_at = new Date().toISOString();
    await this.storage.saveArticleRun(run);
  }

  /**
   * Update the overall status of a run
   */
  private async updateRunStatus(
    runId: string,
    status: 'pending' | 'in_progress' | 'completed' | 'failed',
    error?: string
  ): Promise<void> {
    const run = await this.storage.getArticleRun(runId);
    run.status = status;
    run.error = error;
    run.updated_at = new Date().toISOString();
    
    if (status === 'completed' || status === 'failed') {
      run.completed_at = new Date().toISOString();
    }

    await this.storage.saveArticleRun(run);
  }
}