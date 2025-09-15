import { Injectable } from '@nestjs/common';
import { ChatOpenAI } from '@langchain/openai';
import { ChatAnthropic } from '@langchain/anthropic';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { TopicConfig } from '../../schemas/topic-config.schema';
import { Section, Citation } from '../../schemas/article.schema';
import { OutlineSection, ArticleOutline } from '../outline/outline.agent';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class DraftAgent {
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
        temperature: 0.7,
        maxTokens: 2000,
      }));
      
      this.models.set('gpt-4', new ChatOpenAI({
        openAIApiKey: process.env.OPENAI_API_KEY,
        modelName: 'gpt-4',
        temperature: 0.7,
        maxTokens: 2000,
      }));

      this.models.set('gpt-3.5-turbo', new ChatOpenAI({
        openAIApiKey: process.env.OPENAI_API_KEY,
        modelName: 'gpt-3.5-turbo',
        temperature: 0.7,
        maxTokens: 2000,
      }));
    }

    // Initialize Anthropic models
    if (process.env.ANTHROPIC_API_KEY) {
      this.models.set('anthropic/claude-3', new ChatAnthropic({
        anthropicApiKey: process.env.ANTHROPIC_API_KEY,
        modelName: 'claude-3-opus-20240229',
        temperature: 0.7,
        maxTokens: 2000,
      }));

      this.models.set('anthropic/claude-3-sonnet', new ChatAnthropic({
        anthropicApiKey: process.env.ANTHROPIC_API_KEY,
        modelName: 'claude-3-sonnet-20240229',
        temperature: 0.7,
        maxTokens: 2000,
      }));
    }
  }

  /**
   * Generate draft content for the entire article
   */
  async generateDraft(
    outline: ArticleOutline,
    topicConfig: TopicConfig,
    citations: Citation[]
  ): Promise<Section[]> {
    const model = this.getModel(topicConfig.models.draft);
    const sections: Section[] = [];

    // Generate content for each section
    for (const outlineSection of outline.sections) {
      const section = await this.generateSection(
        outlineSection,
        topicConfig,
        citations,
        model,
        sections
      );
      sections.push(section);

      // Generate subsections if they exist
      if (outlineSection.subsections) {
        for (const subsection of outlineSection.subsections) {
          const subSectionContent = await this.generateSection(
            subsection,
            topicConfig,
            citations,
            model,
            sections
          );
          sections.push(subSectionContent);
        }
      }
    }

    return sections;
  }

  /**
   * Generate content for a single section
   */
  private async generateSection(
    outlineSection: OutlineSection,
    topicConfig: TopicConfig,
    citations: Citation[],
    model: any,
    previousSections: Section[]
  ): Promise<Section> {
    const systemPrompt = this.buildSectionSystemPrompt(topicConfig);
    const userPrompt = this.buildSectionUserPrompt(
      outlineSection,
      topicConfig,
      citations,
      previousSections
    );

    const messages = [
      new SystemMessage(systemPrompt),
      new HumanMessage(userPrompt),
    ];

    try {
      const response = await model.invoke(messages);
      const content = this.extractContent(response.content);
      
      // Apply terminology replacements if configured
      const processedContent = this.applyTerminology(content, topicConfig.terminology);
      
      // Extract citation references
      const citationIds = this.extractCitationReferences(processedContent, citations);

      return {
        id: outlineSection.id,
        level: outlineSection.level,
        title: outlineSection.title,
        content: processedContent,
        word_count: this.countWords(processedContent),
        citations: citationIds.length > 0 ? citationIds : undefined,
      };
    } catch (error) {
      console.error(`Failed to generate section "${outlineSection.title}":`, error);
      
      // Fallback content
      return {
        id: outlineSection.id,
        level: outlineSection.level,
        title: outlineSection.title,
        content: `[Content generation failed for this section. ${outlineSection.description}]`,
        word_count: 10,
      };
    }
  }

  /**
   * Build system prompt for section generation
   */
  private buildSectionSystemPrompt(config: TopicConfig): string {
    return `You are an expert content writer creating high-quality articles.

Writing Requirements:
- Audience: ${config.audience}
- Tone: ${config.tone}
- Reading Level: ${config.reading_level}
- Style: Clear, engaging, and informative

Guidelines:
1. Write natural, flowing prose without markdown formatting
2. Use appropriate paragraph breaks for readability
3. Include relevant examples and explanations
4. Maintain consistency with the specified tone and style
5. When citing sources, use inline references like [1] or [Source: Title]
6. Focus on providing value to the reader
7. Avoid repetition and filler content

DO NOT include section headings in your response - only the content.`;
  }

  /**
   * Build user prompt for section generation
   */
  private buildSectionUserPrompt(
    section: OutlineSection,
    config: TopicConfig,
    citations: Citation[],
    previousSections: Section[]
  ): string {
    let prompt = `Write the content for the following section:\n\n`;
    prompt += `Section: ${section.title}\n`;
    prompt += `Level: H${section.level}\n`;
    prompt += `Description: ${section.description}\n`;
    prompt += `Target Word Count: ${section.estimated_words}\n\n`;

    // Add context from previous sections
    if (previousSections.length > 0) {
      prompt += `Previous sections covered:\n`;
      previousSections.slice(-3).forEach(prev => {
        prompt += `- ${prev.title}: ${prev.content.substring(0, 100)}...\n`;
      });
      prompt += '\n';
    }

    // Add relevant citations
    const relevantCitations = this.selectRelevantCitations(section, citations);
    if (relevantCitations.length > 0) {
      prompt += `Available sources to reference:\n`;
      relevantCitations.forEach((citation, index) => {
        prompt += `[${index + 1}] ${citation.title}\n`;
        prompt += `   ${citation.excerpt}\n`;
        prompt += `   Source: ${citation.domain}\n\n`;
      });
    }

    // Add SEO keywords to incorporate
    if (config.seo.keywords.length > 0) {
      prompt += `Keywords to naturally incorporate: ${config.seo.keywords.join(', ')}\n\n`;
    }

    // Add custom instructions
    if (config.custom_instructions) {
      prompt += `Additional instructions: ${config.custom_instructions}\n\n`;
    }

    prompt += `Write the content now. Remember: no section headings, just the content.`;

    return prompt;
  }

  /**
   * Select citations relevant to the current section
   */
  private selectRelevantCitations(
    section: OutlineSection,
    citations: Citation[]
  ): Citation[] {
    if (citations.length === 0) return [];

    // Simple relevance: check if section title/description matches citation content
    const sectionText = `${section.title} ${section.description}`.toLowerCase();
    
    return citations
      .filter(citation => {
        const citationText = `${citation.title} ${citation.excerpt}`.toLowerCase();
        // Check for keyword overlap
        const sectionWords = sectionText.split(/\s+/);
        const citationWords = citationText.split(/\s+/);
        const commonWords = sectionWords.filter(word => 
          word.length > 4 && citationWords.includes(word)
        );
        return commonWords.length > 0;
      })
      .slice(0, 3); // Limit to top 3 relevant citations
  }

  /**
   * Extract clean content from LLM response
   */
  private extractContent(response: string): string {
    // Remove any markdown headers if present
    let content = response.replace(/^#+\s+.+$/gm, '');
    
    // Remove excessive whitespace
    content = content.replace(/\n{3,}/g, '\n\n');
    
    // Trim
    return content.trim();
  }

  /**
   * Apply terminology replacements
   */
  private applyTerminology(
    content: string,
    terminology?: Record<string, string>
  ): string {
    if (!terminology) return content;

    let processed = content;
    for (const [term, replacement] of Object.entries(terminology)) {
      const regex = new RegExp(`\\b${term}\\b`, 'gi');
      processed = processed.replace(regex, replacement);
    }

    return processed;
  }

  /**
   * Extract citation references from content
   */
  private extractCitationReferences(content: string, citations: Citation[]): string[] {
    const references: Set<string> = new Set();
    
    // Look for [1], [2], etc. patterns
    const matches = content.matchAll(/\[(\d+)\]/g);
    for (const match of matches) {
      const index = parseInt(match[1]) - 1;
      if (index >= 0 && index < citations.length) {
        references.add(citations[index].id);
      }
    }

    // Look for [Source: ...] patterns
    const sourceMatches = content.matchAll(/\[Source:\s*([^\]]+)\]/gi);
    for (const match of sourceMatches) {
      const title = match[1].trim();
      const citation = citations.find(c => 
        c.title.toLowerCase().includes(title.toLowerCase())
      );
      if (citation) {
        references.add(citation.id);
      }
    }

    return Array.from(references);
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
      // For now, fallback to regular OpenAI
      return this.models.get('gpt-4') || this.models.get('gpt-4o');
    }

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

  /**
   * Stream generate content (for real-time updates)
   */
  async *streamGenerateSection(
    outlineSection: OutlineSection,
    topicConfig: TopicConfig,
    citations: Citation[]
  ): AsyncGenerator<string> {
    const model = this.getModel(topicConfig.models.draft);
    
    const systemPrompt = this.buildSectionSystemPrompt(topicConfig);
    const userPrompt = this.buildSectionUserPrompt(
      outlineSection,
      topicConfig,
      citations,
      []
    );

    const messages = [
      new SystemMessage(systemPrompt),
      new HumanMessage(userPrompt),
    ];

    try {
      const stream = await model.stream(messages);
      
      for await (const chunk of stream) {
        if (chunk.content) {
          yield chunk.content;
        }
      }
    } catch (error) {
      console.error('Streaming failed:', error);
      yield `[Error generating content for section: ${outlineSection.title}]`;
    }
  }
}