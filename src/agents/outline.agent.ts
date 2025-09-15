import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChatOpenAI } from '@langchain/openai';
import { ChatAnthropic } from '@langchain/anthropic';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { TopicConfig } from '../schemas/topic-config.schema';
import { ArticleOutline, Section, ResearchResult } from '../schemas/article.schema';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class OutlineAgent {
  private readonly logger = new Logger(OutlineAgent.name);
  private readonly models: Map<string, any> = new Map();

  constructor(private readonly configService: ConfigService) {
    this.initializeModels();
  }

  /**
   * Initialize AI models for outline generation
   */
  private initializeModels(): void {
    try {
      // OpenAI models
      const openaiApiKey = this.configService.get<string>('OPENAI_API_KEY');
      if (openaiApiKey) {
        this.models.set('gpt-4o', new ChatOpenAI({
          modelName: 'gpt-4o',
          temperature: 0.3,
          openAIApiKey: openaiApiKey,
        }));
        
        this.models.set('gpt-4', new ChatOpenAI({
          modelName: 'gpt-4',
          temperature: 0.3,
          openAIApiKey: openaiApiKey,
        }));
      }

      // Anthropic models
      const anthropicApiKey = this.configService.get<string>('ANTHROPIC_API_KEY');
      if (anthropicApiKey) {
        this.models.set('anthropic/claude-3-5-sonnet', new ChatAnthropic({
          modelName: 'claude-3-5-sonnet-20241022',
          temperature: 0.3,
          anthropicApiKey: anthropicApiKey,
        }));

        this.models.set('anthropic/claude-3-haiku', new ChatAnthropic({
          modelName: 'claude-3-haiku-20240307',
          temperature: 0.3,
          anthropicApiKey: anthropicApiKey,
        }));
      }

      this.logger.log(`Initialized ${this.models.size} models for outline generation`);
    } catch (error) {
      this.logger.error('Failed to initialize outline models:', error);
    }
  }

  /**
   * Generate article outline based on topic configuration and research
   */
  async generateOutline(
    topic: TopicConfig,
    researchResult?: ResearchResult | null
  ): Promise<ArticleOutline> {
    this.logger.log(`Generating outline for topic: ${topic.id} using model: ${topic.models.outline}`);

    const model = this.models.get(topic.models.outline);
    if (!model) {
      throw new Error(`Model not available: ${topic.models.outline}`);
    }

    try {
      const prompt = this.buildOutlinePrompt(topic, researchResult);
      const messages = [
        new SystemMessage(this.getSystemPrompt(topic)),
        new HumanMessage(prompt),
      ];

      const response = await model.invoke(messages);
      const outlineText = response.content as string;

      const outline = this.parseOutlineResponse(outlineText, topic);
      
      this.logger.log(`Generated outline with ${outline.sections.length} sections`);
      return outline;
    } catch (error) {
      this.logger.error(`Failed to generate outline for topic ${topic.id}:`, error);
      throw error;
    }
  }

  /**
   * Build the outline generation prompt
   */
  private buildOutlinePrompt(topic: TopicConfig, researchResult?: ResearchResult | null): string {
    let prompt = `Create a comprehensive article outline for the following topic:

**Topic**: ${topic.title}
**Description**: ${topic.description || 'Not provided'}
**Target Audience**: ${topic.audience}
**Tone**: ${topic.tone}
**Reading Level**: ${topic.reading_level}
**Target Length**: ${topic.length} words
**Language**: ${topic.language}

**Required Sections**: ${topic.outline.required_sections.join(', ')}
**Maximum Sections**: ${topic.outline.max_sections}
**Section Depth**: Up to H${topic.outline.section_depth}
**Include Subsections**: ${topic.outline.include_subsections ? 'Yes' : 'No'}

**SEO Keywords**: ${topic.seo.keywords.join(', ')}`;

    if (researchResult && researchResult.sources.length > 0) {
      prompt += `\n\n**Research Findings**:
${researchResult.summary}

**Key Points from Research**:
${researchResult.key_points.slice(0, 10).map(point => `- ${point}`).join('\n')}

**Top Sources**:
${researchResult.sources.slice(0, 5).map(source => `- ${source.title} (${source.domain}): ${source.snippet}`).join('\n')}`;
    }

    prompt += `\n\n**Instructions**:
1. Create a structured outline that covers all required sections
2. Ensure the outline flows logically and tells a complete story
3. Include estimated word counts for each section to reach the target length
4. Incorporate the provided SEO keywords naturally throughout the outline
5. Consider the research findings when structuring the content
6. Match the specified tone and reading level
7. Create engaging section titles that would interest the target audience

**Output Format**:
Provide the outline in the following JSON format:

\`\`\`json
{
  "title": "Final article title",
  "sections": [
    {
      "id": "unique-section-id",
      "title": "Section Title",
      "level": 1,
      "subsections": [
        {
          "id": "unique-subsection-id", 
          "title": "Subsection Title",
          "level": 2,
          "word_count": 200
        }
      ],
      "word_count": 300
    }
  ],
  "estimated_word_count": 1500
}
\`\`\`

Generate the outline now:`;

    return prompt;
  }

  /**
   * Get system prompt for outline generation
   */
  private getSystemPrompt(topic: TopicConfig): string {
    return `You are an expert content strategist and article outline creator. Your task is to create comprehensive, well-structured outlines for articles that:

1. **Audience-Focused**: Perfectly match the target audience (${topic.audience}) and their knowledge level
2. **SEO-Optimized**: Naturally incorporate keywords while maintaining readability
3. **Logically Structured**: Follow a clear progression that guides readers through the topic
4. **Engaging**: Use compelling section titles that encourage continued reading
5. **Comprehensive**: Cover all aspects of the topic thoroughly within the word count limit
6. **Research-Informed**: Leverage provided research to ensure accuracy and relevance

**Writing Guidelines**:
- Tone: ${topic.tone}
- Reading Level: ${topic.reading_level} 
- Target Length: ${topic.length} words
- Required Sections: ${topic.outline.required_sections.join(', ')}

Always respond with valid JSON in the exact format specified. Ensure all section IDs are unique and use kebab-case formatting.`;
  }

  /**
   * Parse the AI model's outline response
   */
  private parseOutlineResponse(response: string, topic: TopicConfig): ArticleOutline {
    try {
      // Extract JSON from response (handle code blocks)
      const jsonMatch = response.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
      const jsonString = jsonMatch ? jsonMatch[1] : response;
      
      const parsed = JSON.parse(jsonString);
      
      // Validate and transform the parsed outline
      const sections = this.processSections(parsed.sections || [], 1);
      
      // Ensure required sections are present
      this.validateRequiredSections(sections, topic.outline.required_sections);
      
      // Calculate total word count
      const estimatedWordCount = this.calculateTotalWordCount(sections);
      
      const outline: ArticleOutline = {
        title: parsed.title || topic.title,
        sections,
        estimated_word_count: estimatedWordCount,
        created_at: new Date().toISOString(),
      };

      return outline;
    } catch (error) {
      this.logger.error('Failed to parse outline response:', error);
      
      // Fallback: create a basic outline from required sections
      return this.createFallbackOutline(topic);
    }
  }

  /**
   * Process sections recursively and assign IDs
   */
  private processSections(sections: any[], level: number): Section[] {
    return sections.map(section => {
      const processedSection: Section = {
        id: section.id || this.generateSectionId(section.title),
        title: section.title,
        level,
        word_count: section.word_count || 0,
      };

      if (section.subsections && section.subsections.length > 0) {
        processedSection.subsections = this.processSections(section.subsections, level + 1);
      }

      return processedSection;
    });
  }

  /**
   * Generate a section ID from title
   */
  private generateSectionId(title: string): string {
    return title
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .trim()
      .slice(0, 50) + '-' + uuidv4().slice(0, 8);
  }

  /**
   * Validate that required sections are present
   */
  private validateRequiredSections(sections: Section[], requiredSections: string[]): void {
    const sectionTitles = sections.map(s => s.title.toLowerCase());
    
    for (const required of requiredSections) {
      const found = sectionTitles.some(title => 
        title.includes(required.toLowerCase()) || 
        required.toLowerCase().includes(title)
      );
      
      if (!found) {
        this.logger.warn(`Required section missing: ${required}`);
        // Add missing section
        sections.push({
          id: this.generateSectionId(required),
          title: required,
          level: 1,
          word_count: 200,
        });
      }
    }
  }

  /**
   * Calculate total word count for all sections
   */
  private calculateTotalWordCount(sections: Section[]): number {
    return sections.reduce((total, section) => {
      let sectionTotal = section.word_count || 0;
      
      if (section.subsections) {
        sectionTotal += this.calculateTotalWordCount(section.subsections);
      }
      
      return total + sectionTotal;
    }, 0);
  }

  /**
   * Create a fallback outline if AI generation fails
   */
  private createFallbackOutline(topic: TopicConfig): ArticleOutline {
    this.logger.warn(`Creating fallback outline for topic: ${topic.id}`);
    
    const targetWords = this.parseWordCount(topic.length);
    const wordsPerSection = Math.floor(targetWords / topic.outline.required_sections.length);
    
    const sections: Section[] = topic.outline.required_sections.map(sectionTitle => ({
      id: this.generateSectionId(sectionTitle),
      title: sectionTitle,
      level: 1,
      word_count: wordsPerSection,
    }));

    return {
      title: topic.title,
      sections,
      estimated_word_count: targetWords,
      created_at: new Date().toISOString(),
    };
  }

  /**
   * Parse word count range (e.g., "1200-1500" -> 1350)
   */
  private parseWordCount(lengthRange: string): number {
    const match = lengthRange.match(/(\d+)-(\d+)/);
    if (match) {
      const min = parseInt(match[1]);
      const max = parseInt(match[2]);
      return Math.floor((min + max) / 2);
    }
    return 1000; // Default fallback
  }

  /**
   * Regenerate outline with different approach
   */
  async regenerateOutline(
    topic: TopicConfig,
    currentOutline: ArticleOutline,
    feedback?: string
  ): Promise<ArticleOutline> {
    this.logger.log(`Regenerating outline for topic: ${topic.id}`);

    const model = this.models.get(topic.models.outline);
    if (!model) {
      throw new Error(`Model not available: ${topic.models.outline}`);
    }

    const prompt = `Please regenerate the article outline with the following improvements:

**Current Outline Issues**: ${feedback || 'General improvements needed'}

**Current Outline**:
${JSON.stringify(currentOutline, null, 2)}

**Topic Requirements**:
- Title: ${topic.title}
- Audience: ${topic.audience}
- Tone: ${topic.tone}
- Length: ${topic.length} words
- Required Sections: ${topic.outline.required_sections.join(', ')}

Please provide an improved outline that addresses the feedback while maintaining all requirements.`;

    try {
      const messages = [
        new SystemMessage(this.getSystemPrompt(topic)),
        new HumanMessage(prompt),
      ];

      const response = await model.invoke(messages);
      const outlineText = response.content as string;

      return this.parseOutlineResponse(outlineText, topic);
    } catch (error) {
      this.logger.error(`Failed to regenerate outline:`, error);
      throw error;
    }
  }

  /**
   * Validate outline against topic requirements
   */
  validateOutline(outline: ArticleOutline, topic: TopicConfig): {
    valid: boolean;
    issues: string[];
  } {
    const issues: string[] = [];

    // Check word count
    const targetWords = this.parseWordCount(topic.length);
    const wordCountDiff = Math.abs(outline.estimated_word_count - targetWords) / targetWords;
    if (wordCountDiff > 0.2) {
      issues.push(`Word count mismatch: ${outline.estimated_word_count} vs target ${targetWords}`);
    }

    // Check required sections
    const sectionTitles = outline.sections.map(s => s.title.toLowerCase());
    for (const required of topic.outline.required_sections) {
      const found = sectionTitles.some(title => 
        title.includes(required.toLowerCase()) || 
        required.toLowerCase().includes(title)
      );
      if (!found) {
        issues.push(`Missing required section: ${required}`);
      }
    }

    // Check section count
    if (outline.sections.length > topic.outline.max_sections) {
      issues.push(`Too many sections: ${outline.sections.length} > ${topic.outline.max_sections}`);
    }

    // Check section depth
    const maxDepth = this.getMaxSectionDepth(outline.sections);
    if (maxDepth > topic.outline.section_depth) {
      issues.push(`Section depth too deep: ${maxDepth} > ${topic.outline.section_depth}`);
    }

    return {
      valid: issues.length === 0,
      issues,
    };
  }

  /**
   * Get maximum section depth
   */
  private getMaxSectionDepth(sections: Section[]): number {
    let maxDepth = 0;
    
    for (const section of sections) {
      maxDepth = Math.max(maxDepth, section.level);
      
      if (section.subsections) {
        maxDepth = Math.max(maxDepth, this.getMaxSectionDepth(section.subsections));
      }
    }
    
    return maxDepth;
  }
}