/**
 * Icon — SVG icons via lucide-react-native.
 * metro.config.js overrides resolution to use CJS dist
 * instead of the ESM react-native field (which breaks Metro web).
 */
import React from 'react';
import {
  Mountain, PersonStanding, Map, Users, Settings2,
  ChevronRight, ChevronLeft, ChevronDown, ChevronUp, Play, Square, Flag,
  TriangleAlert, Star, Navigation, Lock, Unlock,
  Target, Timer, Heart, Zap, MapPin, Route,
  // Sprint 8
  Droplets, X, Trash2, Navigation2, GitBranch,
  Check, CircleCheck,
  // v284
  Scissors,
  // Sprint 9
  LogIn, Eye, EyeOff, Mail, KeyRound, UserPlus,
  // Sprint 11
  Info, Send,
  // Sprint 12
  BookOpen, Moon, Volume2, LogOut, User, ArrowUp, Save,
  // Sprint 13
  Globe, ThumbsUp,
  // Sprint 19
  Compass,
  // Sprint 21
  Apple,
  // Sprint 26
  RotateCcw, Download,
  // Sprint 27
  PlayCircle,
  // Sprint 42+ (Phase 1-2)
  Pause, Pencil, Undo2, TrendingUp, Phone, Signal, MessageCircle,
  // Sprint 54
  Search, Plus, Edit3,
  // v297 — pin-adjust zoom buttons
  Minus,
  // Sprint 56 — activity icons
  Footprints, SportShoe,
  // Sprint 57 — routes screen
  Milestone, Calendar,
  // v80 — voice memo
  Mic,
  // v119 — hut marker (PlantSheet uses 'House' as the label)
  House,
  // sort icon used in filter bars
  ArrowUpDown,
} from 'lucide-react-native';
import { IconSize } from './tokens';

const ICON_MAP = {
  Mountain, PersonStanding, Map, Users, Settings2,
  ChevronRight, ChevronLeft, ChevronDown, ChevronUp, Play, Square, Flag,
  TriangleAlert, Star, Navigation, Lock, Unlock,
  Target, Timer, Heart, Zap, MapPin, Route,
  Droplets, X, Trash2, Navigation2, GitBranch,
  Check, CircleCheck,
  Scissors,
  LogIn, Eye, EyeOff, Mail, KeyRound, UserPlus,
  Info, Send,
  BookOpen, Moon, Volume2, LogOut, User, ArrowUp, Save,
  Globe, ThumbsUp,
  Compass,
  Apple,
  RotateCcw, Download,
  PlayCircle,
  Pause, Pencil, Undo2, TrendingUp, Phone, Signal, MessageCircle,
  Search, Plus, Edit3,
  Minus,
  Footprints, SportShoe,
  Milestone, Calendar,
  Mic,
  House,
  ArrowUpDown,
} as const;

export type IconName = keyof typeof ICON_MAP;

interface IconProps {
  name: IconName;
  size?: number;
  color?: string;
  strokeWidth?: number;
}

export function Icon({ name, size = IconSize.md, color = '#000000', strokeWidth = 2 }: IconProps) {
  const LucideIcon = ICON_MAP[name] as React.ComponentType<{ size?: number; color?: string; strokeWidth?: number }>;
  if (!LucideIcon) return null;
  return <LucideIcon size={size} color={color} strokeWidth={strokeWidth} />;
}
