import { Injectable } from '@nestjs/common';
import * as MarkdownIt from 'markdown-it';
import { Article, Section, Citation, SEOMetadata } from '../../schemas/article.schema';
import { OutputConfig } from '../../schemas/topic-config.schema';

export interface ExportResult {
  format: 'md' | 'html' | 'json';
  content: string;
  metadata?: any;
}

@Injectable()
export class ExporterService {
  private md: MarkdownIt;

  constructor() {
    this.md = new MarkdownIt({
      html: true,
      linkify: true,
      typographer: true,
    });
  }

  /**
   * Export article in multiple formats
   */
  async exportArticle(
    article: Article,
    config: OutputConfig
  ): Promise<ExportResult[]> {
    const results: ExportResult[] = [];

    for (const format of config.formats) {
      switch (format) {
        case 'md':
          results.push(await this.exportToMarkdown(article, config));
          break;
        case 'html':
          results.push(await this.exportToHTML(article, config));
          break;
        case 'json':
          results.push(await this.exportToJSON(article, config));
          break;
      }
    }

    return results;
  }

  /**
   * Export to Markdown format
   */
  private async exportToMarkdown(
    article: Article,
    config: OutputConfig
  ): Promise<ExportResult> {
    let markdown = '';

    // Add metadata as YAML frontmatter if requested
    if (config.include_metadata) {
      markdown += this.generateFrontmatter(article);
    }

    // Add title
    markdown += `# ${article.title}\n\n`;

    // Add reading time and word count
    markdown += `*Reading time: ${article.reading_time_minutes} minutes | ${article.word_count} words*\n\n`;

    // Add sections
    for (const section of article.sections) {
      markdown += this.sectionToMarkdown(section);
      
      // Add citations for this section if any
      if (config.include_citations && section.citations && section.citations.length > 0) {
        const sectionCitations = article.citations.filter(c => 
          section.citations.includes(c.id)
        );
        if (sectionCitations.length > 0) {
          markdown += '\n*Sources:*\n';
          sectionCitations.forEach(citation => {
            markdown += `- [${citation.title}](${citation.url})\n`;
          });
        }
      }
      
      markdown += '\n';
    }

    // Add full citations section at the end
    if (config.include_citations && article.citations.length > 0) {
      markdown += '\n---\n\n## References\n\n';
      article.citations.forEach((citation, index) => {
        markdown += `${index + 1}. [${citation.title}](${citation.url}) - ${citation.domain}\n`;
        if (citation.excerpt) {
          markdown += `   > ${citation.excerpt}\n`;
        }
        markdown += '\n';
      });
    }

    // Add SEO metadata as comments
    if (article.seo_metadata) {
      markdown += '\n<!--\n';
      markdown += `SEO Title: ${article.seo_metadata.title}\n`;
      markdown += `Meta Description: ${article.seo_metadata.meta_description}\n`;
      markdown += `Keywords: ${article.seo_metadata.keywords.join(', ')}\n`;
      markdown += '-->\n';
    }

    return {
      format: 'md',
      content: markdown,
      metadata: config.include_metadata ? this.extractMetadata(article) : undefined,
    };
  }

  /**
   * Export to HTML format
   */
  private async exportToHTML(
    article: Article,
    config: OutputConfig
  ): Promise<ExportResult> {
    // First generate markdown
    const markdownResult = await this.exportToMarkdown(article, config);
    
    // Convert markdown to HTML
    let htmlContent = this.md.render(markdownResult.content);

    // Wrap in proper HTML document
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${article.seo_metadata?.title || article.title}</title>
    <meta name="description" content="${article.seo_metadata?.meta_description || ''}">
    <meta name="keywords" content="${article.seo_metadata?.keywords.join(', ') || ''}">
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
            line-height: 1.6;
            color: #333;
            max-width: 800px;
            margin: 0 auto;
            padding: 20px;
        }
        h1 { color: #2c3e50; border-bottom: 2px solid #3498db; padding-bottom: 10px; }
        h2 { color: #34495e; margin-top: 30px; }
        h3 { color: #7f8c8d; }
        blockquote {
            border-left: 4px solid #3498db;
            padding-left: 15px;
            color: #666;
            font-style: italic;
        }
        code {
            background: #f4f4f4;
            padding: 2px 5px;
            border-radius: 3px;
        }
        pre {
            background: #f4f4f4;
            padding: 15px;
            border-radius: 5px;
            overflow-x: auto;
        }
        a { color: #3498db; text-decoration: none; }
        a:hover { text-decoration: underline; }
        .metadata {
            background: #ecf0f1;
            padding: 10px;
            border-radius: 5px;
            margin-bottom: 20px;
            font-size: 0.9em;
        }
        .citations {
            margin-top: 40px;
            padding-top: 20px;
            border-top: 1px solid #ddd;
        }
        .citation {
            margin-bottom: 10px;
            padding: 10px;
            background: #f9f9f9;
            border-radius: 5px;
        }
    </style>
</head>
<body>
    ${config.include_metadata ? this.generateHTMLMetadata(article) : ''}
    ${htmlContent}
</body>
</html>`;

    return {
      format: 'html',
      content: html,
      metadata: config.include_metadata ? this.extractMetadata(article) : undefined,
    };
  }

  /**
   * Export to JSON format
   */
  private async exportToJSON(
    article: Article,
    config: OutputConfig
  ): Promise<ExportResult> {
    const jsonData: any = {
      id: article.id,
      topic_id: article.topic_id,
      topic_version: article.topic_version,
      title: article.title,
      word_count: article.word_count,
      reading_time_minutes: article.reading_time_minutes,
      created_at: article.created_at,
      updated_at: article.updated_at,
    };

    // Add sections
    jsonData.sections = article.sections.map(section => ({
      id: section.id,
      level: section.level,
      title: section.title,
      content: section.content,
      word_count: section.word_count,
      citations: config.include_citations ? section.citations : undefined,
    }));

    // Add citations if requested
    if (config.include_citations) {
      jsonData.citations = article.citations;
    }

    // Add SEO metadata
    if (article.seo_metadata) {
      jsonData.seo_metadata = article.seo_metadata;
    }

    // Add full metadata if requested
    if (config.include_metadata) {
      jsonData.metadata = this.extractMetadata(article);
    }

    return {
      format: 'json',
      content: JSON.stringify(jsonData, null, 2),
      metadata: config.include_metadata ? this.extractMetadata(article) : undefined,
    };
  }

  /**
   * Convert section to markdown
   */
  private sectionToMarkdown(section: Section): string {
    const hashes = '#'.repeat(Math.min(section.level, 6));
    let markdown = `${hashes} ${section.title}\n\n`;
    markdown += `${section.content}\n`;
    return markdown;
  }

  /**
   * Generate YAML frontmatter
   */
  private generateFrontmatter(article: Article): string {
    const metadata = this.extractMetadata(article);
    
    let frontmatter = '---\n';
    frontmatter += `id: ${article.id}\n`;
    frontmatter += `title: "${article.title}"\n`;
    frontmatter += `topic_id: ${article.topic_id}\n`;
    frontmatter += `topic_version: ${article.topic_version}\n`;
    frontmatter += `word_count: ${article.word_count}\n`;
    frontmatter += `reading_time: ${article.reading_time_minutes}\n`;
    frontmatter += `created_at: ${article.created_at}\n`;
    frontmatter += `updated_at: ${article.updated_at}\n`;
    
    if (article.seo_metadata) {
      frontmatter += `seo_title: "${article.seo_metadata.title}"\n`;
      frontmatter += `meta_description: "${article.seo_metadata.meta_description}"\n`;
      frontmatter += `keywords:\n`;
      article.seo_metadata.keywords.forEach(keyword => {
        frontmatter += `  - ${keyword}\n`;
      });
    }
    
    frontmatter += '---\n\n';
    
    return frontmatter;
  }

  /**
   * Generate HTML metadata section
   */
  private generateHTMLMetadata(article: Article): string {
    return `
    <div class="metadata">
        <strong>Article ID:</strong> ${article.id}<br>
        <strong>Topic:</strong> ${article.topic_id} v${article.topic_version}<br>
        <strong>Word Count:</strong> ${article.word_count}<br>
        <strong>Reading Time:</strong> ${article.reading_time_minutes} minutes<br>
        <strong>Created:</strong> ${new Date(article.created_at).toLocaleDateString()}<br>
        ${article.seo_metadata ? `<strong>Keywords:</strong> ${article.seo_metadata.keywords.join(', ')}` : ''}
    </div>`;
  }

  /**
   * Extract metadata for export
   */
  private extractMetadata(article: Article): any {
    return {
      id: article.id,
      topic_id: article.topic_id,
      topic_version: article.topic_version,
      word_count: article.word_count,
      reading_time_minutes: article.reading_time_minutes,
      section_count: article.sections.length,
      citation_count: article.citations.length,
      created_at: article.created_at,
      updated_at: article.updated_at,
      seo: article.seo_metadata ? {
        title: article.seo_metadata.title,
        description: article.seo_metadata.meta_description,
        keywords: article.seo_metadata.keywords,
        keyword_density: article.seo_metadata.keyword_density,
      } : undefined,
    };
  }

  /**
   * Generate filename for export
   */
  generateFilename(article: Article, format: 'md' | 'html' | 'json'): string {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
    const sanitizedTitle = article.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .substring(0, 50);
    
    return `${sanitizedTitle}-${article.topic_version}-${timestamp}.${format}`;
  }
}