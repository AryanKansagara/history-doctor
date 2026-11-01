const KEY = 'themeMode'

export type ThemeMode = 'light' | 'dark'

export function readThemeMode(): ThemeMode {
  const saved = localStorage.getItem(KEY) as ThemeMode | null
  if (saved === 'light' || saved === 'dark') return saved
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function applyThemeMode(mode: ThemeMode) {
  document.documentElement.dataset.theme = 'ocean'
  document.documentElement.dataset.themeMode = mode
  localStorage.setItem(KEY, mode)
}

export function toggleThemeMode(): ThemeMode {
  const next: ThemeMode = readThemeMode() === 'dark' ? 'light' : 'dark'
  applyThemeMode(next)
  return next
}
