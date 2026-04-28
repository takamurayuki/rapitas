/**
 * Get favicon URL from a website URL
 */
export function getFaviconUrl(url: string): string {
  try {
    const urlObj = new URL(url);
    const domain = urlObj.hostname;

    // Use Google's favicon service as primary option
    // It provides high quality favicons and handles most edge cases
    return `https://www.google.com/s2/favicons?domain=${domain}&sz=64`;
  } catch (error) {
    // Return empty string for invalid URLs
    return '';
  }
}

/**
 * Alternative favicon services (if needed)
 */
export const faviconServices = {
  google: (domain: string) => `https://www.google.com/s2/favicons?domain=${domain}&sz=64`,
  duckduckgo: (domain: string) => `https://icons.duckduckgo.com/ip3/${domain}.ico`,
  clearbit: (domain: string) => `https://logo.clearbit.com/${domain}`,
  faviconkit: (domain: string) => `https://api.faviconkit.com/${domain}/64`,
};
