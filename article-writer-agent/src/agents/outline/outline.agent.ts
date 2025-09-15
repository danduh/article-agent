import { Injectable } from '@nestjs/common';
import { ChatOpenAI } from '@langchain/openai';
import { ChatAnthropic } from '@langchain/anthropic';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { OutlineConfig, TopicConfig } from '../../schemas/topic-config.schema';
import { Citation } from '../../schemas/article.schema';
import { v4 as uuidv4 } from 'uuid';

export interface OutlineSection {
  id: string;
  level: number;
  title: string;
  description: string;
  estimated_words: number;
  citations?: string[];
  subsections?: OutlineSection[];
}

export interface ArticleOutline {
  title: string;
  sections: OutlineSection[];
  total_estimated_words: number;
}

@Injectable()
export class OutlineAgent {
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
   * Generate article outline based on topic configuration
   */
  async generateOutline(
    topicConfig: TopicConfig,
    citations: Citation[]
  ): Promise<ArticleOutline> {
    const model = this.getModel(topicConfig.models.outline);
    
    const systemPrompt = this.buildSystemPrompt(topicConfig);
    const userPrompt = this.buildUserPrompt(topicConfig, citations);

    const messages = [
      new SystemMessage(systemPrompt),
      new HumanMessage(userPrompt),
    ];

    try {
      const response = await model.invoke(messages);
      const outlineData = this.parseOutlineResponse(response.content);
      
      // Ensure required sections are included
      const outline = this.ensureRequiredSections(outlineData, topicConfig.outline);
      
      // Calculate estimated words
      const withEstimates = this.calculateWordEstimates(outline, topicConfig.length);
      
      return withEstimates;
    } catch (error) {
      console.error('Failed to generate outline:', error);
      // Fallback to a basic outline
      return this.createFallbackOutline(topicConfig);
    }
  }

  /**
   * Build system prompt for outline generation
   */
  private buildSystemPrompt(config: TopicConfig): string {
    return `You are an expert content strategist creating article outlines.

Your task is to generate a structured outline for an article with the following requirements:
- Audience: ${config.audience}
- Tone: ${config.tone}
- Reading Level: ${config.reading_level}
- Target Length: ${config.length} words

Guidelines:
1. Create a hierarchical structure with H1, H2, and H3 sections
2. Each section should have a clear purpose and flow logically
3. Include brief descriptions for what each section will cover
4. Estimate word count for each section
5. Ensure the outline covers the topic comprehensively

Output the outline in JSON format with this structure:
{
  "title": "Article Title",
  "sections": [
    {
      "level": 1,
      "title": "Section Title",
      "description": "What this section covers",
      "estimated_words": 200,
      "subsections": [...]
    }
  ]
}`;
  }

  /**
   * Build user prompt with topic and research
   */
  private buildUserPrompt(config: TopicConfig, citations: Citation[]): string {
    let prompt = `Create an outline for an article about: "${config.title}"`;
    
    if (config.description) {
      prompt += `\n\nTopic Description: ${config.description}`;
    }

    if (config.outline.required_sections.length > 0) {
      prompt += `\n\nRequired Sections (must be included):`;
      config.outline.required_sections.forEach(section => {
        prompt += `\n- ${section}`;
      });
    }

    if (citations.length > 0) {
      prompt += `\n\nResearch Sources Available:`;
      citations.slice(0, 5).forEach(citation => {
        prompt += `\n- ${citation.title}: ${citation.excerpt}`;
      });
    }

    if (config.seo.keywords.length > 0) {
      prompt += `\n\nKey Topics to Cover:`;
      config.seo.keywords.forEach(keyword => {
        prompt += `\n- ${keyword}`;
      });
    }

    if (config.custom_instructions) {
      prompt += `\n\nAdditional Instructions: ${config.custom_instructions}`;
    }

    return prompt;
  }

  /**
   * Parse LLM response into outline structure
   */
  private parseOutlineResponse(content: string): ArticleOutline {
    try {
      // Try to parse as JSON first
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const data = JSON.parse(jsonMatch[0]);
        return {
          title: data.title,
          sections: this.normalizeSections(data.sections),
          total_estimated_words: 0,
        };
      }
    } catch (error) {
      console.error('Failed to parse outline JSON:', error);
    }

    // Fallback: parse as text
    return this.parseTextOutline(content);
  }

  /**
   * Normalize sections structure
   */
  private normalizeSections(sections: any[]): OutlineSection[] {
    return sections.map(section => ({
      id: uuidv4(),
      level: section.level || 1,
      title: section.title,
      description: section.description || '',
      estimated_words: section.estimated_words || 150,
      subsections: section.subsections ? this.normalizeSections(section.subsections) : undefined,
    }));
  }

  /**
   * Parse text-based outline
   */
  private parseTextOutline(content: string): ArticleOutline {
    const lines = content.split('\n');
    const sections: OutlineSection[] = [];
    let currentSection: OutlineSection | null = null;

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      // Detect section headers
      if (trimmed.match(/^#+\s+/)) {
        const level = (trimmed.match(/^#+/) || [''])[0].length;
        const title = trimmed.replace(/^#+\s+/, '');
        
        const section: OutlineSection = {
          id: uuidv4(),
          level: Math.min(level, 3),
          title,
          description: '',
          estimated_words: 150,
        };

        if (level === 1 || !currentSection) {
          sections.push(section);
          currentSection = section;
        } else {
          if (!currentSection.subsections) {
            currentSection.subsections = [];
          }
          currentSection.subsections.push(section);
        }
      }
    }

    return {
      title: sections[0]?.title || 'Article',
      sections,
      total_estimated_words: 0,
    };
  }

  /**
   * Ensure required sections are included
   */
  private ensureRequiredSections(
    outline: ArticleOutline,
    config: OutlineConfig
  ): ArticleOutline {
    const existingSectionTitles = new Set(
      outline.sections.map(s => s.title.toLowerCase())
    );

    for (const requiredSection of config.required_sections) {
      if (!existingSectionTitles.has(requiredSection.toLowerCase())) {
        outline.sections.push({
          id: uuidv4(),
          level: 1,
          title: requiredSection,
          description: `Required section: ${requiredSection}`,
          estimated_words: 200,
        });
      }
    }

    return outline;
  }

  /**
   * Calculate and distribute word estimates
   */
  private calculateWordEstimates(
    outline: ArticleOutline,
    lengthRange: string
  ): ArticleOutline {
    const [minWords, maxWords] = lengthRange.split('-').map(Number);
    const targetWords = Math.floor((minWords + maxWords) / 2);

    // Count total sections (including subsections)
    let totalSections = 0;
    const countSections = (sections: OutlineSection[]) => {
      for (const section of sections) {
        totalSections++;
        if (section.subsections) {
          countSections(section.subsections);
        }
      }
    };
    countSections(outline.sections);

    // Distribute words proportionally
    const wordsPerSection = Math.floor(targetWords / totalSections);
    
    const distributeWords = (sections: OutlineSection[]) => {
      for (const section of sections) {
        section.estimated_words = wordsPerSection;
        if (section.subsections) {
          distributeWords(section.subsections);
        }
      }
    };
    distributeWords(outline.sections);

    outline.total_estimated_words = targetWords;
    return outline;
  }

  /**
   * Create a fallback outline if generation fails
   */
  private createFallbackOutline(config: TopicConfig): ArticleOutline {
    const sections: OutlineSection[] = [
      {
        id: uuidv4(),
        level: 1,
        title: 'Introduction',
        description: 'Introduction to the topic',
        estimated_words: 200,
      },
    ];

    // Add required sections
    for (const required of config.outline.required_sections) {
      if (required.toLowerCase() !== 'introduction') {
        sections.push({
          id: uuidv4(),
          level: 1,
          title: required,
          description: `Section about ${required}`,
          estimated_words: 300,
        });
      }
    }

    // Add conclusion if not already required
    if (!config.outline.required_sections.some(s => s.toLowerCase() === 'conclusion')) {
      sections.push({
        id: uuidv4(),
        level: 1,
        title: 'Conclusion',
        description: 'Summary and key takeaways',
        estimated_words: 150,
      });
    }

    return {
      title: config.title,
      sections,
      total_estimated_words: sections.reduce((sum, s) => sum + s.estimated_words, 0),
    };
  }

  /**
   * Get model instance by name
   */
  private getModel(modelName: string): any {
    const model = this.models.get(modelName);
    if (!model) {
      // Fallback to first available model
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