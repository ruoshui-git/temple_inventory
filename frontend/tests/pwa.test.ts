import { afterEach, describe, expect, it, vi } from 'vitest'
import { detectInstallPlatform, installInstructions, installPwa } from '../src/lib/pwa'

afterEach(() => vi.restoreAllMocks())

describe('PWA installation helpers', () => {
  it('recognizes iOS, iPadOS, Android, and generic browsers', () => {
    expect(detectInstallPlatform('Mozilla/5.0 (iPhone)', 'iPhone', 5)).toBe('ios')
    expect(detectInstallPlatform('Mozilla/5.0', 'MacIntel', 5)).toBe('ios')
    expect(detectInstallPlatform('Mozilla/5.0 (Linux; Android 14)', 'Linux armv8l', 1)).toBe('android')
    expect(detectInstallPlatform('Mozilla/5.0 (X11; Linux x86_64)', 'Linux x86_64', 0)).toBe('other')
  })

  it('provides platform-specific install guidance', () => {
    expect(installInstructions('ios')).toContain('Safari')
    expect(installInstructions('android')).toContain('Chrome')
    expect(installInstructions('other')).toContain('浏览器菜单')
  })

  it('does not attempt a native prompt when the browser has not offered one', async () => {
    await expect(installPwa()).resolves.toBe(false)
  })
})
