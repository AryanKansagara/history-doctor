export type ThemeMode = 'light' | 'dark'

/** Material (md3.io) named schemes — closer to Gemini’s dynamic color options. */
export const THEMES = [
  { id: 'expressive', label: 'Aurora', hint: 'Teal + orchid, soft and lively' },
  { id: 'vibrant', label: 'Nova', hint: 'Bright violet accents' },
  { id: 'ocean', label: 'Tide', hint: 'Cool blue, calm surfaces' },
  { id: 'sunset', label: 'Dusk', hint: 'Warm coral and amber' },
  { id: 'forest', label: 'Grove', hint: 'Green and moss tones' },
  { id: 'spring', label: 'Bloom', hint: 'Fresh green and lilac' },
] as const

export type ThemeId = (typeof THEMES)[number]['id']

const MODE_KEY = 'themeMode'
const THEME_KEY = 'colorTheme'

export function readThemeMode(): ThemeMode {
  const saved = localStorage.getItem(MODE_KEY) as ThemeMode | null
  if (saved === 'light' || saved === 'dark') return saved
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function readThemeId(): ThemeId {
  const saved = localStorage.getItem(THEME_KEY)
  if (THEMES.some((t) => t.id === saved)) return saved as ThemeId
  return 'expressive'
}

export function applyTheme(theme: ThemeId, mode: ThemeMode) {
  document.documentElement.dataset.theme = theme
  document.documentElement.dataset.themeMode = mode
  localStorage.setItem(THEME_KEY, theme)
  localStorage.setItem(MODE_KEY, mode)
}

export function applyThemeMode(mode: ThemeMode) {
  applyTheme(readThemeId(), mode)
}

export function applyThemeId(theme: ThemeId) {
  applyTheme(theme, readThemeMode())
}

export function toggleThemeMode(): ThemeMode {
  const next: ThemeMode = readThemeMode() === 'dark' ? 'light' : 'dark'
  applyThemeMode(next)
  return next
}
