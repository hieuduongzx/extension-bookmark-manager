import {
  Folder,
  Star,
  Heart,
  Briefcase,
  Book,
  Code,
  Music,
  Film,
  ShoppingCart,
  Globe,
  Bookmark,
  Sparkles,
  Wrench,
  GraduationCap,
  Newspaper,
  Gamepad2,
} from 'lucide-react';
import type { CollectionColor, CollectionIcon } from './types';

export const COLLECTION_ICONS: { id: CollectionIcon; label: string; icon: React.ElementType }[] = [
  { id: 'folder', label: 'Folder', icon: Folder },
  { id: 'bookmark', label: 'Bookmark', icon: Bookmark },
  { id: 'star', label: 'Star', icon: Star },
  { id: 'heart', label: 'Heart', icon: Heart },
  { id: 'briefcase', label: 'Briefcase', icon: Briefcase },
  { id: 'book', label: 'Book', icon: Book },
  { id: 'code', label: 'Code', icon: Code },
  { id: 'sparkles', label: 'Sparkles', icon: Sparkles },
  { id: 'wrench', label: 'Tools', icon: Wrench },
  { id: 'graduation-cap', label: 'Learning', icon: GraduationCap },
  { id: 'newspaper', label: 'Reading', icon: Newspaper },
  { id: 'globe', label: 'Globe', icon: Globe },
  { id: 'music', label: 'Music', icon: Music },
  { id: 'film', label: 'Film', icon: Film },
  { id: 'gamepad', label: 'Games', icon: Gamepad2 },
  { id: 'shopping-cart', label: 'Shopping', icon: ShoppingCart },
];

export function getCollectionIcon(iconName: CollectionIcon): React.ElementType {
  const found = COLLECTION_ICONS.find((i) => i.id === iconName);
  return found ? found.icon : Folder;
}

export const COLLECTION_COLORS: { id: CollectionColor; swatch: string }[] = [
  { id: 'blue', swatch: 'bg-blue-500' },
  { id: 'indigo', swatch: 'bg-indigo-500' },
  { id: 'violet', swatch: 'bg-violet-500' },
  { id: 'rose', swatch: 'bg-rose-500' },
  { id: 'orange', swatch: 'bg-orange-500' },
  { id: 'amber', swatch: 'bg-amber-500' },
  { id: 'emerald', swatch: 'bg-emerald-500' },
  { id: 'teal', swatch: 'bg-teal-500' },
  { id: 'cyan', swatch: 'bg-cyan-500' },
  { id: 'pink', swatch: 'bg-pink-500' },
];

export function getCollectionColorText(colorName: string, isActive = false): string {
  if (isActive) return 'text-brand-700 dark:text-brand-300';
  switch (colorName) {
    case 'blue': return 'text-blue-500';
    case 'indigo': return 'text-indigo-500';
    case 'violet': return 'text-violet-500';
    case 'rose': return 'text-rose-500';
    case 'orange': return 'text-orange-500';
    case 'amber': return 'text-amber-500';
    case 'emerald': return 'text-emerald-500';
    case 'teal': return 'text-teal-500';
    case 'cyan': return 'text-cyan-500';
    case 'pink': return 'text-pink-500';
    default: return 'text-zinc-500 dark:text-zinc-400';
  }
}

export const COLLECTION_BADGE_BG: Record<CollectionColor, string> = {
  blue: 'bg-blue-50 border-blue-200/80 text-blue-600 dark:bg-blue-950/40 dark:border-blue-900 dark:text-blue-400',
  indigo: 'bg-indigo-50 border-indigo-200/80 text-indigo-600 dark:bg-indigo-950/40 dark:border-indigo-900 dark:text-indigo-400',
  violet: 'bg-violet-50 border-violet-200/80 text-violet-600 dark:bg-violet-950/40 dark:border-violet-900 dark:text-violet-400',
  rose: 'bg-rose-50 border-rose-200/80 text-rose-600 dark:bg-rose-950/40 dark:border-rose-900 dark:text-rose-400',
  orange: 'bg-orange-50 border-orange-200/80 text-orange-600 dark:bg-orange-950/40 dark:border-orange-900 dark:text-orange-400',
  amber: 'bg-amber-50 border-amber-200/80 text-amber-600 dark:bg-amber-950/40 dark:border-amber-900 dark:text-amber-400',
  emerald: 'bg-emerald-50 border-emerald-200/80 text-emerald-600 dark:bg-emerald-950/40 dark:border-emerald-900 dark:text-emerald-400',
  teal: 'bg-teal-50 border-teal-200/80 text-teal-600 dark:bg-teal-950/40 dark:border-teal-900 dark:text-teal-400',
  cyan: 'bg-cyan-50 border-cyan-200/80 text-cyan-600 dark:bg-cyan-950/40 dark:border-cyan-900 dark:text-cyan-400',
  pink: 'bg-pink-50 border-pink-200/80 text-pink-600 dark:bg-pink-950/40 dark:border-pink-900 dark:text-pink-400',
};
