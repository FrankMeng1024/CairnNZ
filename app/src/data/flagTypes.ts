/**
 * FLAG_TYPES — canonical flag/marker type definitions shared across screens.
 *
 * HikingScreen and MapScreen use this array directly.
 * RoutesScreen keeps its own variant (different cairn colour for trail theming).
 */
import { Colors } from '../components/tokens';
import type { IconName } from '../components/Icon';
import type { MarkerType } from './mockData';
import { cairnText } from '../i18n/runtime';

export type FlagTypeEntry = {
  id: MarkerType;
  icon: IconName;
  label: string;
  color: string;
  bg: string;
};

export const FLAG_TYPES: FlagTypeEntry[] = [
  { id: 'danger',   icon: 'TriangleAlert', get label() { return cairnText('data.flag-types.danger'); },   color: Colors.danger,    bg: Colors.dangerBg          },
  { id: 'cairn',    icon: 'Mountain',      get label() { return cairnText('data.flag-types.cairn'); },    color: Colors.info,      bg: Colors.infoBg            },
  { id: 'water',    icon: 'Droplets',      get label() { return cairnText('data.flag-types.water'); },    color: Colors.success,   bg: Colors.successBg         },
  { id: 'junction', icon: 'Navigation2',   get label() { return cairnText('data.flag-types.junction'); }, color: Colors.docOrange, bg: Colors.severityWarningBg },
];
