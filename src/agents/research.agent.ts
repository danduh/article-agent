import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import * as cheerio from 'cheerio';
import { TopicConfig } from '../schemas/topic-config.schema';
import { ResearchResult, Citation } from '../schemas/article.schema';

interface DuckDuckGoResult {
  title: string;
  url: string;
  snippet: string;
}

interface ScrapedContent {
  title: string;
  content: string;
  url: string;
  domain: string;
}

@Injectable()
export class ResearchAgent {
  private readonly logger = new Logger(ResearchAgent.name);
  private readonly timeout: number;
  private readonly maxSources: number;
  private readonly userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36';

  constructor(private readonly configService: ConfigService) {
    this.timeout = this.configService.get<number>('DUCKDUCKGO_TIMEOUT', 10000);
    this.maxSources = this.configService.get<number>('MAX_RESEARCH_SOURCES', 10);
  }

  /**
   * Conduct research for a topic using DuckDuckGo search
   */
  async conductResearch(topic: TopicConfig): Promise<ResearchResult> {
    this.logger.log(`Starting research for topic: ${topic.id}`);
    
    const startTime = Date.now();
    const searchQueries = this.generateSearchQueries(topic);
    const allSources: Citation[] = [];
    const keyPoints: string[] = [];

    for (const query of searchQueries) {
      try {
        this.logger.log(`Searching for: "${query}"`);
        
        const searchResults = await this.searchDuckDuckGo(query);
        const filteredResults = this.filterResults(searchResults, topic);
        
        for (const result of filteredResults.slice(0, Math.ceil(topic.research.max_sources / searchQueries.length))) {
          try {
            const scrapedContent = await this.scrapeContent(result.url);
            
            if (scrapedContent && this.isContentRelevant(scrapedContent.content, topic)) {
              const citation: Citation = {
                id: this.generateCitationId(result.url),
                title: scrapedContent.title || result.title,
                url: result.url,
                domain: scrapedContent.domain,
                snippet: this.extractRelevantSnippet(scrapedContent.content, topic),
                relevance_score: this.calculateRelevanceScore(scrapedContent.content, topic),
                retrieved_at: new Date().toISOString(),
              };

              // Avoid duplicates
              if (!allSources.find(s => s.url === citation.url)) {
                allSources.push(citation);
                keyPoints.push(...this.extractKeyPoints(scrapedContent.content, topic));
              }
            }
          } catch (error) {
            this.logger.warn(`Failed to scrape ${result.url}:`, error.message);
          }
        }
      } catch (error) {
        this.logger.error(`Search failed for query "${query}":`, error);
      }
    }

    // Sort sources by relevance score
    allSources.sort((a, b) => (b.relevance_score || 0) - (a.relevance_score || 0));
    
    // Ensure minimum sources requirement
    if (allSources.length < topic.research.min_sources) {
      this.logger.warn(`Only found ${allSources.length} sources, minimum required: ${topic.research.min_sources}`);
    }

    const researchResult: ResearchResult = {
      query: searchQueries.join(' | '),
      sources: allSources.slice(0, topic.research.max_sources),
      summary: this.generateResearchSummary(allSources, keyPoints),
      key_points: [...new Set(keyPoints)].slice(0, 20), // Remove duplicates and limit
      retrieved_at: new Date().toISOString(),
    };

    const duration = Date.now() - startTime;
    this.logger.log(`Research completed in ${duration}ms. Found ${researchResult.sources.length} sources.`);

    return researchResult;
  }

  /**
   * Generate search queries based on topic configuration
   */
  private generateSearchQueries(topic: TopicConfig): string[] {
    const queries: string[] = [];
    
    // Primary query from topic title
    queries.push(topic.title);
    
    // Queries from SEO keywords
    if (topic.seo.keywords.length > 0) {
      queries.push(topic.seo.keywords.slice(0, 3).join(' '));
    }

    // Queries from required keywords if specified
    if (topic.research.required_keywords) {
      for (const keyword of topic.research.required_keywords.slice(0, 2)) {
        queries.push(keyword);
      }
    }

    // Add time-specific queries if freshness is important
    if (topic.research.freshness_days && topic.research.freshness_days <= 365) {
      const currentYear = new Date().getFullYear();
      queries.push(`${topic.seo.keywords[0]} ${currentYear}`);
    }

    return queries.slice(0, 4); // Limit to avoid too many requests
  }

  /**
   * Search DuckDuckGo for results
   */
  private async searchDuckDuckGo(query: string): Promise<DuckDuckGoResult[]> {
    try {
      // Use DuckDuckGo's instant answer API or scrape search results
      // Note: This is a simplified implementation. In production, consider using
      // the duckduckgo-search package or a proper API
      
      const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
      
      const response = await axios.get(searchUrl, {
        headers: {
          'User-Agent': this.userAgent,
        },
        timeout: this.timeout,
      });

      const $ = cheerio.load(response.data);
      const results: DuckDuckGoResult[] = [];

      $('.result').each((i, element) => {
        const $element = $(element);
        const titleLink = $element.find('.result__title a');
        const snippet = $element.find('.result__snippet');
        
        const title = titleLink.text().trim();
        const url = titleLink.attr('href');
        const snippetText = snippet.text().trim();

        if (title && url && snippetText) {
          // Clean up DuckDuckGo's redirect URLs
          const cleanUrl = url.startsWith('/l/?uddg=') 
            ? decodeURIComponent(url.split('uddg=')[1].split('&')[0])
            : url;

          results.push({
            title,
            url: cleanUrl,
            snippet: snippetText,
          });
        }
      });

      return results;
    } catch (error) {
      this.logger.error(`DuckDuckGo search failed for query "${query}":`, error);
      return [];
    }
  }

  /**
   * Filter search results based on topic configuration
   */
  private filterResults(results: DuckDuckGoResult[], topic: TopicConfig): DuckDuckGoResult[] {
    return results.filter(result => {
      try {
        const url = new URL(result.url);
        const domain = url.hostname;

        // Check allowlist
        if (topic.research.allowlist && topic.research.allowlist.length > 0) {
          const isAllowed = topic.research.allowlist.some(pattern => {
            const regex = new RegExp(pattern.replace(/\*/g, '.*'));
            return regex.test(domain);
          });
          if (!isAllowed) return false;
        }

        // Check blocklist
        if (topic.research.blocklist && topic.research.blocklist.length > 0) {
          const isBlocked = topic.research.blocklist.some(pattern => {
            const regex = new RegExp(pattern.replace(/\*/g, '.*'));
            return regex.test(domain);
          });
          if (isBlocked) return false;
        }

        return true;
      } catch (error) {
        // Invalid URL
        return false;
      }
    });
  }

  /**
   * Scrape content from a URL
   */
  private async scrapeContent(url: string): Promise<ScrapedContent | null> {
    try {
      const response = await axios.get(url, {
        headers: {
          'User-Agent': this.userAgent,
        },
        timeout: this.timeout,
        maxRedirects: 3,
      });

      const $ = cheerio.load(response.data);
      
      // Remove script and style elements
      $('script, style, nav, header, footer, aside, .advertisement, .ads').remove();

      // Extract title
      const title = $('title').text().trim() || 
                   $('h1').first().text().trim() || 
                   'Untitled';

      // Extract main content
      let content = '';
      
      // Try to find main content containers
      const contentSelectors = [
        'article',
        '[role="main"]',
        '.content',
        '.post-content',
        '.entry-content',
        '.article-content',
        'main',
        '.main-content',
      ];

      for (const selector of contentSelectors) {
        const element = $(selector);
        if (element.length > 0) {
          content = element.text().trim();
          break;
        }
      }

      // Fallback to body if no main content found
      if (!content) {
        content = $('body').text().trim();
      }

      // Clean up content
      content = content
        .replace(/\s+/g, ' ')
        .replace(/\n+/g, '\n')
        .trim();

      const domain = new URL(url).hostname;

      return {
        title,
        content: content.slice(0, 5000), // Limit content length
        url,
        domain,
      };
    } catch (error) {
      this.logger.warn(`Failed to scrape content from ${url}:`, error.message);
      return null;
    }
  }

  /**
   * Check if content is relevant to the topic
   */
  private isContentRelevant(content: string, topic: TopicConfig): boolean {
    const contentLower = content.toLowerCase();
    
    // Check if content contains topic keywords
    const keywordMatches = topic.seo.keywords.filter(keyword => 
      contentLower.includes(keyword.toLowerCase())
    ).length;

    const keywordRelevance = keywordMatches / topic.seo.keywords.length;
    
    // Check if content contains required keywords
    let requiredKeywordRelevance = 1;
    if (topic.research.required_keywords) {
      const requiredMatches = topic.research.required_keywords.filter(keyword =>
        contentLower.includes(keyword.toLowerCase())
      ).length;
      requiredKeywordRelevance = requiredMatches / topic.research.required_keywords.length;
    }

    // Content should be substantial
    const hasSubstantialContent = content.length > 200;

    return keywordRelevance >= 0.3 && requiredKeywordRelevance >= 0.5 && hasSubstantialContent;
  }

  /**
   * Calculate relevance score for content
   */
  private calculateRelevanceScore(content: string, topic: TopicConfig): number {
    const contentLower = content.toLowerCase();
    let score = 0;

    // Keyword relevance (0-0.6)
    const keywordMatches = topic.seo.keywords.filter(keyword => 
      contentLower.includes(keyword.toLowerCase())
    ).length;
    score += (keywordMatches / topic.seo.keywords.length) * 0.6;

    // Required keyword bonus (0-0.2)
    if (topic.research.required_keywords) {
      const requiredMatches = topic.research.required_keywords.filter(keyword =>
        contentLower.includes(keyword.toLowerCase())
      ).length;
      score += (requiredMatches / topic.research.required_keywords.length) * 0.2;
    }

    // Content quality (0-0.2)
    const contentQuality = Math.min(content.length / 1000, 1) * 0.2;
    score += contentQuality;

    return Math.min(score, 1);
  }

  /**
   * Extract relevant snippet from content
   */
  private extractRelevantSnippet(content: string, topic: TopicConfig): string {
    const sentences = content.split(/[.!?]+/).filter(s => s.trim().length > 20);
    
    // Find sentences containing keywords
    const relevantSentences = sentences.filter(sentence => {
      const sentenceLower = sentence.toLowerCase();
      return topic.seo.keywords.some(keyword => 
        sentenceLower.includes(keyword.toLowerCase())
      );
    });

    if (relevantSentences.length > 0) {
      return relevantSentences.slice(0, 2).join('. ').trim() + '.';
    }

    // Fallback to first few sentences
    return sentences.slice(0, 2).join('. ').trim() + '.';
  }

  /**
   * Extract key points from content
   */
  private extractKeyPoints(content: string, topic: TopicConfig): string[] {
    const keyPoints: string[] = [];
    const sentences = content.split(/[.!?]+/).filter(s => s.trim().length > 30);
    
    // Look for sentences with high keyword density
    for (const sentence of sentences.slice(0, 20)) {
      const sentenceLower = sentence.toLowerCase();
      const keywordCount = topic.seo.keywords.reduce((count, keyword) => {
        return count + (sentenceLower.includes(keyword.toLowerCase()) ? 1 : 0);
      }, 0);

      if (keywordCount >= 1) {
        keyPoints.push(sentence.trim());
      }
    }

    return keyPoints.slice(0, 5); // Limit key points per source
  }

  /**
   * Generate a summary of research findings
   */
  private generateResearchSummary(sources: Citation[], keyPoints: string[]): string {
    if (sources.length === 0) {
      return 'No research sources found.';
    }

    const domainCounts = sources.reduce((acc, source) => {
      acc[source.domain] = (acc[source.domain] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    const topDomains = Object.entries(domainCounts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 3)
      .map(([domain]) => domain);

    let summary = `Research conducted across ${sources.length} sources from ${Object.keys(domainCounts).length} domains. `;
    
    if (topDomains.length > 0) {
      summary += `Primary sources include: ${topDomains.join(', ')}. `;
    }

    if (keyPoints.length > 0) {
      summary += `Key findings include insights on ${keyPoints.length} relevant topics.`;
    }

    return summary;
  }

  /**
   * Generate a unique citation ID
   */
  private generateCitationId(url: string): string {
    // Create a simple hash of the URL
    let hash = 0;
    for (let i = 0; i < url.length; i++) {
      const char = url.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash).toString(36);
  }
}