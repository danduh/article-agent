import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { promises as fs } from 'fs';
import { join, dirname } from 'path';
import { Article, ArticleRun, validateArticle } from '../schemas/article.schema';

export interface ArticleFilter {
  topicId?: string;
  status?: string;
  createdAfter?: string;
  createdBefore?: string;
}

@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly storagePath: string;
  private readonly logsPath: string;

  constructor(private readonly configService: ConfigService) {
    this.storagePath = this.configService.get<string>('STORAGE_PATH', './storage');
    this.logsPath = this.configService.get<string>('LOGS_PATH', './logs');
    
    this.initializeStorage();
  }

  /**
   * Initialize storage directories
   */
  private async initializeStorage(): Promise<void> {
    try {
      await fs.mkdir(this.storagePath, { recursive: true });
      await fs.mkdir(join(this.storagePath, 'articles'), { recursive: true });
      await fs.mkdir(join(this.storagePath, 'runs'), { recursive: true });
      await fs.mkdir(join(this.storagePath, 'exports'), { recursive: true });
      await fs.mkdir(this.logsPath, { recursive: true });
      
      this.logger.log(`Storage initialized at: ${this.storagePath}`);
    } catch (error) {
      this.logger.error('Failed to initialize storage:', error);
      throw error;
    }
  }

  /**
   * Save an article to storage
   */
  async saveArticle(article: Article): Promise<void> {
    try {
      // Validate article before saving
      const validatedArticle = validateArticle(article);
      
      const filePath = join(this.storagePath, 'articles', `${article.id}.json`);
      await this.ensureDirectoryExists(dirname(filePath));
      
      const content = JSON.stringify(validatedArticle, null, 2);
      await fs.writeFile(filePath, content, 'utf-8');
      
      this.logger.log(`Article saved: ${article.id}`);
      
      // Also save a backup with timestamp
      const backupPath = join(
        this.storagePath, 
        'articles', 
        'backups', 
        `${article.id}-${Date.now()}.json`
      );
      await this.ensureDirectoryExists(dirname(backupPath));
      await fs.writeFile(backupPath, content, 'utf-8');
      
    } catch (error) {
      this.logger.error(`Failed to save article ${article.id}:`, error);
      throw new BadRequestException(`Failed to save article: ${error.message}`);
    }
  }

  /**
   * Get an article by ID
   */
  async getArticle(articleId: string): Promise<Article> {
    try {
      const filePath = join(this.storagePath, 'articles', `${articleId}.json`);
      const content = await fs.readFile(filePath, 'utf-8');
      const articleData = JSON.parse(content);
      
      return validateArticle(articleData);
    } catch (error) {
      if (error.code === 'ENOENT') {
        throw new NotFoundException(`Article not found: ${articleId}`);
      }
      this.logger.error(`Failed to load article ${articleId}:`, error);
      throw new BadRequestException(`Failed to load article: ${error.message}`);
    }
  }

  /**
   * List articles with optional filtering and pagination
   */
  async listArticles(
    filter: ArticleFilter = {},
    page?: number,
    limit?: number
  ): Promise<{ articles: Article[]; total: number }> {
    try {
      const articlesDir = join(this.storagePath, 'articles');
      const files = await fs.readdir(articlesDir);
      const jsonFiles = files.filter(file => file.endsWith('.json') && !file.includes('-'));

      const articles: Article[] = [];
      
      for (const file of jsonFiles) {
        try {
          const filePath = join(articlesDir, file);
          const content = await fs.readFile(filePath, 'utf-8');
          const articleData = JSON.parse(content);
          const article = validateArticle(articleData);
          
          // Apply filters
          if (filter.topicId && article.topic_id !== filter.topicId) continue;
          if (filter.status && article.status !== filter.status) continue;
          if (filter.createdAfter && article.created_at < filter.createdAfter) continue;
          if (filter.createdBefore && article.created_at > filter.createdBefore) continue;
          
          articles.push(article);
        } catch (error) {
          this.logger.warn(`Skipping invalid article file ${file}:`, error.message);
        }
      }

      // Sort by creation date (newest first)
      articles.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

      // Apply pagination
      const startIndex = page && limit ? (page - 1) * limit : 0;
      const endIndex = page && limit ? startIndex + limit : articles.length;
      const paginatedArticles = articles.slice(startIndex, endIndex);

      return {
        articles: paginatedArticles,
        total: articles.length,
      };
    } catch (error) {
      this.logger.error('Failed to list articles:', error);
      throw new BadRequestException(`Failed to list articles: ${error.message}`);
    }
  }

  /**
   * Delete an article
   */
  async deleteArticle(articleId: string): Promise<void> {
    try {
      const filePath = join(this.storagePath, 'articles', `${articleId}.json`);
      await fs.unlink(filePath);
      
      this.logger.log(`Article deleted: ${articleId}`);
    } catch (error) {
      if (error.code === 'ENOENT') {
        throw new NotFoundException(`Article not found: ${articleId}`);
      }
      this.logger.error(`Failed to delete article ${articleId}:`, error);
      throw new BadRequestException(`Failed to delete article: ${error.message}`);
    }
  }

  /**
   * Save an article run (generation process tracking)
   */
  async saveArticleRun(run: ArticleRun): Promise<void> {
    try {
      const filePath = join(this.storagePath, 'runs', `${run.id}.json`);
      await this.ensureDirectoryExists(dirname(filePath));
      
      const content = JSON.stringify(run, null, 2);
      await fs.writeFile(filePath, content, 'utf-8');
      
      this.logger.debug(`Article run saved: ${run.id}`);
    } catch (error) {
      this.logger.error(`Failed to save article run ${run.id}:`, error);
      throw new BadRequestException(`Failed to save article run: ${error.message}`);
    }
  }

  /**
   * Get an article run by ID
   */
  async getArticleRun(runId: string): Promise<ArticleRun> {
    try {
      const filePath = join(this.storagePath, 'runs', `${runId}.json`);
      const content = await fs.readFile(filePath, 'utf-8');
      const runData = JSON.parse(content);
      
      return runData as ArticleRun;
    } catch (error) {
      if (error.code === 'ENOENT') {
        throw new NotFoundException(`Article run not found: ${runId}`);
      }
      this.logger.error(`Failed to load article run ${runId}:`, error);
      throw new BadRequestException(`Failed to load article run: ${error.message}`);
    }
  }

  /**
   * List article runs with optional filtering
   */
  async listArticleRuns(
    filter: { topicId?: string; status?: string } = {},
    page?: number,
    limit?: number
  ): Promise<{ runs: ArticleRun[]; total: number }> {
    try {
      const runsDir = join(this.storagePath, 'runs');
      const files = await fs.readdir(runsDir);
      const jsonFiles = files.filter(file => file.endsWith('.json'));

      const runs: ArticleRun[] = [];
      
      for (const file of jsonFiles) {
        try {
          const filePath = join(runsDir, file);
          const content = await fs.readFile(filePath, 'utf-8');
          const runData = JSON.parse(content) as ArticleRun;
          
          // Apply filters
          if (filter.topicId && runData.topic_id !== filter.topicId) continue;
          if (filter.status && runData.status !== filter.status) continue;
          
          runs.push(runData);
        } catch (error) {
          this.logger.warn(`Skipping invalid run file ${file}:`, error.message);
        }
      }

      // Sort by creation date (newest first)
      runs.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

      // Apply pagination
      const startIndex = page && limit ? (page - 1) * limit : 0;
      const endIndex = page && limit ? startIndex + limit : runs.length;
      const paginatedRuns = runs.slice(startIndex, endIndex);

      return {
        runs: paginatedRuns,
        total: runs.length,
      };
    } catch (error) {
      this.logger.error('Failed to list article runs:', error);
      throw new BadRequestException(`Failed to list article runs: ${error.message}`);
    }
  }

  /**
   * Save exported article content
   */
  async saveExport(
    articleId: string,
    format: string,
    content: string
  ): Promise<void> {
    try {
      const exportDir = join(this.storagePath, 'exports', articleId);
      await this.ensureDirectoryExists(exportDir);
      
      const filePath = join(exportDir, `article.${format}`);
      await fs.writeFile(filePath, content, 'utf-8');
      
      this.logger.log(`Export saved: ${articleId}.${format}`);
    } catch (error) {
      this.logger.error(`Failed to save export ${articleId}.${format}:`, error);
      throw new BadRequestException(`Failed to save export: ${error.message}`);
    }
  }

  /**
   * Get exported article content
   */
  async getExport(articleId: string, format: string): Promise<string> {
    try {
      const filePath = join(this.storagePath, 'exports', articleId, `article.${format}`);
      return await fs.readFile(filePath, 'utf-8');
    } catch (error) {
      if (error.code === 'ENOENT') {
        throw new NotFoundException(`Export not found: ${articleId}.${format}`);
      }
      this.logger.error(`Failed to load export ${articleId}.${format}:`, error);
      throw new BadRequestException(`Failed to load export: ${error.message}`);
    }
  }

  /**
   * Log generation events and errors
   */
  async logEvent(
    level: 'info' | 'warn' | 'error',
    message: string,
    metadata?: Record<string, any>
  ): Promise<void> {
    try {
      const timestamp = new Date().toISOString();
      const logEntry = {
        timestamp,
        level,
        message,
        metadata,
      };

      const logFile = join(this.logsPath, `${new Date().toISOString().split('T')[0]}.log`);
      const logLine = JSON.stringify(logEntry) + '\n';
      
      await fs.appendFile(logFile, logLine, 'utf-8');
    } catch (error) {
      this.logger.error('Failed to write log entry:', error);
      // Don't throw here to avoid cascading failures
    }
  }

  /**
   * Get storage statistics
   */
  async getStorageStats(): Promise<{
    articles: number;
    runs: number;
    exports: number;
    storageSize: string;
  }> {
    try {
      const articlesDir = join(this.storagePath, 'articles');
      const runsDir = join(this.storagePath, 'runs');
      const exportsDir = join(this.storagePath, 'exports');

      const [articleFiles, runFiles] = await Promise.all([
        fs.readdir(articlesDir).catch(() => []),
        fs.readdir(runsDir).catch(() => []),
      ]);

      const articleCount = articleFiles.filter(f => f.endsWith('.json') && !f.includes('-')).length;
      const runCount = runFiles.filter(f => f.endsWith('.json')).length;

      // Count export directories
      let exportCount = 0;
      try {
        const exportDirs = await fs.readdir(exportsDir);
        exportCount = exportDirs.length;
      } catch (error) {
        // Exports directory might not exist yet
      }

      // Calculate storage size (simplified)
      const storageSize = await this.calculateDirectorySize(this.storagePath);

      return {
        articles: articleCount,
        runs: runCount,
        exports: exportCount,
        storageSize: this.formatBytes(storageSize),
      };
    } catch (error) {
      this.logger.error('Failed to get storage stats:', error);
      return {
        articles: 0,
        runs: 0,
        exports: 0,
        storageSize: '0 B',
      };
    }
  }

  /**
   * Clean up old runs and backups
   */
  async cleanup(olderThanDays: number = 30): Promise<void> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);
    const cutoffTime = cutoffDate.getTime();

    try {
      // Clean up old runs
      const runsDir = join(this.storagePath, 'runs');
      const runFiles = await fs.readdir(runsDir);
      
      for (const file of runFiles) {
        const filePath = join(runsDir, file);
        const stats = await fs.stat(filePath);
        
        if (stats.mtime.getTime() < cutoffTime) {
          await fs.unlink(filePath);
          this.logger.log(`Cleaned up old run file: ${file}`);
        }
      }

      // Clean up old backups
      const backupsDir = join(this.storagePath, 'articles', 'backups');
      try {
        const backupFiles = await fs.readdir(backupsDir);
        
        for (const file of backupFiles) {
          const filePath = join(backupsDir, file);
          const stats = await fs.stat(filePath);
          
          if (stats.mtime.getTime() < cutoffTime) {
            await fs.unlink(filePath);
            this.logger.log(`Cleaned up old backup file: ${file}`);
          }
        }
      } catch (error) {
        // Backups directory might not exist
      }

      this.logger.log(`Cleanup completed for files older than ${olderThanDays} days`);
    } catch (error) {
      this.logger.error('Cleanup failed:', error);
      throw error;
    }
  }

  /**
   * Ensure directory exists
   */
  private async ensureDirectoryExists(dirPath: string): Promise<void> {
    try {
      await fs.mkdir(dirPath, { recursive: true });
    } catch (error) {
      if (error.code !== 'EEXIST') {
        throw error;
      }
    }
  }

  /**
   * Calculate directory size recursively
   */
  private async calculateDirectorySize(dirPath: string): Promise<number> {
    let totalSize = 0;

    try {
      const items = await fs.readdir(dirPath);

      for (const item of items) {
        const itemPath = join(dirPath, item);
        const stats = await fs.stat(itemPath);

        if (stats.isDirectory()) {
          totalSize += await this.calculateDirectorySize(itemPath);
        } else {
          totalSize += stats.size;
        }
      }
    } catch (error) {
      // Directory might not exist or be accessible
    }

    return totalSize;
  }

  /**
   * Format bytes to human readable string
   */
  private formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';

    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));

    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }
}