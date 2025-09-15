import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { promises as fs } from 'fs';
import { join } from 'path';
import { TopicConfig } from '../schemas/topic-config.schema';
import { Article, ArticleRun } from '../schemas/article.schema';

interface GovernanceRecord {
  id: string;
  type: 'topic_load' | 'article_generation' | 'version_pin' | 'rollback';
  topicId: string;
  version: string;
  timestamp: string;
  userId?: string;
  metadata: Record<string, any>;
  hash: string; // For integrity verification
}

interface VersionPin {
  topicId: string;
  pinnedVersion: string;
  pinnedAt: string;
  pinnedBy?: string;
  reason?: string;
  active: boolean;
}

interface RollbackRecord {
  id: string;
  topicId: string;
  fromVersion: string;
  toVersion: string;
  rolledBackAt: string;
  rolledBackBy?: string;
  reason: string;
  affectedArticles: string[];
}

@Injectable()
export class GovernanceService {
  private readonly logger = new Logger(GovernanceService.name);
  private readonly governancePath: string;

  constructor(private readonly configService: ConfigService) {
    this.governancePath = join(
      this.configService.get<string>('STORAGE_PATH', './storage'),
      'governance'
    );
    this.initializeGovernance();
  }

  /**
   * Initialize governance storage
   */
  private async initializeGovernance(): Promise<void> {
    try {
      await fs.mkdir(this.governancePath, { recursive: true });
      await fs.mkdir(join(this.governancePath, 'records'), { recursive: true });
      await fs.mkdir(join(this.governancePath, 'pins'), { recursive: true });
      await fs.mkdir(join(this.governancePath, 'rollbacks'), { recursive: true });
      
      this.logger.log(`Governance initialized at: ${this.governancePath}`);
    } catch (error) {
      this.logger.error('Failed to initialize governance:', error);
      throw error;
    }
  }

  /**
   * Record a governance event
   */
  async recordEvent(
    type: GovernanceRecord['type'],
    topicId: string,
    version: string,
    metadata: Record<string, any> = {},
    userId?: string
  ): Promise<string> {
    const record: GovernanceRecord = {
      id: this.generateId(),
      type,
      topicId,
      version,
      timestamp: new Date().toISOString(),
      userId,
      metadata,
      hash: this.generateHash({ type, topicId, version, timestamp: new Date().toISOString(), metadata }),
    };

    try {
      const recordPath = join(this.governancePath, 'records', `${record.id}.json`);
      await fs.writeFile(recordPath, JSON.stringify(record, null, 2));
      
      this.logger.debug(`Recorded governance event: ${type} for ${topicId}@${version}`);
      return record.id;
    } catch (error) {
      this.logger.error(`Failed to record governance event:`, error);
      throw error;
    }
  }

  /**
   * Pin a specific version of a topic
   */
  async pinVersion(
    topicId: string,
    version: string,
    reason?: string,
    userId?: string
  ): Promise<void> {
    this.logger.log(`Pinning version ${version} for topic ${topicId}`);

    // Validate version format
    if (!this.isValidVersion(version)) {
      throw new BadRequestException('Invalid version format. Use semantic versioning (e.g., 1.0.0)');
    }

    if (version === 'latest') {
      throw new BadRequestException('Cannot pin version "latest". Specify an exact version.');
    }

    // Deactivate any existing pins for this topic
    await this.deactivateExistingPins(topicId);

    const pin: VersionPin = {
      topicId,
      pinnedVersion: version,
      pinnedAt: new Date().toISOString(),
      pinnedBy: userId,
      reason,
      active: true,
    };

    try {
      const pinPath = join(this.governancePath, 'pins', `${topicId}-${version}.json`);
      await fs.writeFile(pinPath, JSON.stringify(pin, null, 2));

      // Record governance event
      await this.recordEvent('version_pin', topicId, version, { reason }, userId);

      this.logger.log(`Version ${version} pinned for topic ${topicId}`);
    } catch (error) {
      this.logger.error(`Failed to pin version ${version} for topic ${topicId}:`, error);
      throw error;
    }
  }

  /**
   * Get pinned version for a topic
   */
  async getPinnedVersion(topicId: string): Promise<string | null> {
    try {
      const pinsDir = join(this.governancePath, 'pins');
      const files = await fs.readdir(pinsDir);
      const topicPins = files.filter(file => file.startsWith(`${topicId}-`));

      for (const file of topicPins) {
        const pinPath = join(pinsDir, file);
        const content = await fs.readFile(pinPath, 'utf-8');
        const pin: VersionPin = JSON.parse(content);

        if (pin.active && pin.topicId === topicId) {
          return pin.pinnedVersion;
        }
      }

      return null;
    } catch (error) {
      this.logger.error(`Failed to get pinned version for topic ${topicId}:`, error);
      return null;
    }
  }

  /**
   * Unpin a topic version
   */
  async unpinVersion(topicId: string, userId?: string): Promise<void> {
    this.logger.log(`Unpinning version for topic ${topicId}`);

    await this.deactivateExistingPins(topicId);

    // Record governance event
    await this.recordEvent('version_pin', topicId, 'unpinned', { action: 'unpin' }, userId);

    this.logger.log(`Version unpinned for topic ${topicId}`);
  }

  /**
   * Rollback to a previous version
   */
  async rollbackVersion(
    topicId: string,
    toVersion: string,
    reason: string,
    userId?: string
  ): Promise<RollbackRecord> {
    this.logger.log(`Rolling back topic ${topicId} to version ${toVersion}`);

    // Get current pinned version
    const currentVersion = await this.getPinnedVersion(topicId);
    if (!currentVersion) {
      throw new BadRequestException('No version currently pinned for this topic');
    }

    if (currentVersion === toVersion) {
      throw new BadRequestException('Cannot rollback to the same version');
    }

    // Validate target version
    if (!this.isValidVersion(toVersion)) {
      throw new BadRequestException('Invalid target version format');
    }

    // Find articles that might be affected
    const affectedArticles = await this.findArticlesByTopicVersion(topicId, currentVersion);

    const rollback: RollbackRecord = {
      id: this.generateId(),
      topicId,
      fromVersion: currentVersion,
      toVersion,
      rolledBackAt: new Date().toISOString(),
      rolledBackBy: userId,
      reason,
      affectedArticles,
    };

    try {
      // Save rollback record
      const rollbackPath = join(this.governancePath, 'rollbacks', `${rollback.id}.json`);
      await fs.writeFile(rollbackPath, JSON.stringify(rollback, null, 2));

      // Pin the rollback version
      await this.pinVersion(topicId, toVersion, `Rollback: ${reason}`, userId);

      // Record governance event
      await this.recordEvent('rollback', topicId, toVersion, {
        fromVersion: currentVersion,
        reason,
        affectedArticles: affectedArticles.length,
      }, userId);

      this.logger.log(`Rollback completed: ${topicId} from ${currentVersion} to ${toVersion}`);
      return rollback;
    } catch (error) {
      this.logger.error(`Failed to rollback version:`, error);
      throw error;
    }
  }

  /**
   * Get governance audit trail for a topic
   */
  async getAuditTrail(
    topicId: string,
    limit = 50,
    offset = 0
  ): Promise<{
    records: GovernanceRecord[];
    total: number;
    pins: VersionPin[];
    rollbacks: RollbackRecord[];
  }> {
    try {
      // Get governance records
      const recordsDir = join(this.governancePath, 'records');
      const recordFiles = await fs.readdir(recordsDir);
      
      const records: GovernanceRecord[] = [];
      for (const file of recordFiles) {
        const recordPath = join(recordsDir, file);
        const content = await fs.readFile(recordPath, 'utf-8');
        const record: GovernanceRecord = JSON.parse(content);
        
        if (record.topicId === topicId) {
          records.push(record);
        }
      }

      // Sort by timestamp (newest first)
      records.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

      // Apply pagination
      const paginatedRecords = records.slice(offset, offset + limit);

      // Get pins
      const pins = await this.getTopicPins(topicId);

      // Get rollbacks
      const rollbacks = await this.getTopicRollbacks(topicId);

      return {
        records: paginatedRecords,
        total: records.length,
        pins,
        rollbacks,
      };
    } catch (error) {
      this.logger.error(`Failed to get audit trail for topic ${topicId}:`, error);
      throw error;
    }
  }

  /**
   * Validate topic version before use
   */
  async validateTopicVersion(topicId: string, requestedVersion: string): Promise<{
    valid: boolean;
    actualVersion: string;
    isPinned: boolean;
    warnings: string[];
  }> {
    const warnings: string[] = [];

    // Check if version is "latest" (not allowed in production)
    if (requestedVersion === 'latest') {
      return {
        valid: false,
        actualVersion: requestedVersion,
        isPinned: false,
        warnings: ['Version "latest" is not allowed. Please specify an exact version.'],
      };
    }

    // Check if version is pinned
    const pinnedVersion = await this.getPinnedVersion(topicId);
    const isPinned = pinnedVersion !== null;

    let actualVersion = requestedVersion;

    // If a version is pinned, use it instead of requested version
    if (isPinned && pinnedVersion !== requestedVersion) {
      actualVersion = pinnedVersion;
      warnings.push(`Version ${requestedVersion} requested, but ${pinnedVersion} is pinned and will be used instead.`);
    }

    // Validate version format
    if (!this.isValidVersion(actualVersion)) {
      return {
        valid: false,
        actualVersion,
        isPinned,
        warnings: [...warnings, 'Invalid version format. Use semantic versioning (e.g., 1.0.0).'],
      };
    }

    // Record the validation event
    await this.recordEvent('topic_load', topicId, actualVersion, {
      requestedVersion,
      pinnedVersion,
      warnings: warnings.length,
    });

    return {
      valid: true,
      actualVersion,
      isPinned,
      warnings,
    };
  }

  /**
   * Get governance statistics
   */
  async getGovernanceStats(): Promise<{
    totalRecords: number;
    totalPins: number;
    activePins: number;
    totalRollbacks: number;
    recordsByType: { [type: string]: number };
    recentActivity: GovernanceRecord[];
  }> {
    try {
      const [records, pins, rollbacks] = await Promise.all([
        this.getAllGovernanceRecords(),
        this.getAllPins(),
        this.getAllRollbacks(),
      ]);

      const recordsByType: { [type: string]: number } = {};
      for (const record of records) {
        recordsByType[record.type] = (recordsByType[record.type] || 0) + 1;
      }

      const activePins = pins.filter(pin => pin.active).length;
      const recentActivity = records
        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
        .slice(0, 10);

      return {
        totalRecords: records.length,
        totalPins: pins.length,
        activePins,
        totalRollbacks: rollbacks.length,
        recordsByType,
        recentActivity,
      };
    } catch (error) {
      this.logger.error('Failed to get governance stats:', error);
      throw error;
    }
  }

  /**
   * Deactivate existing pins for a topic
   */
  private async deactivateExistingPins(topicId: string): Promise<void> {
    try {
      const pinsDir = join(this.governancePath, 'pins');
      const files = await fs.readdir(pinsDir);
      const topicPins = files.filter(file => file.startsWith(`${topicId}-`));

      for (const file of topicPins) {
        const pinPath = join(pinsDir, file);
        const content = await fs.readFile(pinPath, 'utf-8');
        const pin: VersionPin = JSON.parse(content);

        if (pin.active && pin.topicId === topicId) {
          pin.active = false;
          await fs.writeFile(pinPath, JSON.stringify(pin, null, 2));
        }
      }
    } catch (error) {
      // Directory might not exist yet
      if (error.code !== 'ENOENT') {
        throw error;
      }
    }
  }

  /**
   * Get all pins for a topic
   */
  private async getTopicPins(topicId: string): Promise<VersionPin[]> {
    try {
      const pinsDir = join(this.governancePath, 'pins');
      const files = await fs.readdir(pinsDir);
      const topicPins = files.filter(file => file.startsWith(`${topicId}-`));

      const pins: VersionPin[] = [];
      for (const file of topicPins) {
        const pinPath = join(pinsDir, file);
        const content = await fs.readFile(pinPath, 'utf-8');
        const pin: VersionPin = JSON.parse(content);
        pins.push(pin);
      }

      return pins.sort((a, b) => new Date(b.pinnedAt).getTime() - new Date(a.pinnedAt).getTime());
    } catch (error) {
      return [];
    }
  }

  /**
   * Get all rollbacks for a topic
   */
  private async getTopicRollbacks(topicId: string): Promise<RollbackRecord[]> {
    try {
      const rollbacksDir = join(this.governancePath, 'rollbacks');
      const files = await fs.readdir(rollbacksDir);

      const rollbacks: RollbackRecord[] = [];
      for (const file of files) {
        const rollbackPath = join(rollbacksDir, file);
        const content = await fs.readFile(rollbackPath, 'utf-8');
        const rollback: RollbackRecord = JSON.parse(content);
        
        if (rollback.topicId === topicId) {
          rollbacks.push(rollback);
        }
      }

      return rollbacks.sort((a, b) => new Date(b.rolledBackAt).getTime() - new Date(a.rolledBackAt).getTime());
    } catch (error) {
      return [];
    }
  }

  /**
   * Find articles by topic version
   */
  private async findArticlesByTopicVersion(topicId: string, version: string): Promise<string[]> {
    try {
      // This would typically query the storage service
      // For now, return empty array as placeholder
      return [];
    } catch (error) {
      this.logger.error('Failed to find articles by topic version:', error);
      return [];
    }
  }

  /**
   * Get all governance records
   */
  private async getAllGovernanceRecords(): Promise<GovernanceRecord[]> {
    try {
      const recordsDir = join(this.governancePath, 'records');
      const files = await fs.readdir(recordsDir);

      const records: GovernanceRecord[] = [];
      for (const file of files) {
        const recordPath = join(recordsDir, file);
        const content = await fs.readFile(recordPath, 'utf-8');
        const record: GovernanceRecord = JSON.parse(content);
        records.push(record);
      }

      return records;
    } catch (error) {
      return [];
    }
  }

  /**
   * Get all pins
   */
  private async getAllPins(): Promise<VersionPin[]> {
    try {
      const pinsDir = join(this.governancePath, 'pins');
      const files = await fs.readdir(pinsDir);

      const pins: VersionPin[] = [];
      for (const file of files) {
        const pinPath = join(pinsDir, file);
        const content = await fs.readFile(pinPath, 'utf-8');
        const pin: VersionPin = JSON.parse(content);
        pins.push(pin);
      }

      return pins;
    } catch (error) {
      return [];
    }
  }

  /**
   * Get all rollbacks
   */
  private async getAllRollbacks(): Promise<RollbackRecord[]> {
    try {
      const rollbacksDir = join(this.governancePath, 'rollbacks');
      const files = await fs.readdir(rollbacksDir);

      const rollbacks: RollbackRecord[] = [];
      for (const file of files) {
        const rollbackPath = join(rollbacksDir, file);
        const content = await fs.readFile(rollbackPath, 'utf-8');
        const rollback: RollbackRecord = JSON.parse(content);
        rollbacks.push(rollback);
      }

      return rollbacks;
    } catch (error) {
      return [];
    }
  }

  /**
   * Validate version format
   */
  private isValidVersion(version: string): boolean {
    return /^\d+\.\d+\.\d+$/.test(version);
  }

  /**
   * Generate unique ID
   */
  private generateId(): string {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
  }

  /**
   * Generate hash for integrity
   */
  private generateHash(data: any): string {
    // Simple hash implementation - in production, use crypto
    const str = JSON.stringify(data);
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash).toString(36);
  }
}