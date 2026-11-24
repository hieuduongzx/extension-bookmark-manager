import { useEffect } from 'react';
import type { ThemeMode } from '../../types';
import { applyTheme } from '../../utils';

export function useApplyTheme(theme: ThemeMode): void {
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => applyTheme(theme);

    apply();
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [theme]);
}
