import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import MarkdownIt from 'markdown-it';
import { Article } from '../schemas/article.schema';

export type ExportFormat = 'md' | 'html' | 'json';

interface HTMLExportOptions {
  includeCSS?: boolean;
  includeMetadata?: boolean;
  includeTableOfContents?: boolean;
  customCSS?: string;
}

interface MarkdownExportOptions {
  includeMetadata?: boolean;
  includeCitations?: boolean;
  includeOutline?: boolean;
}

interface JSONExportOptions {
  pretty?: boolean;
  includeMetadata?: boolean;
  excludeFields?: string[];
}

@Injectable()
export class ExporterService {
  private readonly logger = new Logger(ExporterService.name);
  private readonly markdownParser: MarkdownIt;

  constructor(private readonly configService?: ConfigService) {
    this.markdownParser = new MarkdownIt({
      html: true,
      linkify: true,
      typographer: true,
    });
  }

  /**
   * Export article in specified format
   */
  async exportArticle(
    article: Article,
    format: ExportFormat,
    options?: any
  ): Promise<string> {
    this.logger.log(`Exporting article ${article.id} as ${format}`);

    try {
      switch (format) {
        case 'md':
          return this.exportMarkdown(article, options as MarkdownExportOptions);
        case 'html':
          return this.exportHTML(article, options as HTMLExportOptions);
        case 'json':
          return this.exportJSON(article, options as JSONExportOptions);
        default:
          throw new BadRequestException(`Unsupported export format: ${format}`);
      }
    } catch (error) {
      this.logger.error(`Failed to export article ${article.id} as ${format}:`, error);
      throw error;
    }
  }

  /**
   * Export article as Markdown
   */
  private exportMarkdown(
    article: Article,
    options: MarkdownExportOptions = {}
  ): string {
    const {
      includeMetadata = true,
      includeCitations = true,
      includeOutline = false,
    } = options;

    let markdown = '';

    // Add frontmatter metadata
    if (includeMetadata) {
      markdown += this.generateFrontmatter(article);
    }

    // Add outline if requested
    if (includeOutline && article.outline) {
      markdown += '\n## Table of Contents\n\n';
      markdown += this.generateOutlineMarkdown(article.outline.sections);
      markdown += '\n---\n\n';
    }

    // Add main content
    markdown += article.content.content;

    // Add citations
    if (includeCitations && article.citations.length > 0) {
      markdown += '\n\n---\n\n## References\n\n';
      markdown += this.generateCitationsMarkdown(article.citations);
    }

    // Add metadata footer
    if (includeMetadata) {
      markdown += '\n\n---\n\n';
      markdown += this.generateMetadataFooter(article);
    }

    return markdown.trim();
  }

  /**
   * Export article as HTML
   */
  private exportHTML(
    article: Article,
    options: HTMLExportOptions = {}
  ): string {
    const {
      includeCSS = true,
      includeMetadata = true,
      includeTableOfContents = false,
      customCSS,
    } = options;

    // Convert markdown to HTML
    const contentHTML = this.markdownParser.render(article.content.content);

    let html = `<!DOCTYPE html>
<html lang="${article.content.language || 'en'}">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${article.seo?.title || article.content.title}</title>`;

    // Add SEO metadata
    if (includeMetadata && article.seo) {
      html += `
    <meta name="description" content="${article.seo.description}">
    <meta name="keywords" content="${article.seo.keywords.join(', ')}">
    
    <!-- Open Graph -->
    <meta property="og:title" content="${article.seo.og_title || article.seo.title}">
    <meta property="og:description" content="${article.seo.og_description || article.seo.description}">
    <meta property="og:type" content="article">
    ${article.seo.og_image ? `<meta property="og:image" content="${article.seo.og_image}">` : ''}
    
    <!-- Twitter -->
    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:title" content="${article.seo.twitter_title || article.seo.title}">
    <meta name="twitter:description" content="${article.seo.twitter_description || article.seo.description}">
    ${article.seo.twitter_image ? `<meta name="twitter:image" content="${article.seo.twitter_image}">` : ''}`;
    }

    // Add CSS
    if (includeCSS) {
      html += `
    <style>
${customCSS || this.getDefaultCSS()}
    </style>`;
    }

    html += `
</head>
<body>
    <article class="article-content">`;

    // Add article header
    if (includeMetadata) {
      html += `
        <header class="article-header">
            <h1>${article.content.title}</h1>
            <div class="article-meta">
                <span class="reading-time">${article.content.reading_time_minutes} min read</span>
                <span class="word-count">${article.content.word_count} words</span>
                <time class="publish-date" datetime="${article.created_at}">
                    ${new Date(article.created_at).toLocaleDateString()}
                </time>
            </div>
        </header>`;
    }

    // Add table of contents
    if (includeTableOfContents && article.outline) {
      html += `
        <nav class="table-of-contents">
            <h2>Table of Contents</h2>
            ${this.generateOutlineHTML(article.outline.sections)}
        </nav>`;
    }

    // Add main content
    html += `
        <div class="article-body">
            ${contentHTML}
        </div>`;

    // Add citations
    if (article.citations.length > 0) {
      html += `
        <footer class="article-footer">
            <h2>References</h2>
            <ol class="citations">
                ${article.citations.map(citation => `
                    <li class="citation">
                        <a href="${citation.url}" target="_blank" rel="noopener">
                            ${citation.title}
                        </a>
                        <span class="citation-domain">(${citation.domain})</span>
                        <p class="citation-snippet">${citation.snippet}</p>
                    </li>
                `).join('')}
            </ol>
        </footer>`;
    }

    // Add metadata footer
    if (includeMetadata) {
      html += `
        <div class="article-metadata">
            <h3>Article Information</h3>
            <dl>
                <dt>Topic ID:</dt><dd>${article.topic_id}</dd>
                <dt>Version:</dt><dd>${article.topic_version}</dd>
                <dt>Generated:</dt><dd>${new Date(article.created_at).toLocaleString()}</dd>
                <dt>Models Used:</dt>
                <dd>
                    Outline: ${article.metadata.models_used.outline}<br>
                    Draft: ${article.metadata.models_used.draft}<br>
                    Refine: ${article.metadata.models_used.refine}
                </dd>
                <dt>Generation Time:</dt><dd>${(article.metadata.generation_time_ms / 1000).toFixed(2)}s</dd>
            </dl>
        </div>`;
    }

    html += `
    </article>
</body>
</html>`;

    return html;
  }

  /**
   * Export article as JSON
   */
  private exportJSON(
    article: Article,
    options: JSONExportOptions = {}
  ): string {
    const {
      pretty = true,
      includeMetadata = true,
      excludeFields = [],
    } = options;

    let exportData = { ...article };

    // Remove excluded fields
    for (const field of excludeFields) {
      delete (exportData as any)[field];
    }

    // Remove metadata if not requested
    if (!includeMetadata) {
      delete exportData.metadata;
    }

    // Add export metadata
    const exportMetadata = {
      exported_at: new Date().toISOString(),
      export_format: 'json',
      exporter_version: '1.0.0',
    };

    const finalData = {
      ...exportData,
      export_metadata: exportMetadata,
    };

    return pretty 
      ? JSON.stringify(finalData, null, 2)
      : JSON.stringify(finalData);
  }

  /**
   * Generate frontmatter for Markdown
   */
  private generateFrontmatter(article: Article): string {
    const frontmatter = {
      title: article.content.title,
      topic_id: article.topic_id,
      topic_version: article.topic_version,
      status: article.status,
      created_at: article.created_at,
      word_count: article.content.word_count,
      reading_time: article.content.reading_time_minutes,
      language: article.content.language,
    };

    if (article.seo) {
      Object.assign(frontmatter, {
        seo_title: article.seo.title,
        seo_description: article.seo.description,
        keywords: article.seo.keywords,
      });
    }

    let yaml = '---\n';
    for (const [key, value] of Object.entries(frontmatter)) {
      if (Array.isArray(value)) {
        yaml += `${key}:\n${value.map(v => `  - ${v}`).join('\n')}\n`;
      } else {
        yaml += `${key}: ${value}\n`;
      }
    }
    yaml += '---\n';

    return yaml;
  }

  /**
   * Generate outline as Markdown
   */
  private generateOutlineMarkdown(sections: any[], level = 1): string {
    let outline = '';
    
    for (const section of sections) {
      const indent = '  '.repeat(level - 1);
      outline += `${indent}- [${section.title}](#${this.slugify(section.title)})\n`;
      
      if (section.subsections && section.subsections.length > 0) {
        outline += this.generateOutlineMarkdown(section.subsections, level + 1);
      }
    }
    
    return outline;
  }

  /**
   * Generate outline as HTML
   */
  private generateOutlineHTML(sections: any[], level = 1): string {
    let html = '<ol>';
    
    for (const section of sections) {
      html += `<li><a href="#${this.slugify(section.title)}">${section.title}</a>`;
      
      if (section.subsections && section.subsections.length > 0) {
        html += this.generateOutlineHTML(section.subsections, level + 1);
      }
      
      html += '</li>';
    }
    
    html += '</ol>';
    return html;
  }

  /**
   * Generate citations as Markdown
   */
  private generateCitationsMarkdown(citations: any[]): string {
    return citations.map((citation, index) => 
      `${index + 1}. [${citation.title}](${citation.url}) - ${citation.domain}\n   ${citation.snippet}`
    ).join('\n\n');
  }

  /**
   * Generate metadata footer
   */
  private generateMetadataFooter(article: Article): string {
    return `**Article Information:**
- Topic ID: ${article.topic_id}
- Version: ${article.topic_version}
- Generated: ${new Date(article.created_at).toLocaleString()}
- Word Count: ${article.content.word_count}
- Reading Time: ${article.content.reading_time_minutes} minutes
- Models Used: ${article.metadata.models_used.outline} → ${article.metadata.models_used.draft} → ${article.metadata.models_used.refine}
- Generation Time: ${(article.metadata.generation_time_ms / 1000).toFixed(2)} seconds`;
  }

  /**
   * Get default CSS for HTML export
   */
  private getDefaultCSS(): string {
    return `
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', sans-serif;
            line-height: 1.6;
            max-width: 800px;
            margin: 0 auto;
            padding: 20px;
            color: #333;
            background-color: #fff;
        }
        
        .article-header {
            border-bottom: 2px solid #eee;
            margin-bottom: 2rem;
            padding-bottom: 1rem;
        }
        
        .article-header h1 {
            margin: 0 0 1rem 0;
            font-size: 2.5rem;
            color: #2c3e50;
        }
        
        .article-meta {
            color: #666;
            font-size: 0.9rem;
        }
        
        .article-meta span {
            margin-right: 1rem;
        }
        
        .table-of-contents {
            background: #f8f9fa;
            border: 1px solid #dee2e6;
            border-radius: 8px;
            padding: 1.5rem;
            margin: 2rem 0;
        }
        
        .table-of-contents h2 {
            margin-top: 0;
            color: #495057;
        }
        
        .table-of-contents ol {
            margin-bottom: 0;
        }
        
        .table-of-contents a {
            text-decoration: none;
            color: #007bff;
        }
        
        .table-of-contents a:hover {
            text-decoration: underline;
        }
        
        .article-body {
            margin: 2rem 0;
        }
        
        .article-body h1,
        .article-body h2,
        .article-body h3,
        .article-body h4,
        .article-body h5,
        .article-body h6 {
            margin-top: 2rem;
            margin-bottom: 1rem;
            color: #2c3e50;
        }
        
        .article-body h1 { font-size: 2rem; }
        .article-body h2 { font-size: 1.75rem; }
        .article-body h3 { font-size: 1.5rem; }
        .article-body h4 { font-size: 1.25rem; }
        .article-body h5 { font-size: 1.1rem; }
        .article-body h6 { font-size: 1rem; }
        
        .article-body p {
            margin-bottom: 1rem;
        }
        
        .article-body a {
            color: #007bff;
            text-decoration: none;
        }
        
        .article-body a:hover {
            text-decoration: underline;
        }
        
        .article-body blockquote {
            border-left: 4px solid #007bff;
            margin: 1.5rem 0;
            padding: 0.5rem 0 0.5rem 1rem;
            background: #f8f9fa;
            font-style: italic;
        }
        
        .article-body code {
            background: #f1f3f4;
            padding: 0.2rem 0.4rem;
            border-radius: 4px;
            font-family: 'Monaco', 'Menlo', monospace;
            font-size: 0.9rem;
        }
        
        .article-body pre {
            background: #f8f9fa;
            border: 1px solid #dee2e6;
            border-radius: 8px;
            padding: 1rem;
            overflow-x: auto;
        }
        
        .article-body ul,
        .article-body ol {
            margin-bottom: 1rem;
            padding-left: 2rem;
        }
        
        .article-body li {
            margin-bottom: 0.5rem;
        }
        
        .article-footer {
            border-top: 2px solid #eee;
            margin-top: 3rem;
            padding-top: 2rem;
        }
        
        .citations {
            list-style: decimal;
            padding-left: 1.5rem;
        }
        
        .citation {
            margin-bottom: 1rem;
            padding-bottom: 1rem;
            border-bottom: 1px solid #eee;
        }
        
        .citation:last-child {
            border-bottom: none;
        }
        
        .citation a {
            font-weight: bold;
            color: #007bff;
            text-decoration: none;
        }
        
        .citation a:hover {
            text-decoration: underline;
        }
        
        .citation-domain {
            color: #666;
            font-size: 0.9rem;
            margin-left: 0.5rem;
        }
        
        .citation-snippet {
            color: #555;
            font-style: italic;
            margin: 0.5rem 0 0 0;
        }
        
        .article-metadata {
            background: #f8f9fa;
            border: 1px solid #dee2e6;
            border-radius: 8px;
            padding: 1.5rem;
            margin-top: 2rem;
            font-size: 0.9rem;
        }
        
        .article-metadata h3 {
            margin-top: 0;
            color: #495057;
        }
        
        .article-metadata dl {
            margin: 0;
        }
        
        .article-metadata dt {
            font-weight: bold;
            color: #495057;
            margin-top: 0.5rem;
        }
        
        .article-metadata dt:first-child {
            margin-top: 0;
        }
        
        .article-metadata dd {
            margin: 0 0 0 1rem;
            color: #666;
        }
        
        @media (max-width: 768px) {
            body {
                padding: 10px;
            }
            
            .article-header h1 {
                font-size: 2rem;
            }
            
            .article-body h1 { font-size: 1.75rem; }
            .article-body h2 { font-size: 1.5rem; }
            .article-body h3 { font-size: 1.25rem; }
        }
    `;
  }

  /**
   * Convert text to URL-friendly slug
   */
  private slugify(text: string): string {
    return text
      .toLowerCase()
      .replace(/[^\w\s-]/g, '')
      .replace(/[\s_-]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  /**
   * Batch export articles in multiple formats
   */
  async batchExport(
    articles: Article[],
    formats: ExportFormat[],
    options?: { [format: string]: any }
  ): Promise<{ [articleId: string]: { [format: string]: string } }> {
    this.logger.log(`Batch exporting ${articles.length} articles in ${formats.length} formats`);

    const results: { [articleId: string]: { [format: string]: string } } = {};

    for (const article of articles) {
      results[article.id] = {};

      for (const format of formats) {
        try {
          const formatOptions = options?.[format] || {};
          results[article.id][format] = await this.exportArticle(article, format, formatOptions);
        } catch (error) {
          this.logger.error(`Failed to export article ${article.id} as ${format}:`, error);
          results[article.id][format] = `Error: ${error.message}`;
        }
      }
    }

    return results;
  }

  /**
   * Get export statistics
   */
  getExportStats(exportResults: { [articleId: string]: { [format: string]: string } }): {
    totalArticles: number;
    totalExports: number;
    successfulExports: number;
    failedExports: number;
    formatBreakdown: { [format: string]: { success: number; failed: number } };
  } {
    const stats = {
      totalArticles: Object.keys(exportResults).length,
      totalExports: 0,
      successfulExports: 0,
      failedExports: 0,
      formatBreakdown: {} as { [format: string]: { success: number; failed: number } },
    };

    for (const articleResults of Object.values(exportResults)) {
      for (const [format, result] of Object.entries(articleResults)) {
        stats.totalExports++;

        if (!stats.formatBreakdown[format]) {
          stats.formatBreakdown[format] = { success: 0, failed: 0 };
        }

        if (result.startsWith('Error:')) {
          stats.failedExports++;
          stats.formatBreakdown[format].failed++;
        } else {
          stats.successfulExports++;
          stats.formatBreakdown[format].success++;
        }
      }
    }

    return stats;
  }
}