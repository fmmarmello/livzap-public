import { AntiBanSettings } from '../types/settings';
import { settingsService } from './settings.service';

const PROFILES: Record<'conservative' | 'moderate', AntiBanSettings> = {
  conservative: {
    profile: 'conservative',
    minDelayMs: 1200,
    maxDelayMs: 4000,
    typingByDefault: true,
    maxGlobalPerMinute: 40,
    maxPerChatPerMinute: 12,
    failureThreshold: 3,
    cooldownMs: 60000,
    maxQueueSize: 500,
  },
  moderate: {
    profile: 'moderate',
    minDelayMs: 400,
    maxDelayMs: 2000,
    typingByDefault: true,
    maxGlobalPerMinute: 80,
    maxPerChatPerMinute: 24,
    failureThreshold: 4,
    cooldownMs: 30000,
    maxQueueSize: 1000,
  },
};

export function getActiveAntiBanSettings(): AntiBanSettings {
  const runtime = settingsService.get().antiBan;
  if (runtime.profile === 'custom') {
    return runtime;
  }
  const profile = runtime.profile in PROFILES ? (runtime.profile as 'conservative' | 'moderate') : 'conservative';
  return { ...PROFILES[profile], profile };
}

