import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChatOpenAI } from '@langchain/openai';
import { ChatAnthropic } from '@langchain/anthropic';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { TopicConfig } from '../schemas/topic-config.schema';
import { 
  ArticleOutline, 
  ArticleContent, 
  Section, 
  ResearchResult, 
  Citation 
} from '../schemas/article.schema';

interface SectionContent {
  id: string;
  title: string;
  content: string;
  wordCount: number;
  citations?: string[];
}

@Injectable()
export class DraftAgent {
  private readonly logger = new Logger(DraftAgent.name);
  private readonly models: Map<string, any> = new Map();

  constructor(private readonly configService: ConfigService) {
    this.initializeModels();
  }

  /**
   * Initialize AI models for draft generation
   */
  private initializeModels(): void {
    try {
      // OpenAI models
      const openaiApiKey = this.configService.get<string>('OPENAI_API_KEY');
      if (openaiApiKey) {
        this.models.set('gpt-4o', new ChatOpenAI({
          modelName: 'gpt-4o',
          temperature: 0.4,
          openAIApiKey: openaiApiKey,
        }));
        
        this.models.set('gpt-4', new ChatOpenAI({
          modelName: 'gpt-4',
          temperature: 0.4,
          openAIApiKey: openaiApiKey,
        }));

        this.models.set('gpt-3.5-turbo', new ChatOpenAI({
          modelName: 'gpt-3.5-turbo',
          temperature: 0.4,
          openAIApiKey: openaiApiKey,
        }));
      }

      // Anthropic models
      const anthropicApiKey = this.configService.get<string>('ANTHROPIC_API_KEY');
      if (anthropicApiKey) {
        this.models.set('anthropic/claude-3-5-sonnet', new ChatAnthropic({
          modelName: 'claude-3-5-sonnet-20241022',
          temperature: 0.4,
          anthropicApiKey: anthropicApiKey,
        }));

        this.models.set('anthropic/claude-3-haiku', new ChatAnthropic({
          modelName: 'claude-3-haiku-20240307',
          temperature: 0.4,
          anthropicApiKey: anthropicApiKey,
        }));
      }

      this.logger.log(`Initialized ${this.models.size} models for draft generation`);
    } catch (error) {
      this.logger.error('Failed to initialize draft models:', error);
    }
  }

  /**
   * Generate complete article draft based on outline and research
   */
  async generateDraft(
    topic: TopicConfig,
    outline: ArticleOutline,
    researchResult?: ResearchResult | null
  ): Promise<ArticleContent> {
    this.logger.log(`Generating draft for topic: ${topic.id} using model: ${topic.models.draft}`);

    const model = this.models.get(topic.models.draft);
    if (!model) {
      throw new Error(`Model not available: ${topic.models.draft}`);
    }

    try {
      // Generate content for each section
      const sectionContents: SectionContent[] = [];
      
      for (const section of outline.sections) {
        const sectionContent = await this.generateSectionContent(
          section,
          topic,
          researchResult,
          model,
          outline
        );
        sectionContents.push(sectionContent);
      }

      // Combine all sections into final article
      const fullContent = this.combineArticleContent(sectionContents, outline);
      const wordCount = this.countWords(fullContent);
      const readingTime = Math.ceil(wordCount / 200); // Assume 200 words per minute

      const articleContent: ArticleContent = {
        title: outline.title,
        content: fullContent,
        sections: this.convertToSectionSchema(sectionContents),
        word_count: wordCount,
        reading_time_minutes: readingTime,
        language: topic.language,
        created_at: new Date().toISOString(),
      };

      this.logger.log(`Generated draft with ${wordCount} words (${readingTime} min read)`);
      return articleContent;
    } catch (error) {
      this.logger.error(`Failed to generate draft for topic ${topic.id}:`, error);
      throw error;
    }
  }

  /**
   * Generate content for a specific section
   */
  private async generateSectionContent(
    section: Section,
    topic: TopicConfig,
    researchResult: ResearchResult | null,
    model: any,
    outline: ArticleOutline
  ): Promise<SectionContent> {
    this.logger.debug(`Generating content for section: ${section.title}`);

    const prompt = this.buildSectionPrompt(section, topic, researchResult, outline);
    const messages = [
      new SystemMessage(this.getSectionSystemPrompt(topic, section)),
      new HumanMessage(prompt),
    ];

    try {
      const response = await model.invoke(messages);
      const content = response.content as string;
      
      // Clean up the content
      const cleanContent = this.cleanSectionContent(content);
      const wordCount = this.countWords(cleanContent);
      const citations = this.extractCitations(cleanContent, researchResult);

      return {
        id: section.id,
        title: section.title,
        content: cleanContent,
        wordCount,
        citations,
      };
    } catch (error) {
      this.logger.error(`Failed to generate content for section ${section.title}:`, error);
      
      // Return a basic section with placeholder content
      return {
        id: section.id,
        title: section.title,
        content: this.generatePlaceholderContent(section, topic),
        wordCount: section.word_count || 200,
        citations: [],
      };
    }
  }

  /**
   * Build prompt for section content generation
   */
  private buildSectionPrompt(
    section: Section,
    topic: TopicConfig,
    researchResult: ResearchResult | null,
    outline: ArticleOutline
  ): string {
    let prompt = `Write the content for the following article section:

**Article Title**: ${outline.title}
**Section Title**: ${section.title}
**Target Word Count**: ${section.word_count || 200} words
**Section Level**: H${section.level}

**Article Context**:
- Topic: ${topic.title}
- Audience: ${topic.audience}
- Tone: ${topic.tone}
- Reading Level: ${topic.reading_level}
- SEO Keywords: ${topic.seo.keywords.join(', ')}

**Article Outline Context**:
${outline.sections.map(s => `- ${s.title} (${s.word_count || 'TBD'} words)`).join('\n')}`;

    if (researchResult && researchResult.sources.length > 0) {
      prompt += `\n\n**Research Information**:
${researchResult.summary}

**Relevant Key Points**:
${researchResult.key_points.slice(0, 8).map(point => `- ${point}`).join('\n')}

**Available Sources** (reference by number):
${researchResult.sources.slice(0, 8).map((source, index) => 
  `[${index + 1}] ${source.title} - ${source.snippet} (${source.url})`
).join('\n')}`;
    }

    if (section.subsections && section.subsections.length > 0) {
      prompt += `\n\n**Subsections to Cover**:
${section.subsections.map(sub => `- ${sub.title} (${sub.word_count || 'TBD'} words)`).join('\n')}`;
    }

    prompt += `\n\n**Writing Instructions**:
1. Write engaging, informative content that matches the specified tone and reading level
2. Naturally incorporate SEO keywords without keyword stuffing
3. Include specific, actionable information relevant to the target audience
4. Use clear, well-structured paragraphs with smooth transitions
5. If research sources are available, reference them using [1], [2], etc. format
6. Write in ${topic.language} language
7. Aim for approximately ${section.word_count || 200} words
8. Use markdown formatting for emphasis and structure
9. Ensure the content flows well with the overall article structure
10. Make the content valuable and informative for ${topic.audience}

**Output Format**:
Provide only the section content in markdown format. Do not include the section title as a heading - that will be added separately.

Generate the section content now:`;

    return prompt;
  }

  /**
   * Get system prompt for section generation
   */
  private getSectionSystemPrompt(topic: TopicConfig, section: Section): string {
    return `You are an expert content writer specializing in creating high-quality, engaging articles for ${topic.audience}. Your writing style is ${topic.tone} and appropriate for ${topic.reading_level} reading level.

Key responsibilities:
1. **Content Quality**: Create informative, accurate, and valuable content
2. **SEO Optimization**: Naturally incorporate keywords while maintaining readability
3. **Audience Focus**: Write specifically for ${topic.audience} with their needs in mind
4. **Structure**: Use clear, logical organization with smooth transitions
5. **Engagement**: Keep readers interested and provide actionable insights
6. **Research Integration**: Seamlessly incorporate research findings when available

Writing Guidelines:
- Tone: ${topic.tone}
- Reading Level: ${topic.reading_level}
- Language: ${topic.language}
- Target Keywords: ${topic.seo.keywords.join(', ')}

Always provide content that is well-researched, engaging, and valuable to the target audience.`;
  }

  /**
   * Clean and format section content
   */
  private cleanSectionContent(content: string): string {
    return content
      .trim()
      .replace(/^#{1,6}\s+.*$/gm, '') // Remove any headings the model might have added
      .replace(/\n{3,}/g, '\n\n') // Normalize multiple line breaks
      .replace(/^\s*-\s*$/gm, '') // Remove empty bullet points
      .trim();
  }

  /**
   * Extract citation references from content
   */
  private extractCitations(content: string, researchResult: ResearchResult | null): string[] {
    if (!researchResult) return [];

    const citationMatches = content.match(/\[(\d+)\]/g) || [];
    const citationNumbers = citationMatches.map(match => 
      parseInt(match.replace(/[\[\]]/g, '')) - 1
    );

    const citations: string[] = [];
    for (const num of citationNumbers) {
      if (researchResult.sources[num]) {
        citations.push(researchResult.sources[num].id);
      }
    }

    return [...new Set(citations)]; // Remove duplicates
  }

  /**
   * Generate placeholder content for failed sections
   */
  private generatePlaceholderContent(section: Section, topic: TopicConfig): string {
    return `This section will cover ${section.title.toLowerCase()} in detail. Content related to ${topic.seo.keywords[0] || topic.title} will be provided here, tailored for ${topic.audience}.

The content will maintain a ${topic.tone} tone and be appropriate for ${topic.reading_level} reading level. This placeholder ensures the article structure remains intact while detailed content is being generated.`;
  }

  /**
   * Combine all section contents into final article
   */
  private combineArticleContent(sectionContents: SectionContent[], outline: ArticleOutline): string {
    let fullContent = `# ${outline.title}\n\n`;

    for (const sectionContent of sectionContents) {
      // Add section heading
      const level = this.getSectionLevel(sectionContent.id, outline.sections);
      const heading = '#'.repeat(level + 1) + ` ${sectionContent.title}`;
      
      fullContent += `${heading}\n\n${sectionContent.content}\n\n`;
    }

    return fullContent.trim();
  }

  /**
   * Get section level from outline
   */
  private getSectionLevel(sectionId: string, sections: Section[]): number {
    for (const section of sections) {
      if (section.id === sectionId) {
        return section.level;
      }
      
      if (section.subsections) {
        const level = this.getSectionLevel(sectionId, section.subsections);
        if (level > 0) return level;
      }
    }
    return 1; // Default to H2
  }

  /**
   * Convert section contents to Section schema format
   */
  private convertToSectionSchema(sectionContents: SectionContent[]): Section[] {
    return sectionContents.map(content => ({
      id: content.id,
      title: content.title,
      level: 2, // Will be adjusted based on outline
      content: content.content,
      citations: content.citations,
      word_count: content.wordCount,
    }));
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
   * Regenerate specific sections of an article
   */
  async regenerateSections(
    topic: TopicConfig,
    outline: ArticleOutline,
    sectionIds: string[],
    currentContent: ArticleContent,
    researchResult?: ResearchResult | null,
    feedback?: string
  ): Promise<ArticleContent> {
    this.logger.log(`Regenerating ${sectionIds.length} sections for topic: ${topic.id}`);

    const model = this.models.get(topic.models.draft);
    if (!model) {
      throw new Error(`Model not available: ${topic.models.draft}`);
    }

    try {
      const updatedSections = [...currentContent.sections];

      for (const sectionId of sectionIds) {
        const section = this.findSectionInOutline(sectionId, outline.sections);
        if (!section) {
          this.logger.warn(`Section not found in outline: ${sectionId}`);
          continue;
        }

        const regeneratedContent = await this.regenerateSectionContent(
          section,
          topic,
          researchResult,
          model,
          outline,
          feedback
        );

        // Update the section in the array
        const sectionIndex = updatedSections.findIndex(s => s.id === sectionId);
        if (sectionIndex >= 0) {
          updatedSections[sectionIndex] = {
            ...updatedSections[sectionIndex],
            content: regeneratedContent.content,
            word_count: regeneratedContent.wordCount,
            citations: regeneratedContent.citations,
          };
        }
      }

      // Rebuild full content
      const sectionContents = updatedSections.map(section => ({
        id: section.id,
        title: section.title,
        content: section.content || '',
        wordCount: section.word_count || 0,
        citations: section.citations,
      }));

      const fullContent = this.combineArticleContent(sectionContents, outline);
      const wordCount = this.countWords(fullContent);
      const readingTime = Math.ceil(wordCount / 200);

      return {
        ...currentContent,
        content: fullContent,
        sections: updatedSections,
        word_count: wordCount,
        reading_time_minutes: readingTime,
        updated_at: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.error(`Failed to regenerate sections:`, error);
      throw error;
    }
  }

  /**
   * Regenerate content for a specific section with feedback
   */
  private async regenerateSectionContent(
    section: Section,
    topic: TopicConfig,
    researchResult: ResearchResult | null,
    model: any,
    outline: ArticleOutline,
    feedback?: string
  ): Promise<SectionContent> {
    const basePrompt = this.buildSectionPrompt(section, topic, researchResult, outline);
    
    let prompt = basePrompt;
    if (feedback) {
      prompt += `\n\n**Regeneration Feedback**:
${feedback}

Please address this feedback while regenerating the section content.`;
    }

    const messages = [
      new SystemMessage(this.getSectionSystemPrompt(topic, section)),
      new HumanMessage(prompt),
    ];

    const response = await model.invoke(messages);
    const content = response.content as string;
    
    const cleanContent = this.cleanSectionContent(content);
    const wordCount = this.countWords(cleanContent);
    const citations = this.extractCitations(cleanContent, researchResult);

    return {
      id: section.id,
      title: section.title,
      content: cleanContent,
      wordCount,
      citations,
    };
  }

  /**
   * Find section in outline by ID
   */
  private findSectionInOutline(sectionId: string, sections: Section[]): Section | null {
    for (const section of sections) {
      if (section.id === sectionId) {
        return section;
      }
      
      if (section.subsections) {
        const found = this.findSectionInOutline(sectionId, section.subsections);
        if (found) return found;
      }
    }
    return null;
  }

  /**
   * Validate draft against topic requirements
   */
  validateDraft(content: ArticleContent, topic: TopicConfig): {
    valid: boolean;
    issues: string[];
    suggestions: string[];
  } {
    const issues: string[] = [];
    const suggestions: string[] = [];

    // Check word count
    const targetRange = topic.length.split('-').map(Number);
    const minWords = targetRange[0];
    const maxWords = targetRange[1];
    
    if (content.word_count < minWords) {
      issues.push(`Word count too low: ${content.word_count} < ${minWords}`);
    } else if (content.word_count > maxWords) {
      issues.push(`Word count too high: ${content.word_count} > ${maxWords}`);
    }

    // Check keyword density
    const keywordDensity = this.calculateKeywordDensity(content.content, topic.seo.keywords);
    const targetDensity = this.parseKeywordDensity(topic.seo.keyword_density);
    
    if (keywordDensity < targetDensity.min || keywordDensity > targetDensity.max) {
      suggestions.push(`Keyword density is ${keywordDensity.toFixed(1)}%, target: ${topic.seo.keyword_density}`);
    }

    // Check reading time
    if (content.reading_time_minutes < 2) {
      suggestions.push('Article might be too short for meaningful engagement');
    } else if (content.reading_time_minutes > 15) {
      suggestions.push('Article might be too long for target audience attention span');
    }

    return {
      valid: issues.length === 0,
      issues,
      suggestions,
    };
  }

  /**
   * Calculate keyword density in content
   */
  private calculateKeywordDensity(content: string, keywords: string[]): number {
    const words = content.toLowerCase().split(/\s+/).length;
    let keywordCount = 0;

    for (const keyword of keywords) {
      const regex = new RegExp(keyword.toLowerCase().replace(/\s+/g, '\\s+'), 'gi');
      const matches = content.match(regex) || [];
      keywordCount += matches.length;
    }

    return words > 0 ? (keywordCount / words) * 100 : 0;
  }

  /**
   * Parse keyword density range (e.g., "1-2%" -> {min: 1, max: 2})
   */
  private parseKeywordDensity(densityRange: string): { min: number; max: number } {
    const match = densityRange.match(/([\d.]+)-([\d.]+)%/);
    if (match) {
      return {
        min: parseFloat(match[1]),
        max: parseFloat(match[2]),
      };
    }
    return { min: 1, max: 2 }; // Default fallback
  }
}