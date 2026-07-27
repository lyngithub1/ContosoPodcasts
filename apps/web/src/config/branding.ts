/**
 * Branding & product configuration — isolated so product name, logos, color
 * tokens, and legal copy can change without rewriting components (Spec §1).
 */
export const branding = {
  productName: 'Azure Scientific Podcast Studio',
  shortName: 'Podcast Studio',
  tagline: 'Research-to-podcast production for scientific & healthcare teams',
  vendor: 'Contoso Life Sciences',
  logoGlyph: '◑', // placeholder mark; replace with brand SVG
  /** Configurable spoken synthetic-media disclosure (Spec §1.14, §11). */
  spokenDisclosure:
    'This recording was generated using synthetic speech and is intended for informational purposes only.',
  /** Visible legal copy shown in the shell footer / publication page. */
  legal: {
    disclaimer:
      'Synthetic media. Not medical advice. This tool provides technical controls; it does not by itself establish HIPAA, GxP, MLR, or regulatory compliance.',
    copyright: `© ${new Date().getFullYear()} Contoso Life Sciences`,
  },
} as const;

export type Branding = typeof branding;
