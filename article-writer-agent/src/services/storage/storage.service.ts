import { Injectable } from '@nestjs/common';
import { promises as fs } from 'fs';
import * as path from 'path';
import { Article } from '../../schemas/article.schema';
import { RunMetadata } from '../../schemas/article.schema';
import { ExportResult } from '../exporter/exporter.service';
import { v4 as uuidv4 } from 'uuid';

export interface StorageConfig {
  baseDir?: string;
  articlesDir?: string;
  logsDir?: string;
  metadataDir?: string;
}

export interface StorageResult {
  articleId: string;
  files: string[];
  metadata: string;
  logFile: string;
}

@Injectable()
export class StorageService {
  private config: Required<StorageConfig>;

  constructor() {
    this.config = {
      baseDir: process.env.STORAGE_BASE_DIR || path.join(process.cwd(), 'storage'),
      articlesDir: 'articles',
      logsDir: 'logs',
      metadataDir: 'metadata',
    };
    
    this.initializeDirectories();
  }

  /**
   * Initialize storage directories
   */
  private async initializeDirectories(): Promise<void> {
    const dirs = [
      this.config.baseDir,
      path.join(this.config.baseDir, this.config.articlesDir),
      path.join(this.config.baseDir, this.config.logsDir),
      path.join(this.config.baseDir, this.config.metadataDir),
    ];

    for (const dir of dirs) {
      await fs.mkdir(dir, { recursive: true }).catch(err => {
        if (err.code !== 'EEXIST') {
          console.error(`Failed to create directory ${dir}:`, err);
        }
      });
    }
  }

  /**
   * Store article with all exports and metadata
   */
  async storeArticle(
    article: Article,
    exports: ExportResult[],
    runMetadata: RunMetadata
  ): Promise<StorageResult> {
    const articleDir = this.getArticleDirectory(article);
    await fs.mkdir(articleDir, { recursive: true });

    const storedFiles: string[] = [];

    // Store each export format
    for (const exportResult of exports) {
      const filename = this.generateFilename(article, exportResult.format);
      const filepath = path.join(articleDir, filename);
      
      await fs.writeFile(filepath, exportResult.content, 'utf-8');
      storedFiles.push(filepath);
      
      console.log(`Stored ${exportResult.format} format: ${filepath}`);
    }

    // Store article metadata
    const metadataFile = await this.storeArticleMetadata(article, articleDir);

    // Store run log
    const logFile = await this.storeRunLog(runMetadata);

    // Update index
    await this.updateArticleIndex(article, storedFiles);

    return {
      articleId: article.id,
      files: storedFiles,
      metadata: metadataFile,
      logFile,
    };
  }

  /**
   * Store article metadata
   */
  private async storeArticleMetadata(
    article: Article,
    articleDir: string
  ): Promise<string> {
    const metadata = {
      id: article.id,
      topic_id: article.topic_id,
      topic_version: article.topic_version,
      title: article.title,
      word_count: article.word_count,
      reading_time_minutes: article.reading_time_minutes,
      section_count: article.sections.length,
      citation_count: article.citations.length,
      created_at: article.created_at,
      updated_at: article.updated_at,
      seo_metadata: article.seo_metadata,
      sections_summary: article.sections.map(s => ({
        id: s.id,
        title: s.title,
        level: s.level,
        word_count: s.word_count,
      })),
      citations_summary: article.citations.map(c => ({
        id: c.id,
        title: c.title,
        domain: c.domain,
      })),
    };

    const metadataPath = path.join(articleDir, 'metadata.json');
    await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2), 'utf-8');
    
    return metadataPath;
  }

  /**
   * Store run log
   */
  async storeRunLog(runMetadata: RunMetadata): Promise<string> {
    const logsDir = path.join(this.config.baseDir, this.config.logsDir);
    const date = new Date().toISOString().split('T')[0];
    const logDir = path.join(logsDir, date);
    
    await fs.mkdir(logDir, { recursive: true });

    const logFile = path.join(logDir, `${runMetadata.run_id}.json`);
    await fs.writeFile(logFile, JSON.stringify(runMetadata, null, 2), 'utf-8');

    // Also append to daily log
    const dailyLog = path.join(logDir, 'daily.jsonl');
    const logLine = JSON.stringify({
      timestamp: new Date().toISOString(),
      ...runMetadata,
    }) + '\n';
    
    await fs.appendFile(dailyLog, logLine, 'utf-8');

    return logFile;
  }

  /**
   * Update article index
   */
  private async updateArticleIndex(
    article: Article,
    files: string[]
  ): Promise<void> {
    const indexPath = path.join(this.config.baseDir, 'article-index.json');
    
    let index: any[] = [];
    try {
      const existing = await fs.readFile(indexPath, 'utf-8');
      index = JSON.parse(existing);
    } catch (err) {
      // Index doesn't exist yet
    }

    index.push({
      id: article.id,
      topic_id: article.topic_id,
      topic_version: article.topic_version,
      title: article.title,
      created_at: article.created_at,
      files: files.map(f => path.relative(this.config.baseDir, f)),
      word_count: article.word_count,
    });

    await fs.writeFile(indexPath, JSON.stringify(index, null, 2), 'utf-8');
  }

  /**
   * Get article directory path
   */
  private getArticleDirectory(article: Article): string {
    const date = new Date(article.created_at);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    
    return path.join(
      this.config.baseDir,
      this.config.articlesDir,
      String(year),
      month,
      `${article.topic_id}-${article.id}`
    );
  }

  /**
   * Generate filename for article export
   */
  private generateFilename(article: Article, format: string): string {
    const sanitizedTitle = article.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .substring(0, 50);
    
    return `${sanitizedTitle}.${format}`;
  }

  /**
   * Retrieve article by ID
   */
  async retrieveArticle(articleId: string): Promise<{
    metadata: any;
    files: string[];
  } | null> {
    const indexPath = path.join(this.config.baseDir, 'article-index.json');
    
    try {
      const indexContent = await fs.readFile(indexPath, 'utf-8');
      const index = JSON.parse(indexContent);
      
      const entry = index.find((item: any) => item.id === articleId);
      if (!entry) {
        return null;
      }

      // Load metadata
      const articleDir = path.dirname(
        path.join(this.config.baseDir, entry.files[0])
      );
      const metadataPath = path.join(articleDir, 'metadata.json');
      const metadata = JSON.parse(await fs.readFile(metadataPath, 'utf-8'));

      return {
        metadata,
        files: entry.files.map((f: string) => path.join(this.config.baseDir, f)),
      };
    } catch (err) {
      console.error('Failed to retrieve article:', err);
      return null;
    }
  }

  /**
   * List all articles
   */
  async listArticles(filters?: {
    topic_id?: string;
    topic_version?: string;
    date_from?: string;
    date_to?: string;
  }): Promise<any[]> {
    const indexPath = path.join(this.config.baseDir, 'article-index.json');
    
    try {
      const indexContent = await fs.readFile(indexPath, 'utf-8');
      let articles = JSON.parse(indexContent);

      if (filters) {
        if (filters.topic_id) {
          articles = articles.filter((a: any) => a.topic_id === filters.topic_id);
        }
        if (filters.topic_version) {
          articles = articles.filter((a: any) => a.topic_version === filters.topic_version);
        }
        if (filters.date_from) {
          articles = articles.filter((a: any) => a.created_at >= filters.date_from);
        }
        if (filters.date_to) {
          articles = articles.filter((a: any) => a.created_at <= filters.date_to);
        }
      }

      return articles;
    } catch (err) {
      return [];
    }
  }

  /**
   * Get run logs
   */
  async getRunLogs(filters?: {
    run_id?: string;
    topic_id?: string;
    date?: string;
    status?: string;
  }): Promise<RunMetadata[]> {
    const logsDir = path.join(this.config.baseDir, this.config.logsDir);
    const logs: RunMetadata[] = [];

    try {
      if (filters?.run_id) {
        // Direct lookup by run_id
        const dates = await fs.readdir(logsDir);
        for (const date of dates) {
          const logFile = path.join(logsDir, date, `${filters.run_id}.json`);
          try {
            const content = await fs.readFile(logFile, 'utf-8');
            logs.push(JSON.parse(content));
            break;
          } catch (err) {
            // File doesn't exist in this date directory
          }
        }
      } else if (filters?.date) {
        // Get logs for specific date
        const dailyLog = path.join(logsDir, filters.date, 'daily.jsonl');
        try {
          const content = await fs.readFile(dailyLog, 'utf-8');
          const lines = content.split('\n').filter(l => l.trim());
          
          for (const line of lines) {
            const log = JSON.parse(line);
            if (!filters.topic_id || log.topic_id === filters.topic_id) {
              if (!filters.status || log.status === filters.status) {
                logs.push(log);
              }
            }
          }
        } catch (err) {
          // No logs for this date
        }
      } else {
        // Get all recent logs
        const dates = await fs.readdir(logsDir);
        const recentDates = dates.sort().reverse().slice(0, 7); // Last 7 days
        
        for (const date of recentDates) {
          const dailyLog = path.join(logsDir, date, 'daily.jsonl');
          try {
            const content = await fs.readFile(dailyLog, 'utf-8');
            const lines = content.split('\n').filter(l => l.trim());
            
            for (const line of lines) {
              const log = JSON.parse(line);
              if (!filters?.topic_id || log.topic_id === filters.topic_id) {
                if (!filters?.status || log.status === filters.status) {
                  logs.push(log);
                }
              }
            }
          } catch (err) {
            // Skip if file doesn't exist
          }
        }
      }
    } catch (err) {
      console.error('Failed to read logs:', err);
    }

    return logs;
  }

  /**
   * Clean up old files
   */
  async cleanupOldFiles(daysToKeep: number = 30): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);
    
    let deletedCount = 0;

    // Clean up old articles
    const articlesDir = path.join(this.config.baseDir, this.config.articlesDir);
    const years = await fs.readdir(articlesDir).catch(() => []);
    
    for (const year of years) {
      const yearDir = path.join(articlesDir, year);
      const months = await fs.readdir(yearDir).catch(() => []);
      
      for (const month of months) {
        const monthDir = path.join(yearDir, month);
        const articles = await fs.readdir(monthDir).catch(() => []);
        
        for (const article of articles) {
          const articlePath = path.join(monthDir, article);
          const stats = await fs.stat(articlePath);
          
          if (stats.mtime < cutoffDate) {
            await fs.rm(articlePath, { recursive: true, force: true });
            deletedCount++;
          }
        }
      }
    }

    // Clean up old logs
    const logsDir = path.join(this.config.baseDir, this.config.logsDir);
    const logDates = await fs.readdir(logsDir).catch(() => []);
    
    for (const date of logDates) {
      const logDate = new Date(date);
      if (logDate < cutoffDate) {
        const logPath = path.join(logsDir, date);
        await fs.rm(logPath, { recursive: true, force: true });
        deletedCount++;
      }
    }

    console.log(`Cleaned up ${deletedCount} old items`);
    return deletedCount;
  }

  /**
   * Get storage statistics
   */
  async getStorageStats(): Promise<{
    totalArticles: number;
    totalSize: number;
    byTopic: Record<string, number>;
    byMonth: Record<string, number>;
  }> {
    const indexPath = path.join(this.config.baseDir, 'article-index.json');
    
    try {
      const indexContent = await fs.readFile(indexPath, 'utf-8');
      const articles = JSON.parse(indexContent);
      
      const stats = {
        totalArticles: articles.length,
        totalSize: 0,
        byTopic: {} as Record<string, number>,
        byMonth: {} as Record<string, number>,
      };

      for (const article of articles) {
        // Count by topic
        stats.byTopic[article.topic_id] = (stats.byTopic[article.topic_id] || 0) + 1;
        
        // Count by month
        const month = article.created_at.substring(0, 7);
        stats.byMonth[month] = (stats.byMonth[month] || 0) + 1;
        
        // Calculate total size
        for (const file of article.files) {
          try {
            const filepath = path.join(this.config.baseDir, file);
            const fileStat = await fs.stat(filepath);
            stats.totalSize += fileStat.size;
          } catch (err) {
            // File might have been deleted
          }
        }
      }

      return stats;
    } catch (err) {
      return {
        totalArticles: 0,
        totalSize: 0,
        byTopic: {},
        byMonth: {},
      };
    }
  }
}