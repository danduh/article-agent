import { Injectable } from '@nestjs/common';
import { ChatOpenAI } from '@langchain/openai';
import { ChatAnthropic } from '@langchain/anthropic';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { TopicConfig, SEOConfig } from '../../schemas/topic-config.schema';
import { Section, SEOMetadata, Article } from '../../schemas/article.schema';

interface RefinementResult {
  sections: Section[];
  seoMetadata: SEOMetadata;
}

@Injectable()
export class RefineSEOAgent {
  private models: Map<string, any> = new Map();

  constructor() {
    this.initializeModels();
  }

  /**
   * Initialize available LLM models
   */
  private initializeModels() {
    // Initialize OpenAI models
    if (process.env.OPENAI_API_KEY) {
      this.models.set('gpt-4o', new ChatOpenAI({
        openAIApiKey: process.env.OPENAI_API_KEY,
        modelName: 'gpt-4o',
        temperature: 0.3,
      }));
      
      this.models.set('gpt-4', new ChatOpenAI({
        openAIApiKey: process.env.OPENAI_API_KEY,
        modelName: 'gpt-4',
        temperature: 0.3,
      }));
    }

    // Initialize Anthropic models
    if (process.env.ANTHROPIC_API_KEY) {
      this.models.set('anthropic/claude-3', new ChatAnthropic({
        anthropicApiKey: process.env.ANTHROPIC_API_KEY,
        modelName: 'claude-3-opus-20240229',
        temperature: 0.3,
      }));
    }
  }

  /**
   * Refine article content and optimize for SEO
   */
  async refineAndOptimize(
    sections: Section[],
    topicConfig: TopicConfig
  ): Promise<RefinementResult> {
    // Step 1: Refine content for grammar, style, and flow
    const refinedSections = await this.refineContent(sections, topicConfig);

    // Step 2: Optimize for SEO
    const seoOptimized = await this.optimizeForSEO(refinedSections, topicConfig.seo);

    // Step 3: Generate SEO metadata
    const seoMetadata = await this.generateSEOMetadata(
      seoOptimized.sections,
      topicConfig
    );

    // Step 4: Validate SEO requirements
    const validated = this.validateSEORequirements(
      seoOptimized.sections,
      seoMetadata,
      topicConfig.seo
    );

    return {
      sections: seoOptimized.sections,
      seoMetadata: validated,
    };
  }

  /**
   * Refine content for grammar, style, and readability
   */
  private async refineContent(
    sections: Section[],
    config: TopicConfig
  ): Promise<Section[]> {
    const model = this.getModel(config.models.refine);
    const refinedSections: Section[] = [];

    for (const section of sections) {
      const systemPrompt = `You are an expert editor refining article content.

Requirements:
- Fix grammar and spelling errors
- Improve sentence structure and flow
- Ensure consistent ${config.tone} tone
- Maintain ${config.reading_level} reading level
- Preserve the original meaning and key points
- Keep citations and references intact

Return only the refined content without any additional formatting or explanations.`;

      const userPrompt = `Refine the following section while maintaining its essence:\n\n${section.content}`;

      try {
        const response = await model.invoke([
          new SystemMessage(systemPrompt),
          new HumanMessage(userPrompt),
        ]);

        refinedSections.push({
          ...section,
          content: response.content.trim(),
          word_count: this.countWords(response.content),
        });
      } catch (error) {
        console.error(`Failed to refine section "${section.title}":`, error);
        refinedSections.push(section); // Keep original if refinement fails
      }
    }

    return refinedSections;
  }

  /**
   * Optimize content for SEO
   */
  private async optimizeForSEO(
    sections: Section[],
    seoConfig: SEOConfig
  ): Promise<{ sections: Section[] }> {
    const optimizedSections: Section[] = [];

    for (const section of sections) {
      let content = section.content;

      // Check keyword density
      const currentDensity = this.calculateKeywordDensity(content, seoConfig.keywords);
      const targetDensity = this.parseTargetDensity(seoConfig.keyword_density);

      // Adjust keyword density if needed
      if (this.needsKeywordAdjustment(currentDensity, targetDensity)) {
        content = await this.adjustKeywordDensity(
          content,
          seoConfig.keywords,
          targetDensity
        );
      }

      // Add internal/external links if specified
      if (section.level === 1) { // Only add links to main sections
        content = this.addLinks(content, seoConfig);
      }

      optimizedSections.push({
        ...section,
        content,
        word_count: this.countWords(content),
      });
    }

    return { sections: optimizedSections };
  }

  /**
   * Generate SEO metadata
   */
  private async generateSEOMetadata(
    sections: Section[],
    config: TopicConfig
  ): Promise<SEOMetadata> {
    const model = this.getModel(config.models.refine);
    
    // Combine all content for analysis
    const fullContent = sections.map(s => s.content).join('\n\n');
    const title = config.title;

    const systemPrompt = `You are an SEO expert generating metadata for articles.

Generate SEO metadata in JSON format:
{
  "title": "SEO-optimized title (50-60 characters)",
  "meta_description": "Compelling meta description (120-160 characters)",
  "keywords": ["keyword1", "keyword2", ...],
  "internal_links": ["suggested internal link anchors"],
  "external_links": ["suggested external link opportunities"]
}

Requirements:
- Title should be catchy and include primary keyword
- Meta description should be compelling and include keywords naturally
- Keywords should be relevant and found in the content
- Suggest 3-5 internal link opportunities
- Suggest 2-3 external link opportunities`;

    const userPrompt = `Generate SEO metadata for this article:

Title: ${title}
Primary Keywords: ${config.seo.keywords.join(', ')}

Content Preview:
${fullContent.substring(0, 1000)}...`;

    try {
      const response = await model.invoke([
        new SystemMessage(systemPrompt),
        new HumanMessage(userPrompt),
      ]);

      const metadata = this.parseSEOMetadata(response.content);
      
      // Calculate actual keyword density
      const keywordDensity: Record<string, number> = {};
      for (const keyword of config.seo.keywords) {
        keywordDensity[keyword] = this.calculateSingleKeywordDensity(fullContent, keyword);
      }

      return {
        ...metadata,
        keyword_density: keywordDensity,
      };
    } catch (error) {
      console.error('Failed to generate SEO metadata:', error);
      
      // Fallback metadata
      return {
        title: title.substring(0, 60),
        meta_description: `Learn about ${title}. ${config.seo.keywords.join(', ')}.`.substring(0, 160),
        keywords: config.seo.keywords,
        keyword_density: {},
      };
    }
  }

  /**
   * Parse SEO metadata from LLM response
   */
  private parseSEOMetadata(content: string): SEOMetadata {
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const data = JSON.parse(jsonMatch[0]);
        return {
          title: data.title || '',
          meta_description: data.meta_description || '',
          keywords: data.keywords || [],
          keyword_density: {},
          internal_links: data.internal_links,
          external_links: data.external_links,
        };
      }
    } catch (error) {
      console.error('Failed to parse SEO metadata JSON:', error);
    }

    // Fallback parsing
    return {
      title: '',
      meta_description: '',
      keywords: [],
      keyword_density: {},
    };
  }

  /**
   * Validate SEO requirements
   */
  private validateSEORequirements(
    sections: Section[],
    metadata: SEOMetadata,
    seoConfig: SEOConfig
  ): SEOMetadata {
    // Validate meta description length
    if (seoConfig.meta_description_length) {
      const { min, max } = seoConfig.meta_description_length;
      const length = metadata.meta_description.length;
      
      if (length < min) {
        console.warn(`Meta description too short: ${length} < ${min}`);
      } else if (length > max) {
        metadata.meta_description = metadata.meta_description.substring(0, max);
      }
    }

    // Validate title length
    if (metadata.title.length > 60) {
      metadata.title = metadata.title.substring(0, 60);
    }

    // Ensure all required keywords are present
    const missingKeywords = seoConfig.keywords.filter(
      keyword => !metadata.keywords.includes(keyword)
    );
    if (missingKeywords.length > 0) {
      metadata.keywords.push(...missingKeywords);
    }

    return metadata;
  }

  /**
   * Calculate keyword density for multiple keywords
   */
  private calculateKeywordDensity(
    content: string,
    keywords: string[]
  ): Record<string, number> {
    const density: Record<string, number> = {};
    
    for (const keyword of keywords) {
      density[keyword] = this.calculateSingleKeywordDensity(content, keyword);
    }

    return density;
  }

  /**
   * Calculate density for a single keyword
   */
  private calculateSingleKeywordDensity(content: string, keyword: string): number {
    const words = content.toLowerCase().split(/\s+/);
    const keywordLower = keyword.toLowerCase();
    const keywordWords = keywordLower.split(/\s+/);
    
    let count = 0;
    for (let i = 0; i <= words.length - keywordWords.length; i++) {
      const phrase = words.slice(i, i + keywordWords.length).join(' ');
      if (phrase === keywordLower) {
        count++;
      }
    }

    return (count / words.length) * 100;
  }

  /**
   * Parse target density range
   */
  private parseTargetDensity(densityRange: string): { min: number; max: number } {
    const match = densityRange.match(/(\d+)-(\d+)%/);
    if (match) {
      return {
        min: parseInt(match[1]),
        max: parseInt(match[2]),
      };
    }
    return { min: 1, max: 2 };
  }

  /**
   * Check if keyword density needs adjustment
   */
  private needsKeywordAdjustment(
    current: Record<string, number>,
    target: { min: number; max: number }
  ): boolean {
    for (const density of Object.values(current)) {
      if (density < target.min || density > target.max) {
        return true;
      }
    }
    return false;
  }

  /**
   * Adjust keyword density in content
   */
  private async adjustKeywordDensity(
    content: string,
    keywords: string[],
    target: { min: number; max: number }
  ): Promise<string> {
    // Simple implementation: add keywords naturally if density is too low
    const currentDensity = this.calculateKeywordDensity(content, keywords);
    
    for (const [keyword, density] of Object.entries(currentDensity)) {
      if (density < target.min) {
        // Add keyword mentions
        const sentences = content.split('. ');
        const insertPositions = [
          Math.floor(sentences.length * 0.25),
          Math.floor(sentences.length * 0.5),
          Math.floor(sentences.length * 0.75),
        ];

        for (const pos of insertPositions) {
          if (pos < sentences.length && density < target.min) {
            sentences[pos] += ` This relates to ${keyword}.`;
          }
        }

        content = sentences.join('. ');
      }
    }

    return content;
  }

  /**
   * Add internal and external links
   */
  private addLinks(content: string, seoConfig: SEOConfig): string {
    // This is a simplified implementation
    // In production, you'd have a more sophisticated link insertion strategy
    
    if (seoConfig.internal_links && seoConfig.internal_links > 0) {
      // Add placeholder for internal links
      const sentences = content.split('. ');
      if (sentences.length > 5) {
        sentences[2] += ' [Internal link opportunity]';
      }
      content = sentences.join('. ');
    }

    if (seoConfig.external_links && seoConfig.external_links > 0) {
      // Add placeholder for external links
      const sentences = content.split('. ');
      if (sentences.length > 10) {
        sentences[8] += ' [External link to authoritative source]';
      }
      content = sentences.join('. ');
    }

    return content;
  }

  /**
   * Count words in content
   */
  private countWords(content: string): number {
    return content.split(/\s+/).filter(word => word.length > 0).length;
  }

  /**
   * Get model instance by name
   */
  private getModel(modelName: string): any {
    // Handle Azure OpenAI format
    if (modelName.startsWith('azure/')) {
      const azureModel = modelName.replace('azure/', '');
      // In production, you'd use Azure OpenAI SDK here
      return this.models.get('gpt-4') || this.models.get('gpt-4o');
    }

    const model = this.models.get(modelName);
    if (!model) {
      const fallback = this.models.values().next().value;
      if (!fallback) {
        throw new Error('No LLM models available. Please configure API keys.');
      }
      console.warn(`Model ${modelName} not found, using fallback`);
      return fallback;
    }
    return model;
  }
}