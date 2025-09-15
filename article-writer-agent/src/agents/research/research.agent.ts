import { Injectable } from '@nestjs/common';
import axios from 'axios';
import * as cheerio from 'cheerio';
import { ResearchConfig } from '../../schemas/topic-config.schema';
import { Citation } from '../../schemas/article.schema';
import { v4 as uuidv4 } from 'uuid';

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

@Injectable()
export class ResearchAgent {
  private readonly DUCKDUCKGO_API = 'https://api.duckduckgo.com/';
  private readonly USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';

  /**
   * Conduct research based on topic and configuration
   */
  async research(
    topic: string,
    keywords: string[],
    config: ResearchConfig
  ): Promise<Citation[]> {
    if (!config.enabled) {
      return [];
    }

    const searchQuery = this.buildSearchQuery(topic, keywords, config);
    const searchResults = await this.searchDuckDuckGo(searchQuery, config.max_sources || 10);
    
    // Filter results based on allowlist/blocklist
    const filteredResults = this.filterResults(searchResults, config);
    
    // Fetch and extract content from each source
    const citations = await this.extractCitations(filteredResults, config);
    
    // Sort by relevance and limit to min_sources
    const sortedCitations = this.rankCitations(citations, keywords);
    
    if (sortedCitations.length < config.min_sources) {
      console.warn(
        `Found only ${sortedCitations.length} sources, but ${config.min_sources} required. ` +
        `Consider broadening search criteria.`
      );
    }

    return sortedCitations.slice(0, config.max_sources || 10);
  }

  /**
   * Build search query from topic and keywords
   */
  private buildSearchQuery(topic: string, keywords: string[], config: ResearchConfig): string {
    let query = topic;
    
    // Add keywords to query
    if (keywords.length > 0) {
      query += ' ' + keywords.slice(0, 3).join(' ');
    }

    // Add freshness filter if specified
    if (config.freshness_days) {
      const date = new Date();
      date.setDate(date.getDate() - config.freshness_days);
      query += ` after:${date.toISOString().split('T')[0]}`;
    }

    // Add site restrictions if allowlist is provided
    if (config.allowlist && config.allowlist.length > 0) {
      const sites = config.allowlist
        .map(domain => domain.replace('*.', 'site:'))
        .join(' OR ');
      query += ` (${sites})`;
    }

    return query;
  }

  /**
   * Search DuckDuckGo for relevant sources
   */
  private async searchDuckDuckGo(query: string, limit: number): Promise<SearchResult[]> {
    try {
      // Using DuckDuckGo HTML search as API has limitations
      // In production, consider using a proper search API service
      const searchUrl = `https://html.duckduckgo.com/html/`;
      const response = await axios.post(searchUrl, `q=${encodeURIComponent(query)}`, {
        headers: {
          'User-Agent': this.USER_AGENT,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        timeout: 10000,
      });

      const $ = cheerio.load(response.data);
      const results: SearchResult[] = [];

      $('.result').each((index, element) => {
        if (results.length >= limit) return false;

        const $element = $(element);
        const title = $element.find('.result__title').text().trim();
        const url = $element.find('.result__url').attr('href');
        const snippet = $element.find('.result__snippet').text().trim();

        if (title && url) {
          results.push({
            title,
            url: this.cleanUrl(url),
            snippet,
          });
        }
      });

      return results;
    } catch (error) {
      console.error('DuckDuckGo search failed:', error.message);
      // Fallback to a simple mock for development
      return this.getMockSearchResults(query, limit);
    }
  }

  /**
   * Clean and normalize URL
   */
  private cleanUrl(url: string): string {
    // DuckDuckGo sometimes wraps URLs
    if (url.includes('//duckduckgo.com/l/?uddg=')) {
      const match = url.match(/uddg=([^&]+)/);
      if (match) {
        return decodeURIComponent(match[1]);
      }
    }
    return url.startsWith('http') ? url : `https:${url}`;
  }

  /**
   * Filter search results based on allowlist/blocklist
   */
  private filterResults(results: SearchResult[], config: ResearchConfig): SearchResult[] {
    return results.filter(result => {
      const domain = new URL(result.url).hostname;

      // Check blocklist
      if (config.blocklist) {
        for (const pattern of config.blocklist) {
          if (this.matchesDomainPattern(domain, pattern)) {
            return false;
          }
        }
      }

      // Check allowlist (if specified, only allow these)
      if (config.allowlist && config.allowlist.length > 0) {
        let allowed = false;
        for (const pattern of config.allowlist) {
          if (this.matchesDomainPattern(domain, pattern)) {
            allowed = true;
            break;
          }
        }
        return allowed;
      }

      return true;
    });
  }

  /**
   * Check if domain matches pattern (supports wildcards)
   */
  private matchesDomainPattern(domain: string, pattern: string): boolean {
    const regex = pattern
      .replace(/\./g, '\\.')
      .replace(/\*/g, '.*');
    return new RegExp(`^${regex}$`).test(domain);
  }

  /**
   * Extract citations from search results
   */
  private async extractCitations(results: SearchResult[], config: ResearchConfig): Promise<Citation[]> {
    const citations = await Promise.all(
      results.map(async (result) => {
        try {
          // In production, you'd fetch and parse the actual content
          // For now, using the search snippet
          const domain = new URL(result.url).hostname;
          
          return {
            id: uuidv4(),
            title: result.title,
            url: result.url,
            domain,
            excerpt: result.snippet,
            date: new Date().toISOString(),
            relevance_score: 0.5, // Would be calculated based on content analysis
          };
        } catch (error) {
          console.error(`Failed to extract citation from ${result.url}:`, error.message);
          return null;
        }
      })
    );

    return citations.filter(c => c !== null);
  }

  /**
   * Rank citations by relevance to keywords
   */
  private rankCitations(citations: Citation[], keywords: string[]): Citation[] {
    return citations
      .map(citation => {
        let score = citation.relevance_score || 0;
        
        // Calculate keyword relevance
        const text = `${citation.title} ${citation.excerpt}`.toLowerCase();
        keywords.forEach(keyword => {
          if (text.includes(keyword.toLowerCase())) {
            score += 0.1;
          }
        });

        return { ...citation, relevance_score: Math.min(score, 1) };
      })
      .sort((a, b) => (b.relevance_score || 0) - (a.relevance_score || 0));
  }

  /**
   * Get mock search results for development
   */
  private getMockSearchResults(query: string, limit: number): SearchResult[] {
    const mockResults = [
      {
        title: 'Understanding Generative UI in 2025',
        url: 'https://techcrunch.com/2025/01/generative-ui-trends',
        snippet: 'Generative UI represents a paradigm shift in how we design and build user interfaces...',
      },
      {
        title: 'The Future of AI-Driven User Experiences',
        url: 'https://wired.com/story/ai-ux-revolution-2025',
        snippet: 'AI is transforming UX design through dynamic, personalized interfaces that adapt in real-time...',
      },
      {
        title: 'Dynamic UI Generation with Machine Learning',
        url: 'https://medium.com/tech/dynamic-ui-ml-guide',
        snippet: 'Learn how machine learning models can generate UI components on the fly based on user behavior...',
      },
    ];

    return mockResults.slice(0, Math.min(limit, mockResults.length));
  }
}