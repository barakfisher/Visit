/** "Location · Category" for a business card, leaving out whatever the owner has not filled in. */
export function businessListingLine(location: string | null | undefined, category: string | null | undefined) {
  return [location, category].map(part => part?.trim()).filter(Boolean).join(' · ');
}
