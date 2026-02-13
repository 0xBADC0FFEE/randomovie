export type SearchCommand = 'trackpad'

export function parseSearchCommand(query: string): SearchCommand | null {
  const normalized = query.trim().toLowerCase()
  if (normalized === '/trackpad') return 'trackpad'
  return null
}
