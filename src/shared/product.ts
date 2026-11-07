/**
 * Product-identity constants shared by everything that needs to know where "Total" lives on
 * the internet. This is the in-app (main-process) source of truth — see CLAUDE.md's "Site deploy"
 * note for why the Next.js site under site/ can't import this file and stays env-driven instead
 * (its own tsconfig has no path into src/shared; it reads GITHUB_REPO / NEXT_PUBLIC_SITE_URL).
 */

/**
 * Canonical marketing/download site. Update here (and the Vercel domain + env) if it ever moves.
 * Moved from devjindal.tech on 8 Nov 2026: apps built before then still ask
 * https://devjindal.tech/api/latest, which the site keeps answering directly (site/lib/redirects.ts).
 */
export const SITE_URL = 'https://irminflow.com'

/** owner/repo on GitHub — where releases are published. */
export const GITHUB_REPO = 'Total-org/total-org'
