/**
 * Icon — SVG icons via lucide-react-native.
 * metro.config.js overrides resolution to use CJS dist
 * instead of the ESM react-native field (which breaks Metro web).
 * O1: cleaned unused imports. Metro doesn't tree-shake lucide-react-native
 * CJS, so keeping unused imports means bundling ~50KB dead SVG per icon.
 * Kept: only icons actually referenced by <Icon name="..." /> in src/.
 */
import React from 'react';
import {
  Mountain, Map, Users, Settings2,
  ChevronRight, ChevronLeft, ChevronDown, ChevronUp, Play, Square, Flag,
  TriangleAlert, Star, Navigation, Lock,
  Target, Timer, Heart, Zap, MapPin, Route,
  // Sprint 8
  Droplets, X, Trash2, Navigation2,
  Check, CircleCheck,
  // v284
  Scissors,
  // Sprint 9
  LogIn, Eye, EyeOff, Mail, KeyRound, UserPlus,
  // Sprint 11
  Info, Send,
  // Sprint 12
  Moon, Volume2, LogOut, User, ArrowUp, Save,
  // Sprint 13
  Globe,
  // Sprint 19
  Compass,
  // Sprint 21
  Apple,
  // Sprint 26
  RotateCcw, Download,
  // Sprint 27
  PlayCircle,
  // Sprint 42+ (Phase 1-2)
  Pause, Pencil, TrendingUp, Phone,
  // Sprint 54
  Plus, Edit3,
  // v297 — pin-adjust zoom buttons
  Minus,
  // Sprint 57 — routes screen
  Milestone, Calendar,
  // v80 — voice memo
  Mic,
  // sort icon used in filter bars
  ArrowUpDown,
  // v424 — hierarchy popover on Memory tab (world/continent/country/city/district)
  Layers,
  // O1 — pending sync banner
  CloudOff,
  // O1 — restored: friend chat / activity / running-mode / hut marker
  MessageCircle, Footprints, PersonStanding, House,
  // O12 Settings redesign — new rows in About & Legal / Preferences / Danger / Developer
  Vibrate, Ruler, Cloud, MessageSquare, Shield, FileText, Wrench, ExternalLink,
  // O18 HIST-01 — history list search box
  Search,
} from 'lucide-react-native';
import { IconSize } from './tokens';

const ICON_MAP = {
  Mountain, Map, Users, Settings2,
  ChevronRight, ChevronLeft, ChevronDown, ChevronUp, Play, Square, Flag,
  TriangleAlert, Star, Navigation, Lock,
  Target, Timer, Heart, Zap, MapPin, Route,
  Droplets, X, Trash2, Navigation2,
  Check, CircleCheck,
  Scissors,
  LogIn, Eye, EyeOff, Mail, KeyRound, UserPlus,
  Info, Send,
  Moon, Volume2, LogOut, User, ArrowUp, Save,
  Globe,
  Compass,
  Apple,
  RotateCcw, Download,
  PlayCircle,
  Pause, Pencil, TrendingUp, Phone,
  Plus, Edit3,
  Minus,
  Milestone, Calendar,
  Mic,
  ArrowUpDown,
  Layers,
  CloudOff,
  MessageCircle, Footprints, PersonStanding, House,
  // O12 Settings redesign
  Vibrate, Ruler, Cloud, MessageSquare, Shield, FileText, Wrench, ExternalLink,
  // O18 HIST-01
  Search,
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
