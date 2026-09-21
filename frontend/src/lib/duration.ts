export function formatExpiryDuration(daysToExpiry: number): string {
  if (daysToExpiry === 0) return '今天到期'

  const absoluteDays = Math.abs(daysToExpiry)
  const years = Math.floor(absoluteDays / 365)
  const remainder = absoluteDays % 365
  const months = Math.floor(remainder / 30)
  const days = remainder % 30
  const detail = [years && `${years}年`, months && `${months}月`, days && `${days}天`]
    .filter(Boolean)
    .join('') || '0天'

  return daysToExpiry < 0
    ? `过期${detail}（${absoluteDays}天）`
    : `约${detail}（${absoluteDays}天）`
}