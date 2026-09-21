import { describe, expect, it } from 'vitest'
import { formatExpiryDuration } from '../src/lib/duration'

describe('formatExpiryDuration', () => {
  it.each([
    [-730, '过期2年（730天）'], [-395, '过期1年1月（395天）'], [-394, '过期1年29天（394天）'],
    [-365, '过期1年（365天）'], [-364, '过期12月4天（364天）'], [-31, '过期1月1天（31天）'],
    [-30, '过期1月（30天）'], [-29, '过期29天（29天）'], [-1, '过期1天（1天）'], [0, '今天到期'],
    [1, '约1天（1天）'], [29, '约29天（29天）'], [30, '约1月（30天）'], [31, '约1月1天（31天）'],
    [364, '约12月4天（364天）'], [365, '约1年（365天）'], [394, '约1年29天（394天）'],
    [395, '约1年1月（395天）'], [730, '约2年（730天）'],
  ])('formats %i days as %s', (days, expected) => {
    expect(formatExpiryDuration(days)).toBe(expected)
  })
})