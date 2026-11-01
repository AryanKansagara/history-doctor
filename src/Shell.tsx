import { useState, type ReactNode } from 'react'
import { IconButton, TopAppBar } from 'material/react'
import { icon } from './icons.ts'
import { applyThemeMode, readThemeMode, type ThemeMode } from './themeMode.ts'

export function Shell({
  name,
  tagline,
  children,
}: {
  name: string
  tagline: string
  icon?: string
  children: ReactNode
}) {
  const [mode, setMode] = useState<ThemeMode>(() => readThemeMode())
  const toggle = () => {
    const next: ThemeMode = mode === 'dark' ? 'light' : 'dark'
    applyThemeMode(next)
    setMode(next)
  }

  return (
    <>
      <TopAppBar
        type="center"
        headline={name}
        no-scroll
        trailing={
          <IconButton
            variant="standard"
            icon={mode === 'dark' ? icon.lightMode : icon.darkMode}
            aria-label={mode === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
            onClick={toggle}
          />
        }
      />
      <p className="shell-tagline muted">{tagline}</p>
      <main className="container">{children}</main>
      <footer className="container footer muted">
        Built by <a href="https://github.com/AryanKansagara">Aryan Kansagara</a>. Independent project, not affiliated with the vendor.
      </footer>
    </>
  )
}
