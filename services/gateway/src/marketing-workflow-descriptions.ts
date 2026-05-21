/**
 * Marketing Workflow Descriptions — Rich, production-quality descriptions.
 *
 * Overlays the terse boilerplate descriptions in marketing-workflows-data.ts
 * with narrative descriptions that read credibly in the UI's right-panel
 * guide and marketplace cards. Kept as a separate module so the workflow
 * data file stays machine-generated-friendly.
 *
 * To extend: add the workflow's slug or id as key. Descriptions are merged
 * on read via getWorkflowRef() — the overlay wins if both are defined.
 *
 * @author Phani Marupaka <https://linkedin.com/in/phani-marupaka>
 * @copyright © 2026 Phani Marupaka. All rights reserved.
 */

export const RICH_DESCRIPTIONS: Record<string, string> = {
  // Campaign cluster
  'wf-002':
    'Builds a complete product-launch campaign: positioning framework, 3-5 email launch series, landing-page copy, and LinkedIn post series. Takes a feature spec and target audience, returns messaging-tested assets ready for review.',
  'wf-003':
    'Runs account-based outreach for a target list: segments accounts by fit, crafts personalized messaging per segment, and produces ready-to-send outreach emails plus LinkedIn message templates. Pair with Perplexity for account research depth.',
  'wf-004':
    'Produces a paid-media campaign pack: strategy brief, 5-10 ad copy variants, and creative prompts for design tools. Output is LinkedIn-Ads and Google-Ads ready, with length and character limits respected per platform.',
  'wf-005':
    'Plans a multi-channel campaign end-to-end: builds a messaging matrix (audience × channel), proposes a channel-mix plan with suggested budgets, and delivers a creative production checklist per channel.',
  'wf-006':
    'Builds a 5-7 email nurture sequence for a specific funnel stage. Sequence strategy first (cadence, goals, CTAs), then full drafts with subject-line variants for A/B testing. Ready to load into HubSpot.',

  // Content cluster
  'wf-008':
    'Transforms a dense whitepaper PDF into a publishable blog post. Extracts 5-7 key insights, builds a reader-first outline, and drafts the full blog with executive tone preserved. Final draft blocked behind approval.',
  'wf-009':
    'Turns a single long-form piece (whitepaper, annual report, research study) into a 4-6 article series. Identifies distinct angles, builds outlines for each, and drafts the first full article. Lets marketing teams spread thought-leadership over weeks.',
  'wf-010':
    'Drafts a client case study from rough notes or a transcript. Structures the story (challenge-solution-outcome), writes the full draft, and produces a short summary version for sales enablement. Approval-gated on the summary.',
  'wf-011':
    'Assembles a newsletter digest from a batch of articles or insights. Summarizes each article to newsletter-length, then composes the full newsletter with section headings and commentary. Matches Modern Issuer-style long-form digests.',
  'wf-012':
    'Rewrites drafts in executive tone. Analyzes current tone (verbosity, formality, active-voice), then produces multiple rewrite variants: shorter executive version, LinkedIn post adaptation, and a formal report version.',

  // Creative cluster
  'wf-014':
    'Generates event booth standee and signage copy. Produces 3-5 short-copy headline options and a design-direction brief (colors, hierarchy, imagery) that a designer can hand to Canva or a print vendor.',
  'wf-015':
    'Builds banner ad copy in all standard display sizes (728×90, 300×250, 160×600, 320×50). Headline + subhead + CTA per size, plus creative prompts for image-generation tools.',
  'wf-016':
    'Designs ebook and whitepaper covers. Proposes 3-5 cover concepts with typography, color palette, and imagery direction. Outputs a Canva brief ready to hand off to a designer.',

  // Event cluster
  'wf-017':
    'Creates an event promotion kit: invite email, LinkedIn announcement post, and paid-ads copy. Covers pre-event awareness through registration close. Pushes to HubSpot sequences if connected.',
  'wf-018':
    'Builds booth-day messaging: primary booth message, supporting social-teaser posts, and QR-code landing-copy. Written for in-person attention economics.',
  'wf-019':
    'Plans target-account outreach around an event. Prioritizes accounts against fit-score, then drafts personalized invitations and meeting-request emails per account. Approval-gated on the invitations.',
  'wf-020':
    'Generates post-event follow-up assets: follow-up email sequence for attendees, LinkedIn connection messages, and a recap post for the event. Segments by attendee engagement level if analytics are connected.',

  // Research cluster
  'wf-021':
    'Runs a weekly competitor scan. Pulls recent announcements, product updates, pricing moves, and GTM signals via Perplexity research, then synthesizes into a concise brief for the marketing lead with organization-specific implications.',
  'wf-022':
    'Builds an industry trend digest on a chosen topic. Aggregates recent signals (news, research, analyst notes), filters for what matters to your ICP, and delivers a curated digest with commentary.',
  'wf-023':
    'Compares your messaging against 2-5 competitors. Analyzes positioning, value props, and key differentiators; then surfaces the gaps and proposes specific positioning moves to fill them.',
  'wf-024':
    'Builds a research pack for a target account: company overview, product-portfolio gaps, recent news, identified buying signals, and recommended outreach angles. Fuels 1:1 ABM.',

  // Analytics cluster
  'wf-025':
    'Pulls a campaign report from HubSpot (or uploaded metrics), writes a plain-English performance summary, and produces a ranked list of recommended actions. Ideal for weekly campaign standups.',
  'wf-026':
    'Diagnoses funnel drop-off at a specific stage. Accepts staged metrics, identifies likely root causes, and proposes 5-7 optimization ideas ranked by expected-impact vs effort.',
  'wf-027':
    'Compares channel performance (LinkedIn, Google Ads, Email) on a common set of metrics. Produces a head-to-head summary and a reallocation recommendation with rationale.',

  // Sales-enablement cluster
  'wf-028':
    'Generates a product one-pager from inputs. Builds a messaging framework first (audience, value props, proof points), then writes the one-pager copy. Approval-gated for brand review.',
  'wf-029':
    'Produces a competitor battlecard. Pulls competitor research via Perplexity, then builds a structured card: strengths, weaknesses, objection-handling scripts, and talk-tracks for sales.',
  'wf-030':
    'Assembles a pre-meeting brief: company research, stakeholder context, recent signals, and recommended talking-points. Drops into a shared doc or pushes to Salesforce meeting notes if connected.',
};

/** Slug fallbacks — some callers look up by slug rather than id. */
export const RICH_DESCRIPTIONS_BY_SLUG: Record<string, string> = Object.fromEntries(
  [
    // Map each id above to its canonical slug. Kept explicit to avoid runtime
    // coupling to the workflow-data module (prevents circular import).
    ['wf-002', 'product-launch-campaign'],
    ['wf-003', 'abm-outreach-campaign'],
    ['wf-004', 'paid-media-campaign-pack'],
    ['wf-005', 'multi-channel-campaign-planner'],
    ['wf-006', 'nurture-email-sequence'],
    ['wf-008', 'blog-from-whitepaper'],
    ['wf-009', 'blog-series-generator'],
    ['wf-010', 'case-study-draft'],
    ['wf-011', 'newsletter-digest'],
    ['wf-012', 'executive-tone-rewriter'],
    ['wf-014', 'event-standee-generator'],
    ['wf-015', 'banner-ad-generator'],
    ['wf-016', 'ebook-cover-generator'],
    ['wf-017', 'event-promotion-kit'],
    ['wf-018', 'booth-messaging-pack'],
    ['wf-019', 'event-account-outreach'],
    ['wf-020', 'post-event-followup'],
    ['wf-021', 'competitor-weekly-brief'],
    ['wf-022', 'industry-trend-digest'],
    ['wf-023', 'messaging-gap-analysis'],
    ['wf-024', 'account-research-pack'],
    ['wf-025', 'campaign-performance-summary'],
    ['wf-026', 'funnel-dropoff-diagnosis'],
    ['wf-027', 'channel-performance-comparison'],
    ['wf-028', 'one-pager-generator'],
    ['wf-029', 'battlecard-generator'],
    ['wf-030', 'meeting-brief-generator'],
  ].map(([id, slug]) => [slug, RICH_DESCRIPTIONS[id]!]),
);

/** Returns the rich description for an id or slug, or undefined. */
export function getRichDescription(idOrSlug: string): string | undefined {
  return RICH_DESCRIPTIONS[idOrSlug] ?? RICH_DESCRIPTIONS_BY_SLUG[idOrSlug];
}
