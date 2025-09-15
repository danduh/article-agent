import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { promises as fs } from 'fs';
import { join } from 'path';
import axios, { AxiosResponse } from 'axios';
import { 
  TopicConfig, 
  TopicConfigResponse, 
  TopicList,
  validateTopicConfig,
  TopicConfigResponseSchema,
  TopicListSchema 
} from '../schemas/topic-config.schema';

export interface TopicLoaderOptions {
  source?: 'local' | 'api';
  apiUrl?: string;
  apiKey?: string;
  localPath?: string;
}

@Injectable()
export class TopicLoaderService {
  private readonly logger = new Logger(TopicLoaderService.name);
  private readonly source: 'local' | 'api';
  private readonly apiUrl?: string;
  private readonly apiKey?: string;
  private readonly localPath: string;

  constructor(private readonly configService: ConfigService) {
    this.source = this.configService.get<'local' | 'api'>('TOPIC_CONFIG_SOURCE', 'local');
    this.apiUrl = this.configService.get<string>('TOPIC_CONFIG_API_URL');
    this.apiKey = this.configService.get<string>('TOPIC_CONFIG_API_KEY');
    this.localPath = this.configService.get<string>('TOPIC_CONFIG_LOCAL_PATH', './examples/topics');
    
    this.logger.log(`Initialized with source: ${this.source}`);
  }

  /**
   * Load a topic configuration by ID and version
   */
  async loadTopic(topicId: string, version: string): Promise<TopicConfig> {
    this.logger.log(`Loading topic: ${topicId}@${version}`);

    if (version === 'latest') {
      throw new BadRequestException('Version "latest" is not allowed. Please specify an exact version.');
    }

    try {
      let topicData: unknown;

      if (this.source === 'local') {
        topicData = await this.loadTopicFromFile(topicId, version);
      } else {
        topicData = await this.loadTopicFromAPI(topicId, version);
      }

      const validatedTopic = validateTopicConfig(topicData);
      
      // Verify the loaded topic matches the requested version
      if (validatedTopic.version !== version) {
        throw new BadRequestException(
          `Version mismatch: requested ${version}, got ${validatedTopic.version}`
        );
      }

      this.logger.log(`Successfully loaded topic: ${topicId}@${version}`);
      return validatedTopic;
    } catch (error) {
      this.logger.error(`Failed to load topic ${topicId}@${version}:`, error);
      
      if (error instanceof BadRequestException || error instanceof NotFoundException) {
        throw error;
      }
      
      throw new BadRequestException(`Invalid topic configuration: ${error.message}`);
    }
  }

  /**
   * List available topics
   */
  async listTopics(page?: number, limit?: number): Promise<TopicList> {
    this.logger.log('Listing available topics');

    try {
      let topicList: TopicList;

      if (this.source === 'local') {
        topicList = await this.listTopicsFromFiles(page, limit);
      } else {
        topicList = await this.listTopicsFromAPI(page, limit);
      }

      this.logger.log(`Found ${topicList.total} topics`);
      return topicList;
    } catch (error) {
      this.logger.error('Failed to list topics:', error);
      throw new BadRequestException(`Failed to list topics: ${error.message}`);
    }
  }

  /**
   * Get all available versions for a topic
   */
  async getTopicVersions(topicId: string): Promise<string[]> {
    this.logger.log(`Getting versions for topic: ${topicId}`);

    try {
      let versions: string[];

      if (this.source === 'local') {
        versions = await this.getTopicVersionsFromFiles(topicId);
      } else {
        versions = await this.getTopicVersionsFromAPI(topicId);
      }

      this.logger.log(`Found ${versions.length} versions for topic ${topicId}`);
      return versions.sort((a, b) => this.compareVersions(b, a)); // Sort descending
    } catch (error) {
      this.logger.error(`Failed to get versions for topic ${topicId}:`, error);
      throw error;
    }
  }

  /**
   * Load topic from local JSON file
   */
  private async loadTopicFromFile(topicId: string, version: string): Promise<unknown> {
    const filePath = join(this.localPath, `${topicId}.json`);
    
    try {
      const fileContent = await fs.readFile(filePath, 'utf-8');
      const topicData = JSON.parse(fileContent);
      
      // For local files, we assume the file contains the correct version
      // In a more sophisticated setup, you might have versioned files or directories
      return topicData;
    } catch (error) {
      if (error.code === 'ENOENT') {
        throw new NotFoundException(`Topic file not found: ${topicId}`);
      }
      throw new BadRequestException(`Failed to read topic file: ${error.message}`);
    }
  }

  /**
   * Load topic from remote API
   */
  private async loadTopicFromAPI(topicId: string, version: string): Promise<unknown> {
    if (!this.apiUrl) {
      throw new BadRequestException('API URL not configured');
    }

    const url = `${this.apiUrl}/topics/${topicId}/versions/${version}`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }

    try {
      const response: AxiosResponse<TopicConfigResponse> = await axios.get(url, {
        headers,
        timeout: 10000, // 10 second timeout
      });

      const validatedResponse = TopicConfigResponseSchema.parse(response.data);

      if (!validatedResponse.success || !validatedResponse.data) {
        throw new BadRequestException(
          validatedResponse.error || 'Failed to load topic from API'
        );
      }

      return validatedResponse.data;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        if (error.response?.status === 404) {
          throw new NotFoundException(`Topic not found: ${topicId}@${version}`);
        }
        throw new BadRequestException(`API request failed: ${error.message}`);
      }
      throw error;
    }
  }

  /**
   * List topics from local files
   */
  private async listTopicsFromFiles(page?: number, limit?: number): Promise<TopicList> {
    try {
      const files = await fs.readdir(this.localPath);
      const jsonFiles = files.filter(file => file.endsWith('.json'));
      
      const topics = [];
      for (const file of jsonFiles) {
        try {
          const filePath = join(this.localPath, file);
          const content = await fs.readFile(filePath, 'utf-8');
          const topicData = JSON.parse(content);
          const validatedTopic = validateTopicConfig(topicData);
          
          topics.push({
            id: validatedTopic.id,
            version: validatedTopic.version,
            title: validatedTopic.title,
            status: validatedTopic.status,
            created_at: validatedTopic.created_at,
            updated_at: validatedTopic.updated_at,
            tags: validatedTopic.tags,
            priority: validatedTopic.priority,
          });
        } catch (error) {
          this.logger.warn(`Skipping invalid topic file ${file}:`, error.message);
        }
      }

      // Apply pagination if specified
      const startIndex = page && limit ? (page - 1) * limit : 0;
      const endIndex = page && limit ? startIndex + limit : topics.length;
      const paginatedTopics = topics.slice(startIndex, endIndex);

      return {
        topics: paginatedTopics,
        total: topics.length,
        page,
        limit,
      };
    } catch (error) {
      throw new BadRequestException(`Failed to read topics directory: ${error.message}`);
    }
  }

  /**
   * List topics from API
   */
  private async listTopicsFromAPI(page?: number, limit?: number): Promise<TopicList> {
    if (!this.apiUrl) {
      throw new BadRequestException('API URL not configured');
    }

    const url = `${this.apiUrl}/topics`;
    const params: Record<string, any> = {};
    
    if (page) params.page = page;
    if (limit) params.limit = limit;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }

    try {
      const response = await axios.get(url, {
        headers,
        params,
        timeout: 10000,
      });

      return TopicListSchema.parse(response.data);
    } catch (error) {
      if (axios.isAxiosError(error)) {
        throw new BadRequestException(`API request failed: ${error.message}`);
      }
      throw error;
    }
  }

  /**
   * Get topic versions from local files (simplified - assumes one version per file)
   */
  private async getTopicVersionsFromFiles(topicId: string): Promise<string[]> {
    const filePath = join(this.localPath, `${topicId}.json`);
    
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const topicData = JSON.parse(content);
      const validatedTopic = validateTopicConfig(topicData);
      
      return [validatedTopic.version];
    } catch (error) {
      if (error.code === 'ENOENT') {
        throw new NotFoundException(`Topic not found: ${topicId}`);
      }
      throw new BadRequestException(`Failed to read topic file: ${error.message}`);
    }
  }

  /**
   * Get topic versions from API
   */
  private async getTopicVersionsFromAPI(topicId: string): Promise<string[]> {
    if (!this.apiUrl) {
      throw new BadRequestException('API URL not configured');
    }

    const url = `${this.apiUrl}/topics/${topicId}/versions`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }

    try {
      const response = await axios.get(url, {
        headers,
        timeout: 10000,
      });

      const versions = response.data.versions;
      if (!Array.isArray(versions)) {
        throw new BadRequestException('Invalid API response: versions must be an array');
      }

      return versions;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        if (error.response?.status === 404) {
          throw new NotFoundException(`Topic not found: ${topicId}`);
        }
        throw new BadRequestException(`API request failed: ${error.message}`);
      }
      throw error;
    }
  }

  /**
   * Compare semantic versions (simple implementation)
   */
  private compareVersions(a: string, b: string): number {
    const aParts = a.split('.').map(Number);
    const bParts = b.split('.').map(Number);
    
    for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
      const aPart = aParts[i] || 0;
      const bPart = bParts[i] || 0;
      
      if (aPart > bPart) return 1;
      if (aPart < bPart) return -1;
    }
    
    return 0;
  }

  /**
   * Validate topic configuration without loading
   */
  async validateTopicFile(filePath: string): Promise<{ valid: boolean; errors?: string[] }> {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const topicData = JSON.parse(content);
      validateTopicConfig(topicData);
      
      return { valid: true };
    } catch (error) {
      return { 
        valid: false, 
        errors: error.errors?.map((e: any) => e.message) || [error.message] 
      };
    }
  }
}