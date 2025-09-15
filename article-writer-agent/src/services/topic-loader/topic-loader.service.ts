import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { promises as fs } from 'fs';
import * as path from 'path';
import axios from 'axios';
import { TopicConfig, TopicConfigSchema } from '../../schemas/topic-config.schema';
import { z } from 'zod';

@Injectable()
export class TopicLoaderService {
  private topicsCache: Map<string, TopicConfig> = new Map();

  /**
   * Load topic configuration from a JSON file
   */
  async loadFromFile(filePath: string): Promise<TopicConfig> {
    try {
      const absolutePath = path.isAbsolute(filePath) 
        ? filePath 
        : path.join(process.cwd(), 'topics', filePath);
      
      const fileContent = await fs.readFile(absolutePath, 'utf-8');
      const rawConfig = JSON.parse(fileContent);
      
      return this.validateAndCache(rawConfig);
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw new BadRequestException(`Invalid topic configuration: ${error.message}`);
      }
      if (error.code === 'ENOENT') {
        throw new NotFoundException(`Topic file not found: ${filePath}`);
      }
      throw error;
    }
  }

  /**
   * Load topic configuration from a remote API
   */
  async loadFromAPI(topicId: string, version: string, apiUrl?: string): Promise<TopicConfig> {
    const cacheKey = `${topicId}@${version}`;
    
    // Check cache first
    if (this.topicsCache.has(cacheKey)) {
      return this.topicsCache.get(cacheKey);
    }

    try {
      const baseUrl = apiUrl || process.env.TOPIC_API_URL || 'http://localhost:3001/api/topics';
      const url = `${baseUrl}/${topicId}/versions/${version}`;
      
      const response = await axios.get(url, {
        headers: {
          'Accept': 'application/json',
          'X-API-Key': process.env.TOPIC_API_KEY || '',
        },
        timeout: 10000,
      });

      return this.validateAndCache(response.data);
    } catch (error) {
      if (axios.isAxiosError(error)) {
        if (error.response?.status === 404) {
          throw new NotFoundException(`Topic not found: ${topicId}@${version}`);
        }
        throw new BadRequestException(`Failed to fetch topic from API: ${error.message}`);
      }
      throw error;
    }
  }

  /**
   * Load all topics from a directory
   */
  async loadFromDirectory(dirPath: string): Promise<TopicConfig[]> {
    try {
      const absolutePath = path.isAbsolute(dirPath) 
        ? dirPath 
        : path.join(process.cwd(), dirPath);
      
      const files = await fs.readdir(absolutePath);
      const jsonFiles = files.filter(f => f.endsWith('.json'));
      
      const topics = await Promise.all(
        jsonFiles.map(file => 
          this.loadFromFile(path.join(absolutePath, file))
            .catch(err => {
              console.error(`Failed to load topic from ${file}:`, err.message);
              return null;
            })
        )
      );

      return topics.filter(t => t !== null);
    } catch (error) {
      if (error.code === 'ENOENT') {
        throw new NotFoundException(`Directory not found: ${dirPath}`);
      }
      throw error;
    }
  }

  /**
   * Validate topic configuration with version pinning
   */
  private validateAndCache(rawConfig: any): TopicConfig {
    // Validate against schema
    const config = TopicConfigSchema.parse(rawConfig);
    
    // Enforce version pinning - no "latest" or wildcards
    if (config.version === 'latest' || config.version.includes('*')) {
      throw new BadRequestException(
        `Version pinning required. Got "${config.version}", but must be a specific version like "1.0.0"`
      );
    }

    // Validate status
    if (config.status === 'deprecated') {
      console.warn(`Warning: Topic ${config.id}@${config.version} is deprecated`);
    }

    // Cache the validated config
    const cacheKey = `${config.id}@${config.version}`;
    this.topicsCache.set(cacheKey, config);

    return config;
  }

  /**
   * Get a topic from cache
   */
  getFromCache(topicId: string, version: string): TopicConfig | undefined {
    return this.topicsCache.get(`${topicId}@${version}`);
  }

  /**
   * Clear the cache
   */
  clearCache(): void {
    this.topicsCache.clear();
  }

  /**
   * List all cached topics
   */
  listCached(): TopicConfig[] {
    return Array.from(this.topicsCache.values());
  }
}