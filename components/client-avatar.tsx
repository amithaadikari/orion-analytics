import React from 'react';
import {
  Activity,
  Bitcoin,
  Bot,
  ChartCandlestick,
  Coins,
  Cpu,
  Orbit,
  Radar,
  TrendingUp,
  type LucideIcon,
} from 'lucide-react';
import { normalizeClientAvatar, type ClientAvatarKey } from '@/lib/client-profile';

const icons: Record<ClientAvatarKey, LucideIcon> = {
  'forex-gold': ChartCandlestick,
  'forex-pulse': TrendingUp,
  'forex-wave': Activity,
  'crypto-bitcoin': Bitcoin,
  'crypto-coins': Coins,
  'crypto-orbit': Orbit,
  'robot-core': Bot,
  'robot-radar': Radar,
  'robot-cpu': Cpu,
};

type ClientAvatarProps = {
  avatarKey?: string | null;
  size?: 'small' | 'medium' | 'large';
  className?: string;
};

export default function ClientAvatar({ avatarKey, size = 'medium', className = '' }: ClientAvatarProps) {
  const key = normalizeClientAvatar(avatarKey);
  const Icon = icons[key];
  const category = key.split('-')[0];
  return (
    <span className={`client-trading-avatar client-trading-avatar--${size} ${className}`.trim()} data-avatar={key} data-category={category} aria-hidden="true">
      <i className="client-trading-avatar-orbit" />
      <Icon className="client-trading-avatar-icon" />
      <b className="client-trading-avatar-scan" />
      <em className="client-trading-avatar-status" />
    </span>
  );
}
