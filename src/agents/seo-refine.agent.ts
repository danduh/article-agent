import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChatOpenAI } from '@langchain/openai';
import { ChatAnthropic } from '@langchain/anthropic';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { TopicConfig } from '../schemas/topic-config.schema';
import { ArticleContent, SEOMetadata, Citation } from '../schemas/article.schema';

interface SEOAnalysis {
  keywordDensity: { [keyword: string]: number };
  readabilityScore: number;
  headingStructure: { level: number; text: string }[];
  internalLinks: number;
  externalLinks: number;
  metaTitleLength: number;
  metaDescriptionLength: number;
  issues: string[];
  suggestions: string[];
}

@Injectable()
export class SEORefineAgent {
  private readonly logger = new Logger(SEORefineAgent.name);
  private readonly models: Map<string, any> = new Map();

  constructor(private readonly configService: ConfigService) {
    this.initializeModels();
  }

  /**
   * Initialize AI models for SEO and refinement
   */
  private initializeModels(): void {
    try {
      // OpenAI models
      const openaiApiKey = this.configService.get<string>('OPENAI_API_KEY');
      if (openaiApiKey) {
        this.models.set('gpt-4o', new ChatOpenAI({
          modelName: 'gpt-4o',
          temperature: 0.2,
          openAIApiKey: openaiApiKey,
        }));
        
        this.models.set('gpt-4', new ChatOpenAI({
          modelName: 'gpt-4',
          temperature: 0.2,
          openAIApiKey: openaiApiKey,
        }));
      }

      // Anthropic models
      const anthropicApiKey = this.configService.get<string>('ANTHROPIC_API_KEY');
      if (anthropicApiKey) {
        this.models.set('anthropic/claude-3-5-sonnet', new ChatAnthropic({
          modelName: 'claude-3-5-sonnet-20241022',
          temperature: 0.2,
          anthropicApiKey: anthropicApiKey,
        }));
      }

      this.logger.log(`Initialized ${this.models.size} models for SEO refinement`);
    } catch (error) {
      this.logger.error('Failed to initialize SEO refinement models:', error);
    }
  }

  /**
   * Refine article content and generate SEO metadata
   */
  async refineAndOptimize(
    topic: TopicConfig,
    content: ArticleContent,
    citations: Citation[]
  ): Promise<{ refinedContent: ArticleContent; seoMetadata: SEOMetadata }> {
    this.logger.log(`Refining and optimizing article for topic: ${topic.id}`);

    const model = this.models.get(topic.models.refine);
    if (!model) {
      throw new Error(`Model not available: ${topic.models.refine}`);
    }

    try {
      // Analyze current content
      const seoAnalysis = this.analyzeSEO(content, topic);
      
      // Refine content if needed
      const refinedContent = await this.refineContent(content, topic, seoAnalysis, model);
      
      // Generate SEO metadata
      const seoMetadata = await this.generateSEOMetadata(refinedContent, topic, model);
      
      // Add internal and external links
      const finalContent = await this.addLinks(refinedContent, topic, citations, model);

      this.logger.log(`SEO refinement completed`);
      
      return {
        refinedContent: finalContent,
        seoMetadata,
      };
    } catch (error) {
      this.logger.error(`Failed to refine article for topic ${topic.id}:`, error);
      throw error;
    }
  }

  /**
   * Analyze current content for SEO issues
   */
  private analyzeSEO(content: ArticleContent, topic: TopicConfig): SEOAnalysis {
    const text = content.content;
    const words = text.split(/\s+/).filter(word => word.length > 0);
    const totalWords = words.length;

    // Calculate keyword density
    const keywordDensity: { [keyword: string]: number } = {};
    for (const keyword of topic.seo.keywords) {
      const regex = new RegExp(keyword.replace(/\s+/g, '\\s+'), 'gi');
      const matches = text.match(regex) || [];
      keywordDensity[keyword] = totalWords > 0 ? (matches.length / totalWords) * 100 : 0;
    }

    // Analyze heading structure
    const headingRegex = /^(#{1,6})\s+(.+)$/gm;
    const headings: { level: number; text: string }[] = [];
    let match;
    while ((match = headingRegex.exec(text)) !== null) {
      headings.push({
        level: match[1].length,
        text: match[2].trim(),
      });
    }

    // Count links
    const internalLinks = (text.match(/\[([^\]]+)\]\([^)]*(?:localhost|example\.com|internal)[^)]*\)/g) || []).length;
    const externalLinks = (text.match(/\[([^\]]+)\]\(https?:\/\/[^)]+\)/g) || []).length;

    // Calculate basic readability (simplified Flesch-Kincaid)
    const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0).length;
    const syllables = this.estimateSyllables(text);
    const readabilityScore = sentences > 0 && words.length > 0 
      ? 206.835 - (1.015 * (words.length / sentences)) - (84.6 * (syllables / words.length))
      : 0;

    // Identify issues
    const issues: string[] = [];
    const suggestions: string[] = [];

    // Check keyword density
    const targetDensity = this.parseKeywordDensity(topic.seo.keyword_density);
    for (const [keyword, density] of Object.entries(keywordDensity)) {
      if (density < targetDensity.min) {
        issues.push(`Keyword "${keyword}" density too low: ${density.toFixed(1)}%`);
      } else if (density > targetDensity.max) {
        issues.push(`Keyword "${keyword}" density too high: ${density.toFixed(1)}%`);
      }
    }

    // Check heading structure
    if (headings.length === 0) {
      issues.push('No headings found in content');
    } else if (!headings.some(h => h.level === 1)) {
      issues.push('No H1 heading found');
    }

    // Check links
    if (internalLinks < topic.seo.internal_links.min) {
      suggestions.push(`Add more internal links (current: ${internalLinks}, min: ${topic.seo.internal_links.min})`);
    }
    if (externalLinks < topic.seo.external_links.min) {
      suggestions.push(`Add more external links (current: ${externalLinks}, min: ${topic.seo.external_links.min})`);
    }

    // Check readability
    if (readabilityScore < 30) {
      suggestions.push('Content may be too complex for target audience');
    } else if (readabilityScore > 90) {
      suggestions.push('Content may be too simple for target audience');
    }

    return {
      keywordDensity,
      readabilityScore,
      headingStructure: headings,
      internalLinks,
      externalLinks,
      metaTitleLength: content.title.length,
      metaDescriptionLength: 0, // Will be set when meta description is generated
      issues,
      suggestions,
    };
  }

  /**
   * Refine content based on SEO analysis
   */
  private async refineContent(
    content: ArticleContent,
    topic: TopicConfig,
    analysis: SEOAnalysis,
    model: any
  ): Promise<ArticleContent> {
    // Only refine if there are significant issues
    if (analysis.issues.length === 0 && analysis.suggestions.length <= 2) {
      this.logger.log('Content quality is good, skipping refinement');
      return content;
    }

    this.logger.log(`Refining content with ${analysis.issues.length} issues and ${analysis.suggestions.length} suggestions`);

    const prompt = this.buildRefinementPrompt(content, topic, analysis);
    const messages = [
      new SystemMessage(this.getRefinementSystemPrompt(topic)),
      new HumanMessage(prompt),
    ];

    try {
      const response = await model.invoke(messages);
      const refinedText = response.content as string;
      
      // Clean up the refined content
      const cleanRefinedText = this.cleanRefinedContent(refinedText);
      const wordCount = this.countWords(cleanRefinedText);
      const readingTime = Math.ceil(wordCount / 200);

      return {
        ...content,
        content: cleanRefinedText,
        word_count: wordCount,
        reading_time_minutes: readingTime,
        updated_at: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.error('Failed to refine content:', error);
      return content; // Return original content if refinement fails
    }
  }

  /**
   * Build refinement prompt
   */
  private buildRefinementPrompt(
    content: ArticleContent,
    topic: TopicConfig,
    analysis: SEOAnalysis
  ): string {
    return `Please refine the following article content to address SEO and readability issues:

**Current Article**:
${content.content}

**SEO Analysis Results**:
- Keyword Density: ${Object.entries(analysis.keywordDensity).map(([k, v]) => `${k}: ${v.toFixed(1)}%`).join(', ')}
- Readability Score: ${analysis.readabilityScore.toFixed(1)}
- Internal Links: ${analysis.internalLinks}
- External Links: ${analysis.externalLinks}

**Issues to Address**:
${analysis.issues.map(issue => `- ${issue}`).join('\n')}

**Suggestions to Consider**:
${analysis.suggestions.map(suggestion => `- ${suggestion}`).join('\n')}

**Topic Requirements**:
- Target Keywords: ${topic.seo.keywords.join(', ')}
- Keyword Density Target: ${topic.seo.keyword_density}
- Tone: ${topic.tone}
- Reading Level: ${topic.reading_level}
- Audience: ${topic.audience}

**Refinement Instructions**:
1. Adjust keyword density to meet targets without keyword stuffing
2. Improve readability while maintaining the ${topic.tone} tone
3. Ensure content flows naturally and provides value to ${topic.audience}
4. Maintain the article structure and all important information
5. Keep the same approximate word count (${content.word_count} words)
6. Preserve all existing headings and their hierarchy
7. Make content more engaging and actionable

**Output Format**:
Provide the complete refined article content in markdown format. Include all sections and maintain the original structure.

Refined content:`;
  }

  /**
   * Get system prompt for content refinement
   */
  private getRefinementSystemPrompt(topic: TopicConfig): string {
    return `You are an expert SEO content editor and copywriter specializing in optimizing articles for search engines while maintaining high readability and user engagement.

Your expertise includes:
1. **SEO Optimization**: Naturally incorporating keywords at optimal density levels
2. **Readability Enhancement**: Improving sentence structure, flow, and clarity
3. **Audience Engagement**: Making content more compelling for ${topic.audience}
4. **Technical Writing**: Maintaining accuracy while improving accessibility
5. **Content Structure**: Optimizing heading hierarchy and content organization

Guidelines:
- Tone: ${topic.tone}
- Reading Level: ${topic.reading_level}
- Target Audience: ${topic.audience}
- Keywords: ${topic.seo.keywords.join(', ')}

Always preserve the core information and value of the original content while making it more SEO-friendly and readable.`;
  }

  /**
   * Generate SEO metadata
   */
  private async generateSEOMetadata(
    content: ArticleContent,
    topic: TopicConfig,
    model: any
  ): Promise<SEOMetadata> {
    const prompt = `Generate SEO metadata for the following article:

**Article Title**: ${content.title}
**Article Content**: ${content.content.substring(0, 2000)}...

**SEO Requirements**:
- Primary Keywords: ${topic.seo.keywords.join(', ')}
- Meta Title Length: ${topic.seo.meta_title_length.min}-${topic.seo.meta_title_length.max} characters
- Meta Description Length: ${topic.seo.meta_description_length.min}-${topic.seo.meta_description_length.max} characters
- Target Audience: ${topic.audience}
- Tone: ${topic.tone}

**Instructions**:
1. Create an engaging meta title that includes primary keywords
2. Write a compelling meta description that encourages clicks
3. Generate relevant keywords based on the content
4. Create social media titles and descriptions (Open Graph and Twitter)
5. Ensure all text is within specified character limits

**Output Format**:
Provide the metadata in JSON format:

\`\`\`json
{
  "title": "SEO-optimized meta title",
  "description": "Compelling meta description",
  "keywords": ["keyword1", "keyword2", "keyword3"],
  "og_title": "Open Graph title",
  "og_description": "Open Graph description", 
  "twitter_title": "Twitter title",
  "twitter_description": "Twitter description"
}
\`\`\`

Generate the SEO metadata:`;

    try {
      const messages = [
        new SystemMessage('You are an expert SEO specialist focused on creating compelling, search-optimized metadata that drives clicks and engagement.'),
        new HumanMessage(prompt),
      ];

      const response = await model.invoke(messages);
      const metadataText = response.content as string;
      
      // Parse JSON response
      const jsonMatch = metadataText.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
      const jsonString = jsonMatch ? jsonMatch[1] : metadataText;
      const parsed = JSON.parse(jsonString);

      const seoMetadata: SEOMetadata = {
        title: parsed.title || content.title,
        description: parsed.description || '',
        keywords: parsed.keywords || topic.seo.keywords,
        og_title: parsed.og_title,
        og_description: parsed.og_description,
        twitter_title: parsed.twitter_title,
        twitter_description: parsed.twitter_description,
      };

      // Validate character limits
      seoMetadata.title = this.truncateText(seoMetadata.title, topic.seo.meta_title_length.max);
      seoMetadata.description = this.truncateText(seoMetadata.description, topic.seo.meta_description_length.max);

      return seoMetadata;
    } catch (error) {
      this.logger.error('Failed to generate SEO metadata:', error);
      
      // Fallback metadata
      return this.generateFallbackSEOMetadata(content, topic);
    }
  }

  /**
   * Add internal and external links to content
   */
  private async addLinks(
    content: ArticleContent,
    topic: TopicConfig,
    citations: Citation[],
    model: any
  ): Promise<ArticleContent> {
    const currentLinks = this.countLinks(content.content);
    
    if (currentLinks.internal >= topic.seo.internal_links.min && 
        currentLinks.external >= topic.seo.external_links.min) {
      return content; // Already has enough links
    }

    const prompt = `Add relevant internal and external links to the following article content:

**Article Content**:
${content.content}

**Available Citations**:
${citations.map((citation, index) => `[${index + 1}] ${citation.title} - ${citation.url}`).join('\n')}

**Link Requirements**:
- Internal Links Needed: ${Math.max(0, topic.seo.internal_links.min - currentLinks.internal)}
- External Links Needed: ${Math.max(0, topic.seo.external_links.min - currentLinks.external)}
- Use provided citations where relevant
- Add contextual internal links to related topics
- Ensure all links add value and are naturally integrated

**Instructions**:
1. Add links naturally within the content flow
2. Use descriptive anchor text that includes relevant keywords
3. Prioritize user value over link quantity
4. Use citations from the research where appropriate
5. Suggest internal links to related topics (use placeholder URLs like /related-topic)

**Output Format**:
Provide the complete article content with added links in markdown format.

Enhanced content with links:`;

    try {
      const messages = [
        new SystemMessage('You are an expert content editor specializing in strategic link placement for SEO and user experience.'),
        new HumanMessage(prompt),
      ];

      const response = await model.invoke(messages);
      const enhancedContent = response.content as string;
      
      const cleanContent = this.cleanRefinedContent(enhancedContent);
      const wordCount = this.countWords(cleanContent);
      const readingTime = Math.ceil(wordCount / 200);

      return {
        ...content,
        content: cleanContent,
        word_count: wordCount,
        reading_time_minutes: readingTime,
        updated_at: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.error('Failed to add links:', error);
      return content; // Return original content if link addition fails
    }
  }

  /**
   * Count existing links in content
   */
  private countLinks(content: string): { internal: number; external: number } {
    const internalLinks = (content.match(/\[([^\]]+)\]\([^)]*(?:\/[^)]*|localhost|example\.com)[^)]*\)/g) || []).length;
    const externalLinks = (content.match(/\[([^\]]+)\]\(https?:\/\/[^)]+\)/g) || []).length;
    
    return { internal: internalLinks, external: externalLinks };
  }

  /**
   * Generate fallback SEO metadata
   */
  private generateFallbackSEOMetadata(content: ArticleContent, topic: TopicConfig): SEOMetadata {
    const title = this.truncateText(content.title, topic.seo.meta_title_length.max);
    const description = this.generateBasicDescription(content, topic);
    
    return {
      title,
      description,
      keywords: topic.seo.keywords,
      og_title: title,
      og_description: description,
      twitter_title: title,
      twitter_description: description,
    };
  }

  /**
   * Generate basic description from content
   */
  private generateBasicDescription(content: ArticleContent, topic: TopicConfig): string {
    // Extract first paragraph or summary
    const paragraphs = content.content.split('\n\n').filter(p => p.trim().length > 50);
    let description = paragraphs[0] || content.title;
    
    // Clean up markdown
    description = description
      .replace(/#{1,6}\s+/g, '')
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/\*([^*]+)\*/g, '$1')
      .trim();
    
    return this.truncateText(description, topic.seo.meta_description_length.max);
  }

  /**
   * Clean refined content
   */
  private cleanRefinedContent(content: string): string {
    return content
      .trim()
      .replace(/\n{3,}/g, '\n\n') // Normalize line breaks
      .replace(/^\s*```[\s\S]*?```\s*/gm, '') // Remove any code blocks that might have been added
      .trim();
  }

  /**
   * Truncate text to specified length while preserving word boundaries
   */
  private truncateText(text: string, maxLength: number): string {
    if (text.length <= maxLength) return text;
    
    const truncated = text.substring(0, maxLength);
    const lastSpace = truncated.lastIndexOf(' ');
    
    return lastSpace > maxLength * 0.8 
      ? truncated.substring(0, lastSpace) + '...'
      : truncated.substring(0, maxLength - 3) + '...';
  }

  /**
   * Count words in text
   */
  private countWords(text: string): number {
    return text
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(word => word.length > 0).length;
  }

  /**
   * Estimate syllables in text (simplified)
   */
  private estimateSyllables(text: string): number {
    const words = text.toLowerCase().split(/\s+/);
    let syllableCount = 0;

    for (const word of words) {
      if (word.length <= 3) {
        syllableCount += 1;
      } else {
        const vowels = word.match(/[aeiouy]+/g) || [];
        syllableCount += Math.max(1, vowels.length);
      }
    }

    return syllableCount;
  }

  /**
   * Parse keyword density range
   */
  private parseKeywordDensity(densityRange: string): { min: number; max: number } {
    const match = densityRange.match(/([\d.]+)-([\d.]+)%/);
    if (match) {
      return {
        min: parseFloat(match[1]),
        max: parseFloat(match[2]),
      };
    }
    return { min: 1, max: 2 };
  }

  /**
   * Validate SEO optimization
   */
  validateSEOOptimization(
    content: ArticleContent,
    seoMetadata: SEOMetadata,
    topic: TopicConfig
  ): { score: number; issues: string[]; recommendations: string[] } {
    const issues: string[] = [];
    const recommendations: string[] = [];
    let score = 100;

    // Check meta title length
    if (seoMetadata.title.length < topic.seo.meta_title_length.min) {
      issues.push('Meta title too short');
      score -= 10;
    } else if (seoMetadata.title.length > topic.seo.meta_title_length.max) {
      issues.push('Meta title too long');
      score -= 10;
    }

    // Check meta description length
    if (seoMetadata.description.length < topic.seo.meta_description_length.min) {
      issues.push('Meta description too short');
      score -= 10;
    } else if (seoMetadata.description.length > topic.seo.meta_description_length.max) {
      issues.push('Meta description too long');
      score -= 10;
    }

    // Check keyword presence in title
    const titleLower = seoMetadata.title.toLowerCase();
    const keywordsInTitle = topic.seo.keywords.filter(keyword => 
      titleLower.includes(keyword.toLowerCase())
    ).length;
    
    if (keywordsInTitle === 0) {
      issues.push('No target keywords found in meta title');
      score -= 15;
    }

    // Check content structure
    const headings = content.content.match(/^#{1,6}\s+.+$/gm) || [];
    if (headings.length < 3) {
      recommendations.push('Consider adding more headings for better structure');
      score -= 5;
    }

    // Check reading time
    if (content.reading_time_minutes < 2) {
      recommendations.push('Article might benefit from more detailed content');
      score -= 5;
    } else if (content.reading_time_minutes > 15) {
      recommendations.push('Consider breaking up long content with more subheadings');
    }

    return {
      score: Math.max(0, score),
      issues,
      recommendations,
    };
  }
}