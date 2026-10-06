/**
 * Marketing Workflows — 30 configurable workflow definitions
 * @author Phani Marupaka <https://linkedin.com/in/phani-marupaka>
 * @copyright © 2026 Phani Marupaka. All rights reserved.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

import { MARKETING_INPUT_FIELDS } from '@agentos/skills/schema';

export type WorkflowCluster = 'Campaign' | 'Content' | 'Creative' | 'Event' | 'Research' | 'Analytics' | 'Sales';

export type InputFieldType = 'text' | 'textarea' | 'select' | 'multiselect' | 'date' | 'file' | 'url' | 'checkbox' | 'tags' | 'number';

export interface InputField {
  id: string;
  label: string;
  type: InputFieldType;
  section: 'basic' | 'advanced';
  required: boolean;
  placeholder?: string;
  options?: string[];
  accept?: string;
  multiple?: boolean;
  helpText?: string;
}

export interface WorkflowStep {
  id: string;
  order: number;
  name: string;
  agent: string;
  tool?: string;
  description: string;
  inputRefs: string[];
  outputKey: string;
  requiresApproval?: boolean;
  estimatedSeconds?: number;
}

export interface WorkflowOutput {
  key: string;
  label: string;
  format: 'markdown' | 'html' | 'text' | 'json' | 'csv';
}

export interface WorkflowDef {
  id: string;
  slug: string;
  name: string;
  cluster: WorkflowCluster;
  description: string;
  icon: string;
  estimatedMinutes: number;
  agents: string[];
  tools: string[];
  inputs: InputField[];
  steps: WorkflowStep[];
  outputs: WorkflowOutput[];
  version: string;
  tags: string[];
}

// ---------------------------------------------------------------------------
// Shared field helpers
// ---------------------------------------------------------------------------

const FILE_UPLOAD_FIELD = (id: string, label: string, accept: string = '.pdf,.ppt,.pptx,.doc,.docx,.csv,image/*'): InputField => ({
  id, label, type: 'file', section: 'advanced', required: false, accept,
  helpText: 'Upload context files — PDFs, docs, or images will be parsed as agent context',
});

const CONTEXT_NOTES_FIELD: InputField = {
  id: 'context_notes', label: 'Additional Notes', type: 'textarea', section: 'advanced', required: false,
  placeholder: 'Brand guidelines, tone preferences, compliance notes, special instructions…',
};

const TOOL_SELECTOR_FIELD = (tools: string[]): InputField => ({
  id: 'tools', label: 'Connected Tools to Use', type: 'multiselect', section: 'advanced', required: false,
  options: tools, helpText: 'Select which connected tools agents should use for this run',
});

// ---------------------------------------------------------------------------
// 30 Workflow Definitions
// ---------------------------------------------------------------------------

export const MARKETING_WORKFLOWS: WorkflowDef[] = [

  // ── CLUSTER 1: CAMPAIGN (6) ──────────────────────────────────────────────

  {
    id: 'wf-001', slug: 'webinar-campaign-generator', name: 'Webinar Campaign Generator',
    cluster: 'Campaign', icon: '🎙️', estimatedMinutes: 8,
    description: 'Generate a complete webinar campaign pack: invite emails, LinkedIn ads, landing page copy, and follow-up sequences.',
    agents: ['Orchestrator', 'Strategy', 'Copy', 'Campaign'],
    tools: ['HubSpot', 'LinkedIn Ads', 'Google Drive'],
    tags: ['webinar', 'email', 'linkedin', 'campaign'],
    version: '1.0',
    inputs: [
      { id: 'webinar_title', label: 'Webinar Title', type: 'text', section: 'basic', required: true, placeholder: 'e.g., The Future of Embedded Finance' },
      { id: 'description', label: 'Webinar Description', type: 'textarea', section: 'basic', required: true, placeholder: 'What is this webinar about? Key topics, takeaways…' },
      { id: 'date', label: 'Webinar Date', type: 'date', section: 'basic', required: true },
      { id: 'speakers', label: 'Speakers', type: 'tags', section: 'basic', required: true, placeholder: 'Add speaker names + titles' },
      { id: 'audience', label: 'Target Audience', type: 'text', section: 'basic', required: true, placeholder: 'e.g., CIOs at mid-market banks' },
      { id: 'cta', label: 'Primary CTA', type: 'text', section: 'basic', required: true, placeholder: 'e.g., Register Now — Free' },
      { id: 'channels', label: 'Channels', type: 'multiselect', section: 'advanced', required: false, options: ['Email', 'LinkedIn Ads', 'Social Posts', 'Landing Page'] },
      FILE_UPLOAD_FIELD('webinar_brief', 'Webinar Brief / Speaker Bios', '.pdf,.doc,.docx'),
      TOOL_SELECTOR_FIELD(['HubSpot', 'LinkedIn Ads', 'Google Drive']),
      CONTEXT_NOTES_FIELD,
    ],
    steps: [
      { id: 's1', order: 1, name: 'Audience & Messaging Strategy', agent: 'Strategy', tool: 'Claude', description: 'Define ICP, messaging pillars, and channel-specific tone', inputRefs: ['audience', 'description'], outputKey: 'strategy', estimatedSeconds: 15 },
      { id: 's2', order: 2, name: 'Write Invite Email Series', agent: 'Copy', tool: 'Claude', description: 'Write 3-part email sequence: save-the-date, reminder, day-of', inputRefs: ['webinar_title', 'speakers', 'cta', 'strategy'], outputKey: 'email_series', estimatedSeconds: 20 },
      { id: 's3', order: 3, name: 'LinkedIn Ad Copy', agent: 'Campaign', tool: 'LinkedIn Ads', description: 'Generate 3 headline + body copy variants for LinkedIn', inputRefs: ['webinar_title', 'audience', 'strategy'], outputKey: 'linkedin_ads', estimatedSeconds: 12 },
      { id: 's4', order: 4, name: 'Landing Page Copy', agent: 'Copy', tool: 'Claude', description: 'Hero, benefits, speaker bios, agenda, registration form copy', inputRefs: ['webinar_title', 'speakers', 'description', 'strategy'], outputKey: 'landing_page', estimatedSeconds: 18 },
      { id: 's5', order: 5, name: 'Post-Webinar Follow-Up', agent: 'Copy', tool: 'Claude', description: 'Write 3-email post-webinar nurture sequence', inputRefs: ['webinar_title', 'audience', 'cta'], outputKey: 'followup_emails', requiresApproval: true, estimatedSeconds: 15 },
    ],
    outputs: [
      { key: 'strategy', label: 'Campaign Strategy', format: 'markdown' },
      { key: 'email_series', label: 'Invite Email Series (3 emails)', format: 'markdown' },
      { key: 'linkedin_ads', label: 'LinkedIn Ad Copy Variants', format: 'markdown' },
      { key: 'landing_page', label: 'Landing Page Copy', format: 'markdown' },
      { key: 'followup_emails', label: 'Post-Webinar Follow-Up Sequence', format: 'markdown' },
    ],
  },

  {
    id: 'wf-002', slug: 'product-launch-campaign', name: 'Product Launch Campaign Builder',
    cluster: 'Campaign', icon: '🚀', estimatedMinutes: 10,
    description: 'Full product launch campaign: messaging, email series, LinkedIn posts, and landing page copy.',
    agents: ['Strategy', 'Copy', 'Campaign'], tools: ['HubSpot', 'WordPress'],
    tags: ['product', 'launch', 'email', 'linkedin'], version: '1.0',
    inputs: [
      { id: 'product_name', label: 'Product / Feature Name', type: 'text', section: 'basic', required: true },
      { id: 'feature_description', label: 'Feature Description', type: 'textarea', section: 'basic', required: true },
      { id: 'audience', label: 'Audience Segment', type: 'text', section: 'basic', required: true },
      { id: 'launch_date', label: 'Launch Date', type: 'date', section: 'basic', required: true },
      { id: 'core_benefit', label: 'Core Benefit / Value Prop', type: 'text', section: 'basic', required: true },
      { id: 'cta', label: 'Primary CTA', type: 'text', section: 'basic', required: false, placeholder: 'e.g., Book a Demo' },
      { id: 'differentiators', label: 'Key Differentiators', type: 'tags', section: 'advanced', required: false },
      FILE_UPLOAD_FIELD('product_docs', 'Product Deck / Spec / Screenshots', '.pdf,.ppt,.pptx,.png,.jpg'),
      TOOL_SELECTOR_FIELD(['HubSpot', 'WordPress']),
      CONTEXT_NOTES_FIELD,
    ],
    steps: [
      { id: 's1', order: 1, name: 'Launch Messaging Framework', agent: 'Strategy', tool: 'Claude', description: 'Create positioning, headline, proof points, objection handlers', inputRefs: ['product_name', 'core_benefit', 'audience', 'differentiators'], outputKey: 'messaging', estimatedSeconds: 18 },
      { id: 's2', order: 2, name: 'Email Launch Series', agent: 'Copy', tool: 'Claude', description: 'Teaser, launch day, and follow-up emails', inputRefs: ['product_name', 'messaging', 'cta'], outputKey: 'email_series', estimatedSeconds: 20 },
      { id: 's3', order: 3, name: 'Landing Page Copy', agent: 'Copy', tool: 'Claude', description: 'Full LP with hero, features, social proof, CTA', inputRefs: ['product_name', 'messaging', 'feature_description'], outputKey: 'landing_page', requiresApproval: true, estimatedSeconds: 18 },
      { id: 's4', order: 4, name: 'LinkedIn Post Series', agent: 'Copy', tool: 'Claude', description: '5 LinkedIn posts: teaser, launch, customer story, insight, recap', inputRefs: ['product_name', 'messaging', 'audience'], outputKey: 'linkedin_posts', estimatedSeconds: 15 },
    ],
    outputs: [
      { key: 'messaging', label: 'Messaging Framework', format: 'markdown' },
      { key: 'email_series', label: 'Email Launch Series', format: 'markdown' },
      { key: 'landing_page', label: 'Landing Page Copy', format: 'markdown' },
      { key: 'linkedin_posts', label: 'LinkedIn Post Series', format: 'markdown' },
    ],
  },

  {
    id: 'wf-003', slug: 'abm-outreach-campaign', name: 'ABM Outreach Campaign',
    cluster: 'Campaign', icon: '🎯', estimatedMinutes: 12,
    description: 'Account-Based Marketing: personalized messaging, outreach emails, and LinkedIn messages for target accounts.',
    agents: ['Research', 'Strategy', 'Copy'], tools: ['Salesforce', 'HubSpot'],
    tags: ['abm', 'outreach', 'email', 'personalization'], version: '1.0',
    inputs: [
      { id: 'account_list', label: 'Target Accounts', type: 'tags', section: 'basic', required: true, placeholder: 'e.g., JPMorgan Chase, Wells Fargo, Bank of America' },
      { id: 'target_personas', label: 'Target Personas', type: 'tags', section: 'basic', required: true, placeholder: 'e.g., CIO, SVP Digital Banking' },
      { id: 'value_prop', label: 'Core Value Proposition', type: 'textarea', section: 'basic', required: true },
      { id: 'offer', label: 'Offer / Hook', type: 'text', section: 'basic', required: false, placeholder: 'e.g., Exclusive briefing on embedded finance ROI' },
      { id: 'event_context', label: 'Event / Initiative Context', type: 'text', section: 'advanced', required: false },
      FILE_UPLOAD_FIELD('account_notes', 'Account Notes / CRM Export', '.pdf,.csv,.xlsx,.doc'),
      TOOL_SELECTOR_FIELD(['Salesforce', 'HubSpot']),
      CONTEXT_NOTES_FIELD,
    ],
    steps: [
      { id: 's1', order: 1, name: 'Account Segmentation', agent: 'Research', tool: 'Perplexity', description: 'Segment accounts by size, industry, tech stack, pain points', inputRefs: ['account_list', 'target_personas'], outputKey: 'account_segments', estimatedSeconds: 15 },
      { id: 's2', order: 2, name: 'Personalized Messaging', agent: 'Strategy', tool: 'Claude', description: 'Account-specific value props and pain point mapping', inputRefs: ['value_prop', 'account_segments', 'target_personas'], outputKey: 'personalized_messaging', estimatedSeconds: 20 },
      { id: 's3', order: 3, name: 'Outreach Email Templates', agent: 'Copy', tool: 'Claude', description: 'Personalized email templates per account segment', inputRefs: ['personalized_messaging', 'offer'], outputKey: 'outreach_emails', estimatedSeconds: 20 },
      { id: 's4', order: 4, name: 'LinkedIn Message Templates', agent: 'Copy', tool: 'Claude', description: 'Connection request + follow-up message variants', inputRefs: ['personalized_messaging', 'target_personas'], outputKey: 'linkedin_messages', requiresApproval: true, estimatedSeconds: 12 },
    ],
    outputs: [
      { key: 'account_segments', label: 'Account Segmentation', format: 'markdown' },
      { key: 'personalized_messaging', label: 'Personalized Messaging Per Segment', format: 'markdown' },
      { key: 'outreach_emails', label: 'Outreach Email Templates', format: 'markdown' },
      { key: 'linkedin_messages', label: 'LinkedIn Message Templates', format: 'markdown' },
    ],
  },

  {
    id: 'wf-004', slug: 'paid-media-campaign-pack', name: 'Paid Media Campaign Pack',
    cluster: 'Campaign', icon: '💰', estimatedMinutes: 8,
    description: 'Ad copy variants, headlines, creative prompts, and campaign brief for paid media channels.',
    agents: ['Strategy', 'Copy', 'Campaign'], tools: ['LinkedIn Ads', 'Google Ads'],
    tags: ['paid', 'ads', 'linkedin', 'google'], version: '1.0',
    inputs: [
      { id: 'campaign_goal', label: 'Campaign Goal', type: 'select', section: 'basic', required: true, options: ['Lead Generation', 'Brand Awareness', 'Event Registration', 'Product Trial', 'Pipeline Acceleration'] },
      { id: 'audience', label: 'Target Audience', type: 'text', section: 'basic', required: true },
      { id: 'budget', label: 'Budget Range', type: 'text', section: 'basic', required: false, placeholder: 'e.g., $5k/month' },
      { id: 'channels', label: 'Ad Channels', type: 'multiselect', section: 'basic', required: true, options: ['LinkedIn Ads', 'Google Ads', 'Meta Ads', 'Display'] },
      { id: 'key_message', label: 'Key Message', type: 'text', section: 'basic', required: true },
      { id: 'offer', label: 'Offer / CTA', type: 'text', section: 'basic', required: true },
      { id: 'image_theme', label: 'Visual Theme', type: 'text', section: 'advanced', required: false, placeholder: 'e.g., financial technology, professional, clean' },
      CONTEXT_NOTES_FIELD,
    ],
    steps: [
      { id: 's1', order: 1, name: 'Campaign Strategy', agent: 'Strategy', tool: 'Claude', description: 'Define objectives, audience targeting, channel mix, and bidding strategy', inputRefs: ['campaign_goal', 'audience', 'budget', 'channels'], outputKey: 'campaign_brief', estimatedSeconds: 15 },
      { id: 's2', order: 2, name: 'Ad Copy Variants', agent: 'Copy', tool: 'Claude', description: 'Generate 5 headline + body copy variants per channel', inputRefs: ['key_message', 'offer', 'audience', 'campaign_brief'], outputKey: 'ad_copy', estimatedSeconds: 20 },
      { id: 's3', order: 3, name: 'Creative Prompts', agent: 'Copy', tool: 'Claude', description: 'Image concept briefs for design team or AI image tools', inputRefs: ['image_theme', 'campaign_brief', 'channels'], outputKey: 'creative_prompts', estimatedSeconds: 10 },
    ],
    outputs: [
      { key: 'campaign_brief', label: 'Campaign Brief', format: 'markdown' },
      { key: 'ad_copy', label: 'Ad Copy Variants', format: 'markdown' },
      { key: 'creative_prompts', label: 'Creative Prompts for Design', format: 'markdown' },
    ],
  },

  {
    id: 'wf-005', slug: 'multi-channel-campaign-planner', name: 'Multi-Channel Campaign Planner',
    cluster: 'Campaign', icon: '📡', estimatedMinutes: 7,
    description: 'Channel plan, messaging matrix, creative checklist, and timeline for a full multi-channel campaign.',
    agents: ['Strategy', 'Campaign'], tools: [],
    tags: ['planning', 'channels', 'matrix'], version: '1.0',
    inputs: [
      { id: 'objective', label: 'Campaign Objective', type: 'text', section: 'basic', required: true },
      { id: 'audience', label: 'Target Audience', type: 'text', section: 'basic', required: true },
      { id: 'channels', label: 'Channels', type: 'multiselect', section: 'basic', required: true, options: ['LinkedIn', 'Google Ads', 'Email', 'Events', 'Blog', 'Social', 'PR'] },
      { id: 'timeline', label: 'Campaign Duration', type: 'text', section: 'basic', required: false, placeholder: 'e.g., 6 weeks starting March 2026' },
      { id: 'budget', label: 'Total Budget', type: 'text', section: 'advanced', required: false },
      FILE_UPLOAD_FIELD('campaign_brief', 'Campaign Brief', '.pdf,.doc,.docx'),
      CONTEXT_NOTES_FIELD,
    ],
    steps: [
      { id: 's1', order: 1, name: 'Messaging Matrix', agent: 'Strategy', tool: 'Claude', description: 'Map audience segments to messaging by channel', inputRefs: ['objective', 'audience', 'channels'], outputKey: 'messaging_matrix', estimatedSeconds: 18 },
      { id: 's2', order: 2, name: 'Channel Plan', agent: 'Campaign', tool: 'Claude', description: 'Channel-specific tactics, frequency, formats, and KPIs', inputRefs: ['channels', 'messaging_matrix', 'timeline', 'budget'], outputKey: 'channel_plan', estimatedSeconds: 15 },
      { id: 's3', order: 3, name: 'Creative Checklist', agent: 'Campaign', tool: 'Claude', description: 'Asset list needed per channel with specs and owners', inputRefs: ['channels', 'channel_plan'], outputKey: 'creative_checklist', estimatedSeconds: 10 },
    ],
    outputs: [
      { key: 'messaging_matrix', label: 'Messaging Matrix', format: 'markdown' },
      { key: 'channel_plan', label: 'Channel Plan', format: 'markdown' },
      { key: 'creative_checklist', label: 'Creative Asset Checklist', format: 'markdown' },
    ],
  },

  {
    id: 'wf-006', slug: 'nurture-email-sequence', name: 'Nurture Email Sequence Builder',
    cluster: 'Campaign', icon: '📧', estimatedMinutes: 8,
    description: 'Create a 5–7 email nurture sequence with subject lines, body copy, and CTAs for any funnel stage.',
    agents: ['Strategy', 'Copy', 'Email'], tools: ['HubSpot'],
    tags: ['email', 'nurture', 'drip', 'funnel'], version: '1.0',
    inputs: [
      { id: 'audience', label: 'Target Audience', type: 'text', section: 'basic', required: true },
      { id: 'funnel_stage', label: 'Funnel Stage', type: 'select', section: 'basic', required: true, options: ['Awareness', 'Consideration', 'Decision', 'Post-Purchase'] },
      { id: 'offer', label: 'Product / Offer', type: 'text', section: 'basic', required: true },
      { id: 'num_emails', label: 'Number of Emails', type: 'select', section: 'basic', required: true, options: ['5', '6', '7'] },
      { id: 'tone', label: 'Tone', type: 'select', section: 'advanced', required: false, options: ['Professional', 'Conversational', 'Executive', 'Technical'] },
      TOOL_SELECTOR_FIELD(['HubSpot', 'Salesforce', 'Mailchimp']),
      CONTEXT_NOTES_FIELD,
    ],
    steps: [
      { id: 's1', order: 1, name: 'Sequence Strategy', agent: 'Strategy', tool: 'Claude', description: 'Define sequence arc, timing, and progression logic', inputRefs: ['audience', 'funnel_stage', 'offer', 'num_emails'], outputKey: 'sequence_strategy', estimatedSeconds: 12 },
      { id: 's2', order: 2, name: 'Email Drafts', agent: 'Copy', tool: 'Claude', description: 'Write all emails with subject lines, body, and CTA', inputRefs: ['sequence_strategy', 'tone', 'audience'], outputKey: 'email_sequence', estimatedSeconds: 25 },
      { id: 's3', order: 3, name: 'Subject Line Variants', agent: 'Copy', tool: 'Claude', description: 'A/B test subject line variants for each email', inputRefs: ['email_sequence'], outputKey: 'subject_variants', requiresApproval: true, estimatedSeconds: 10 },
    ],
    outputs: [
      { key: 'sequence_strategy', label: 'Sequence Strategy', format: 'markdown' },
      { key: 'email_sequence', label: 'Email Sequence', format: 'markdown' },
      { key: 'subject_variants', label: 'Subject Line Variants', format: 'markdown' },
    ],
  },

  // ── CLUSTER 2: CONTENT (6) ───────────────────────────────────────────────

  {
    id: 'wf-007', slug: 'blog-from-brief', name: 'Blog From Brief',
    cluster: 'Content', icon: '✍️', estimatedMinutes: 8,
    description: 'Generate a fully drafted blog post with SEO metadata from a brief, outline, or key points.',
    agents: ['Research', 'Copy'], tools: ['WordPress'],
    tags: ['blog', 'seo', 'content', 'writing'], version: '1.0',
    inputs: [
      { id: 'blog_title', label: 'Blog Title', type: 'text', section: 'basic', required: true },
      { id: 'audience', label: 'Target Audience', type: 'text', section: 'basic', required: true },
      { id: 'key_points', label: 'Key Points / Talking Points', type: 'textarea', section: 'basic', required: true, placeholder: 'What are the 3–5 key messages this blog must convey?' },
      { id: 'primary_keyword', label: 'Primary SEO Keyword', type: 'text', section: 'advanced', required: false },
      { id: 'secondary_keywords', label: 'Secondary Keywords', type: 'tags', section: 'advanced', required: false },
      { id: 'word_count', label: 'Target Word Count', type: 'select', section: 'advanced', required: false, options: ['600–800', '800–1200', '1200–1800', '1800+'] },
      FILE_UPLOAD_FIELD('brief_file', 'Brief / Outline / Reference Whitepaper', '.pdf,.doc,.docx'),
      CONTEXT_NOTES_FIELD,
    ],
    steps: [
      { id: 's1', order: 1, name: 'Outline & Structure', agent: 'Copy', tool: 'Claude', description: 'Create structured outline with H2/H3 sections', inputRefs: ['blog_title', 'key_points', 'audience'], outputKey: 'outline', estimatedSeconds: 12 },
      { id: 's2', order: 2, name: 'Blog Draft', agent: 'Copy', tool: 'Claude', description: 'Write full blog post from outline', inputRefs: ['outline', 'key_points', 'word_count'], outputKey: 'blog_draft', estimatedSeconds: 25 },
      { id: 's3', order: 3, name: 'SEO Metadata', agent: 'Copy', tool: 'Claude', description: 'Meta title, meta description, URL slug, alt text', inputRefs: ['blog_draft', 'primary_keyword', 'secondary_keywords'], outputKey: 'seo_metadata', estimatedSeconds: 8 },
    ],
    outputs: [
      { key: 'outline', label: 'Blog Outline', format: 'markdown' },
      { key: 'blog_draft', label: 'Blog Draft', format: 'markdown' },
      { key: 'seo_metadata', label: 'SEO Metadata', format: 'markdown' },
    ],
  },

  {
    id: 'wf-008', slug: 'blog-from-whitepaper', name: 'Blog From Whitepaper',
    cluster: 'Content', icon: '📄', estimatedMinutes: 10,
    description: 'Upload a whitepaper PDF and generate a blog outline, full draft, and SEO metadata.',
    agents: ['Research', 'Copy'], tools: [],
    tags: ['blog', 'whitepaper', 'repurposing'], version: '1.0',
    inputs: [
      FILE_UPLOAD_FIELD('whitepaper', 'Whitepaper PDF *', '.pdf'),
      { id: 'audience', label: 'Target Audience', type: 'text', section: 'basic', required: true },
      { id: 'blog_length', label: 'Blog Length', type: 'select', section: 'basic', required: false, options: ['Short (600–800w)', 'Medium (800–1200w)', 'Long (1200–1800w)'] },
      { id: 'focus_section', label: 'Focus Section / Angle', type: 'text', section: 'advanced', required: false, placeholder: 'Which part of the whitepaper to focus on?' },
      CONTEXT_NOTES_FIELD,
    ],
    steps: [
      { id: 's1', order: 1, name: 'Extract Key Insights', agent: 'Research', tool: 'Claude', description: 'Parse whitepaper and extract key arguments, data, quotes', inputRefs: ['whitepaper', 'focus_section'], outputKey: 'key_insights', estimatedSeconds: 15 },
      { id: 's2', order: 2, name: 'Blog Outline', agent: 'Copy', tool: 'Claude', description: 'Structure insights into a blog-appropriate narrative', inputRefs: ['key_insights', 'audience'], outputKey: 'outline', estimatedSeconds: 10 },
      { id: 's3', order: 3, name: 'Blog Draft', agent: 'Copy', tool: 'Claude', description: 'Write full blog post from outline and whitepaper insights', inputRefs: ['outline', 'key_insights', 'blog_length'], outputKey: 'blog_draft', requiresApproval: true, estimatedSeconds: 25 },
    ],
    outputs: [
      { key: 'key_insights', label: 'Extracted Key Insights', format: 'markdown' },
      { key: 'outline', label: 'Blog Outline', format: 'markdown' },
      { key: 'blog_draft', label: 'Blog Draft', format: 'markdown' },
    ],
  },

  {
    id: 'wf-009', slug: 'blog-series-generator', name: 'Blog Series Generator',
    cluster: 'Content', icon: '📚', estimatedMinutes: 12,
    description: 'Turn a whitepaper or long-form content into a 4–6 blog series with unique angles.',
    agents: ['Research', 'Strategy', 'Copy'], tools: [],
    tags: ['blog', 'series', 'repurposing', 'content'], version: '1.0',
    inputs: [
      FILE_UPLOAD_FIELD('source_content', 'Source Content (Whitepaper / Long Article)', '.pdf,.doc,.docx'),
      { id: 'num_articles', label: 'Number of Articles', type: 'select', section: 'basic', required: true, options: ['4', '5', '6'] },
      { id: 'audience', label: 'Target Audience', type: 'text', section: 'basic', required: true },
      CONTEXT_NOTES_FIELD,
    ],
    steps: [
      { id: 's1', order: 1, name: 'Identify Series Angles', agent: 'Strategy', tool: 'Claude', description: 'Identify 4–6 distinct blog angles from source material', inputRefs: ['source_content', 'num_articles', 'audience'], outputKey: 'series_angles', estimatedSeconds: 15 },
      { id: 's2', order: 2, name: 'Blog Outlines', agent: 'Copy', tool: 'Claude', description: 'Create outline for each article in the series', inputRefs: ['series_angles'], outputKey: 'series_outlines', estimatedSeconds: 20 },
      { id: 's3', order: 3, name: 'Draft Article 1', agent: 'Copy', tool: 'Claude', description: 'Write first article as a template for the series', inputRefs: ['series_outlines', 'audience'], outputKey: 'article_1_draft', requiresApproval: true, estimatedSeconds: 25 },
    ],
    outputs: [
      { key: 'series_angles', label: 'Blog Series Topics & Angles', format: 'markdown' },
      { key: 'series_outlines', label: 'Full Series Outlines', format: 'markdown' },
      { key: 'article_1_draft', label: 'First Article Draft', format: 'markdown' },
    ],
  },

  {
    id: 'wf-010', slug: 'case-study-draft', name: 'Case Study Draft Generator',
    cluster: 'Content', icon: '🏆', estimatedMinutes: 10,
    description: 'Write a client case study from interview notes or internal documents.',
    agents: ['Research', 'Copy'], tools: [],
    tags: ['case-study', 'customer', 'social-proof'], version: '1.0',
    inputs: [
      { id: 'client_name', label: 'Client Name', type: 'text', section: 'basic', required: true },
      { id: 'industry', label: 'Client Industry', type: 'text', section: 'basic', required: true },
      { id: 'problem', label: 'Problem / Challenge', type: 'textarea', section: 'basic', required: true },
      { id: 'solution', label: 'Solution Delivered', type: 'textarea', section: 'basic', required: true },
      { id: 'results', label: 'Results & Metrics', type: 'textarea', section: 'basic', required: true, placeholder: 'e.g., 40% reduction in onboarding time, $2M savings…' },
      FILE_UPLOAD_FIELD('interview_notes', 'Interview Notes / Presentation', '.pdf,.doc,.docx,.ppt,.pptx'),
      CONTEXT_NOTES_FIELD,
    ],
    steps: [
      { id: 's1', order: 1, name: 'Structure Case Study', agent: 'Copy', tool: 'Claude', description: 'Define narrative arc: challenge → solution → outcome → quote', inputRefs: ['client_name', 'problem', 'solution', 'results'], outputKey: 'case_study_structure', estimatedSeconds: 12 },
      { id: 's2', order: 2, name: 'Full Case Study Draft', agent: 'Copy', tool: 'Claude', description: 'Write complete case study with exec summary', inputRefs: ['case_study_structure', 'industry'], outputKey: 'case_study_draft', estimatedSeconds: 22 },
      { id: 's3', order: 3, name: 'Short Summary Version', agent: 'Copy', tool: 'Claude', description: 'Write 2-paragraph summary for website and sales use', inputRefs: ['case_study_draft'], outputKey: 'case_study_summary', requiresApproval: true, estimatedSeconds: 8 },
    ],
    outputs: [
      { key: 'case_study_structure', label: 'Case Study Structure', format: 'markdown' },
      { key: 'case_study_draft', label: 'Full Case Study Draft', format: 'markdown' },
      { key: 'case_study_summary', label: 'Short Summary Version', format: 'markdown' },
    ],
  },

  {
    id: 'wf-011', slug: 'newsletter-digest', name: 'Newsletter Digest Generator',
    cluster: 'Content', icon: '📰', estimatedMinutes: 8,
    description: 'Curate and write a newsletter digest from articles, insights, and commentary.',
    agents: ['Research', 'Copy'], tools: [],
    tags: ['newsletter', 'digest', 'content', 'curation'], version: '1.0',
    inputs: [
      { id: 'newsletter_title', label: 'Newsletter Name', type: 'text', section: 'basic', required: true, placeholder: "e.g., Modern Issuer's Digest" },
      { id: 'audience', label: 'Audience', type: 'text', section: 'basic', required: true },
      { id: 'article_links', label: 'Article Links', type: 'textarea', section: 'basic', required: false, placeholder: 'Paste URLs — one per line' },
      FILE_UPLOAD_FIELD('articles', 'Article Files', '.pdf,.doc,.docx'),
      { id: 'commentary_tone', label: 'Commentary Tone', type: 'select', section: 'advanced', required: false, options: ['Expert insight', 'Conversational', 'Neutral summary', 'Opinionated'] },
      CONTEXT_NOTES_FIELD,
    ],
    steps: [
      { id: 's1', order: 1, name: 'Summarize Articles', agent: 'Research', tool: 'Claude', description: 'Extract key insight from each article', inputRefs: ['article_links', 'articles'], outputKey: 'article_summaries', estimatedSeconds: 18 },
      { id: 's2', order: 2, name: 'Write Newsletter', agent: 'Copy', tool: 'Claude', description: 'Compile digest with intro, sections, and sign-off', inputRefs: ['newsletter_title', 'audience', 'article_summaries', 'commentary_tone'], outputKey: 'newsletter_draft', estimatedSeconds: 20 },
    ],
    outputs: [
      { key: 'article_summaries', label: 'Article Summaries', format: 'markdown' },
      { key: 'newsletter_draft', label: 'Newsletter Draft', format: 'markdown' },
    ],
  },

  {
    id: 'wf-012', slug: 'executive-tone-rewriter', name: 'Executive Tone Rewriter',
    cluster: 'Content', icon: '💼', estimatedMinutes: 3,
    description: 'Rewrite any draft in executive tone, thought leadership style, or as a LinkedIn post.',
    agents: ['Copy'], tools: [],
    tags: ['rewrite', 'tone', 'executive', 'linkedin'], version: '1.0',
    inputs: [
      { id: 'draft_text', label: 'Paste Your Draft', type: 'textarea', section: 'basic', required: true, placeholder: 'Paste the text you want rewritten…' },
      { id: 'tone', label: 'Target Tone', type: 'multiselect', section: 'basic', required: true, options: ['Executive', 'Thought Leadership', 'Conversational', 'Formal', 'LinkedIn Post'] },
      { id: 'preserve_points', label: 'Points to Preserve', type: 'text', section: 'advanced', required: false, placeholder: 'e.g., Keep the ROI numbers exactly' },
      CONTEXT_NOTES_FIELD,
    ],
    steps: [
      { id: 's1', order: 1, name: 'Tone Analysis', agent: 'Copy', tool: 'Claude', description: 'Analyze draft and identify rewrite opportunities', inputRefs: ['draft_text', 'tone'], outputKey: 'tone_notes', estimatedSeconds: 8 },
      { id: 's2', order: 2, name: 'Rewrites', agent: 'Copy', tool: 'Claude', description: 'Generate rewrite in each requested tone', inputRefs: ['draft_text', 'tone', 'preserve_points', 'tone_notes'], outputKey: 'rewrites', estimatedSeconds: 15 },
    ],
    outputs: [
      { key: 'tone_notes', label: 'Tone Analysis Notes', format: 'markdown' },
      { key: 'rewrites', label: 'Rewrite Variants', format: 'markdown' },
    ],
  },

  // ── CLUSTER 3: CREATIVE (4) ──────────────────────────────────────────────

  {
    id: 'wf-013', slug: 'linkedin-creative-generator', name: 'LinkedIn Creative Generator',
    cluster: 'Creative', icon: '🎨', estimatedMinutes: 6,
    description: 'Generate image concepts, copy variants, and design briefs for LinkedIn ad creatives.',
    agents: ['Copy', 'Design'], tools: ['Canva'],
    tags: ['linkedin', 'creative', 'ads', 'design'], version: '1.0',
    inputs: [
      { id: 'campaign_message', label: 'Campaign Message', type: 'text', section: 'basic', required: true },
      { id: 'audience', label: 'Target Audience', type: 'text', section: 'basic', required: true },
      { id: 'format', label: 'Ad Format', type: 'multiselect', section: 'basic', required: true, options: ['Single Image', 'Carousel', 'Video (script)', 'Document Ad'] },
      { id: 'visual_theme', label: 'Visual Theme', type: 'text', section: 'advanced', required: false, placeholder: 'e.g., clean fintech, data visualization, professional' },
      FILE_UPLOAD_FIELD('brand_assets', 'Brand Guidelines / Reference Images', '.pdf,.png,.jpg'),
      CONTEXT_NOTES_FIELD,
    ],
    steps: [
      { id: 's1', order: 1, name: 'Creative Concepts', agent: 'Design', tool: 'Claude', description: 'Generate 3 creative concept directions with rationale', inputRefs: ['campaign_message', 'audience', 'visual_theme', 'format'], outputKey: 'creative_concepts', estimatedSeconds: 12 },
      { id: 's2', order: 2, name: 'Ad Copy Variants', agent: 'Copy', tool: 'Claude', description: 'Headline + intro copy for each concept + format', inputRefs: ['creative_concepts', 'campaign_message', 'audience'], outputKey: 'ad_copy', estimatedSeconds: 15 },
      { id: 's3', order: 3, name: 'Canva Design Brief', agent: 'Design', tool: 'Canva', description: 'Structured brief for Canva including colors, layout, copy placement', inputRefs: ['creative_concepts', 'ad_copy'], outputKey: 'design_brief', requiresApproval: true, estimatedSeconds: 10 },
    ],
    outputs: [
      { key: 'creative_concepts', label: 'Creative Concept Directions', format: 'markdown' },
      { key: 'ad_copy', label: 'Ad Copy Variants', format: 'markdown' },
      { key: 'design_brief', label: 'Canva Design Brief', format: 'markdown' },
    ],
  },

  {
    id: 'wf-014', slug: 'event-standee-generator', name: 'Event Standee Generator',
    cluster: 'Creative', icon: '🖼️', estimatedMinutes: 4,
    description: 'Generate standee copy, booth headlines, and tagline options for event booth materials.',
    agents: ['Copy', 'Design'], tools: [],
    tags: ['event', 'standee', 'booth', 'copy'], version: '1.0',
    inputs: [
      { id: 'event_name', label: 'Event Name', type: 'text', section: 'basic', required: true },
      { id: 'audience', label: 'Audience', type: 'text', section: 'basic', required: true },
      { id: 'product_focus', label: 'Product / Solution Focus', type: 'text', section: 'basic', required: true },
      { id: 'theme', label: 'Messaging Theme', type: 'text', section: 'basic', required: false },
      { id: 'brand_voice', label: 'Brand Voice', type: 'select', section: 'advanced', required: false, options: ['Bold', 'Professional', 'Friendly', 'Technical'] },
      CONTEXT_NOTES_FIELD,
    ],
    steps: [
      { id: 's1', order: 1, name: 'Standee Copy Options', agent: 'Copy', tool: 'Claude', description: '3 headline + tagline + body copy variants', inputRefs: ['event_name', 'product_focus', 'audience', 'theme', 'brand_voice'], outputKey: 'standee_copy', estimatedSeconds: 12 },
      { id: 's2', order: 2, name: 'Design Direction Notes', agent: 'Design', tool: 'Claude', description: 'Color, layout, and visual style notes for the designer', inputRefs: ['standee_copy', 'brand_voice'], outputKey: 'design_notes', estimatedSeconds: 8 },
    ],
    outputs: [
      { key: 'standee_copy', label: 'Standee Copy Variants', format: 'markdown' },
      { key: 'design_notes', label: 'Design Direction Notes', format: 'markdown' },
    ],
  },

  {
    id: 'wf-015', slug: 'banner-ad-generator', name: 'Banner Ad Generator',
    cluster: 'Creative', icon: '🏷️', estimatedMinutes: 5,
    description: 'Generate banner ad copy, creative prompts, and size variants for display advertising.',
    agents: ['Copy', 'Design'], tools: [],
    tags: ['banner', 'display', 'ads', 'creative'], version: '1.0',
    inputs: [
      { id: 'product_message', label: 'Product Message', type: 'text', section: 'basic', required: true },
      { id: 'audience', label: 'Target Audience', type: 'text', section: 'basic', required: true },
      { id: 'sizes', label: 'Ad Sizes', type: 'multiselect', section: 'basic', required: true, options: ['300×250', '728×90', '160×600', '1080×1080', '1200×628'] },
      { id: 'cta', label: 'CTA Text', type: 'text', section: 'basic', required: false, placeholder: 'e.g., Learn More, Get Demo' },
      CONTEXT_NOTES_FIELD,
    ],
    steps: [
      { id: 's1', order: 1, name: 'Copy Per Size', agent: 'Copy', tool: 'Claude', description: 'Headline + body text adapted for each size constraint', inputRefs: ['product_message', 'audience', 'sizes', 'cta'], outputKey: 'banner_copy', estimatedSeconds: 15 },
      { id: 's2', order: 2, name: 'Creative Prompts', agent: 'Design', tool: 'Claude', description: 'Image generation prompts for each banner size', inputRefs: ['banner_copy', 'sizes'], outputKey: 'creative_prompts', estimatedSeconds: 10 },
    ],
    outputs: [
      { key: 'banner_copy', label: 'Banner Copy Per Size', format: 'markdown' },
      { key: 'creative_prompts', label: 'Image Generation Prompts', format: 'markdown' },
    ],
  },

  {
    id: 'wf-016', slug: 'ebook-cover-generator', name: 'Ebook / Whitepaper Cover Generator',
    cluster: 'Creative', icon: '📔', estimatedMinutes: 5,
    description: 'Generate cover concepts, Canva design briefs, and style options for ebook and whitepaper covers.',
    agents: ['Design', 'Copy'], tools: ['Canva'],
    tags: ['ebook', 'whitepaper', 'cover', 'design'], version: '1.0',
    inputs: [
      { id: 'title', label: 'Ebook / Whitepaper Title', type: 'text', section: 'basic', required: true },
      { id: 'subtitle', label: 'Subtitle', type: 'text', section: 'basic', required: false },
      { id: 'theme', label: 'Visual Theme', type: 'text', section: 'basic', required: true, placeholder: 'e.g., fintech, data, innovation, enterprise' },
      { id: 'style', label: 'Design Style', type: 'multiselect', section: 'basic', required: true, options: ['Modern', 'Corporate', 'Minimal', 'Bold', 'Illustrative'] },
      CONTEXT_NOTES_FIELD,
    ],
    steps: [
      { id: 's1', order: 1, name: 'Cover Concepts', agent: 'Design', tool: 'Claude', description: '3 distinct cover concepts with visual direction', inputRefs: ['title', 'subtitle', 'theme', 'style'], outputKey: 'cover_concepts', estimatedSeconds: 12 },
      { id: 's2', order: 2, name: 'Canva Brief', agent: 'Design', tool: 'Canva', description: 'Detailed Canva layout brief with colors, fonts, imagery', inputRefs: ['cover_concepts'], outputKey: 'canva_brief', estimatedSeconds: 10 },
    ],
    outputs: [
      { key: 'cover_concepts', label: 'Cover Concept Options', format: 'markdown' },
      { key: 'canva_brief', label: 'Canva Design Brief', format: 'markdown' },
    ],
  },

  // ── CLUSTER 4: EVENT (4) ─────────────────────────────────────────────────

  {
    id: 'wf-017', slug: 'event-promotion-kit', name: 'Event Promotion Kit',
    cluster: 'Event', icon: '🎪', estimatedMinutes: 8,
    description: 'Full event promotion pack: invite email, LinkedIn post, ad copy for any event.',
    agents: ['Strategy', 'Copy', 'Campaign'], tools: ['HubSpot', 'LinkedIn Ads'],
    tags: ['event', 'promotion', 'email', 'linkedin'], version: '1.0',
    inputs: [
      { id: 'event_name', label: 'Event Name', type: 'text', section: 'basic', required: true },
      { id: 'event_date', label: 'Event Date', type: 'date', section: 'basic', required: true },
      { id: 'speakers', label: 'Speakers', type: 'tags', section: 'basic', required: false },
      { id: 'audience', label: 'Target Audience', type: 'text', section: 'basic', required: true },
      { id: 'key_message', label: 'Key Message / Benefit', type: 'text', section: 'basic', required: true },
      { id: 'cta', label: 'CTA', type: 'text', section: 'basic', required: true, placeholder: 'e.g., Register Free' },
      TOOL_SELECTOR_FIELD(['HubSpot', 'LinkedIn Ads']),
      CONTEXT_NOTES_FIELD,
    ],
    steps: [
      { id: 's1', order: 1, name: 'Invite Email', agent: 'Copy', tool: 'Claude', description: 'Write save-the-date + event invite email', inputRefs: ['event_name', 'speakers', 'audience', 'cta'], outputKey: 'invite_email', estimatedSeconds: 15 },
      { id: 's2', order: 2, name: 'LinkedIn Post', agent: 'Copy', tool: 'Claude', description: 'Organic LinkedIn announcement post', inputRefs: ['event_name', 'key_message', 'audience'], outputKey: 'linkedin_post', estimatedSeconds: 10 },
      { id: 's3', order: 3, name: 'Ad Copy', agent: 'Campaign', tool: 'LinkedIn Ads', description: 'LinkedIn Ads copy for event promotion', inputRefs: ['event_name', 'audience', 'cta', 'key_message'], outputKey: 'ad_copy', estimatedSeconds: 12 },
    ],
    outputs: [
      { key: 'invite_email', label: 'Invite Email', format: 'markdown' },
      { key: 'linkedin_post', label: 'LinkedIn Organic Post', format: 'markdown' },
      { key: 'ad_copy', label: 'LinkedIn Ad Copy', format: 'markdown' },
    ],
  },

  {
    id: 'wf-018', slug: 'booth-messaging-pack', name: 'Booth Messaging Pack',
    cluster: 'Event', icon: '🏪', estimatedMinutes: 5,
    description: 'Booth headline, standee copy, social teaser, and handout messaging for trade shows.',
    agents: ['Copy', 'Design'], tools: [],
    tags: ['booth', 'tradeshow', 'event', 'messaging'], version: '1.0',
    inputs: [
      { id: 'event', label: 'Event Name', type: 'text', section: 'basic', required: true },
      { id: 'product_focus', label: 'Product Focus', type: 'text', section: 'basic', required: true },
      { id: 'headline_theme', label: 'Messaging Theme', type: 'text', section: 'basic', required: false },
      { id: 'audience', label: 'Target Audience', type: 'text', section: 'basic', required: true },
      CONTEXT_NOTES_FIELD,
    ],
    steps: [
      { id: 's1', order: 1, name: 'Booth Messaging', agent: 'Copy', tool: 'Claude', description: 'Headline, subheadline, 3 bullet benefits, CTA', inputRefs: ['event', 'product_focus', 'headline_theme', 'audience'], outputKey: 'booth_messaging', estimatedSeconds: 12 },
      { id: 's2', order: 2, name: 'Social Teaser', agent: 'Copy', tool: 'Claude', description: 'LinkedIn teaser post for pre-event buzz', inputRefs: ['booth_messaging', 'event'], outputKey: 'social_teaser', estimatedSeconds: 8 },
    ],
    outputs: [
      { key: 'booth_messaging', label: 'Booth Messaging Pack', format: 'markdown' },
      { key: 'social_teaser', label: 'Social Teaser Post', format: 'markdown' },
    ],
  },

  {
    id: 'wf-019', slug: 'event-account-outreach', name: 'Event Account Outreach Pack',
    cluster: 'Event', icon: '📬', estimatedMinutes: 10,
    description: 'Account-specific invitations and meeting outreach copy from an account list.',
    agents: ['Research', 'Copy'], tools: ['Salesforce'],
    tags: ['event', 'abm', 'outreach', 'meetings'], version: '1.0',
    inputs: [
      { id: 'event', label: 'Event Name', type: 'text', section: 'basic', required: true },
      { id: 'meeting_purpose', label: 'Meeting Purpose', type: 'text', section: 'basic', required: true, placeholder: 'e.g., Product briefing, executive roundtable' },
      FILE_UPLOAD_FIELD('account_list', 'Account List (CSV)', '.csv,.xlsx'),
      { id: 'value_prop', label: 'Meeting Value Prop', type: 'textarea', section: 'basic', required: true },
      TOOL_SELECTOR_FIELD(['Salesforce', 'HubSpot']),
      CONTEXT_NOTES_FIELD,
    ],
    steps: [
      { id: 's1', order: 1, name: 'Account Prioritization', agent: 'Research', tool: 'Claude', description: 'Segment accounts by priority and personalization angle', inputRefs: ['account_list', 'event'], outputKey: 'account_priority', estimatedSeconds: 15 },
      { id: 's2', order: 2, name: 'Personalized Invitations', agent: 'Copy', tool: 'Claude', description: 'Account-specific invite and meeting request emails', inputRefs: ['account_priority', 'meeting_purpose', 'value_prop'], outputKey: 'personalized_invites', requiresApproval: true, estimatedSeconds: 20 },
    ],
    outputs: [
      { key: 'account_priority', label: 'Account Priority Segments', format: 'markdown' },
      { key: 'personalized_invites', label: 'Personalized Invitation Templates', format: 'markdown' },
    ],
  },

  {
    id: 'wf-020', slug: 'post-event-followup', name: 'Post-Event Follow-Up Generator',
    cluster: 'Event', icon: '🤝', estimatedMinutes: 8,
    description: 'Write follow-up emails, LinkedIn messages, and a recap post from event summary and leads.',
    agents: ['Copy', 'Campaign'], tools: ['HubSpot'],
    tags: ['event', 'followup', 'email', 'linkedin'], version: '1.0',
    inputs: [
      { id: 'event_name', label: 'Event Name', type: 'text', section: 'basic', required: true },
      { id: 'event_summary', label: 'Event Summary / Key Moments', type: 'textarea', section: 'basic', required: true },
      FILE_UPLOAD_FIELD('lead_list', 'Lead List', '.csv,.xlsx'),
      { id: 'next_step', label: 'Desired Next Step', type: 'text', section: 'basic', required: true, placeholder: 'e.g., Book a demo, Download whitepaper' },
      CONTEXT_NOTES_FIELD,
    ],
    steps: [
      { id: 's1', order: 1, name: 'Follow-Up Email Sequence', agent: 'Copy', tool: 'Claude', description: 'Immediate thank-you + nurture follow-up emails', inputRefs: ['event_name', 'event_summary', 'next_step'], outputKey: 'followup_emails', estimatedSeconds: 18 },
      { id: 's2', order: 2, name: 'LinkedIn Messages', agent: 'Copy', tool: 'Claude', description: 'LinkedIn connection follow-up messages per persona type', inputRefs: ['event_name', 'next_step'], outputKey: 'linkedin_messages', estimatedSeconds: 12 },
      { id: 's3', order: 3, name: 'Event Recap Post', agent: 'Copy', tool: 'Claude', description: 'LinkedIn post celebrating event highlights', inputRefs: ['event_name', 'event_summary'], outputKey: 'recap_post', estimatedSeconds: 8 },
    ],
    outputs: [
      { key: 'followup_emails', label: 'Follow-Up Email Sequence', format: 'markdown' },
      { key: 'linkedin_messages', label: 'LinkedIn Follow-Up Messages', format: 'markdown' },
      { key: 'recap_post', label: 'Event Recap Post', format: 'markdown' },
    ],
  },

  // ── CLUSTER 5: RESEARCH (4) ──────────────────────────────────────────────

  {
    id: 'wf-021', slug: 'competitor-weekly-brief', name: 'Competitor Weekly Brief',
    cluster: 'Research', icon: '🕵️', estimatedMinutes: 12,
    description: 'Weekly competitive intelligence memo: developments, positioning changes, and implications.',
    agents: ['Research', 'Competitor'], tools: ['Perplexity', 'Semrush'],
    tags: ['competitive', 'research', 'intelligence'], version: '1.0',
    inputs: [
      { id: 'competitor_list', label: 'Competitor List', type: 'tags', section: 'basic', required: true },
      { id: 'market_segment', label: 'Market Segment Focus', type: 'text', section: 'basic', required: false },
      { id: 'focus_areas', label: 'Focus Areas', type: 'multiselect', section: 'basic', required: false, options: ['Product Updates', 'Marketing / Messaging', 'Funding / M&A', 'Partnerships', 'Talent', 'Pricing'] },
      CONTEXT_NOTES_FIELD,
    ],
    steps: [
      { id: 's1', order: 1, name: 'Research Competitors', agent: 'Research', tool: 'Perplexity', description: 'Search for latest news and activity across all competitors', inputRefs: ['competitor_list', 'focus_areas'], outputKey: 'raw_research', estimatedSeconds: 20 },
      { id: 's2', order: 2, name: 'Competitive Brief', agent: 'Competitor', tool: 'Claude', description: 'Summarize key developments, patterns, and strategic implications', inputRefs: ['raw_research', 'market_segment'], outputKey: 'competitive_brief', estimatedSeconds: 18 },
    ],
    outputs: [
      { key: 'raw_research', label: 'Raw Research Notes', format: 'markdown' },
      { key: 'competitive_brief', label: 'Competitive Intelligence Brief', format: 'markdown' },
    ],
  },

  {
    id: 'wf-022', slug: 'industry-trend-digest', name: 'Industry Trend Digest',
    cluster: 'Research', icon: '📈', estimatedMinutes: 10,
    description: 'Curated industry trend digest with insights and commentary on a topic.',
    agents: ['Research'], tools: ['Perplexity'],
    tags: ['trends', 'research', 'insights'], version: '1.0',
    inputs: [
      { id: 'topic', label: 'Topic / Theme', type: 'text', section: 'basic', required: true, placeholder: 'e.g., Embedded Finance, AI in Banking, Digital Lending' },
      { id: 'time_range', label: 'Time Range', type: 'select', section: 'basic', required: false, options: ['Last week', 'Last month', 'Last quarter'] },
      { id: 'source_urls', label: 'Seed URLs', type: 'textarea', section: 'advanced', required: false, placeholder: 'Paste URLs to include — one per line' },
      CONTEXT_NOTES_FIELD,
    ],
    steps: [
      { id: 's1', order: 1, name: 'Trend Research', agent: 'Research', tool: 'Perplexity', description: 'Search for latest trends, data points, and thought leadership', inputRefs: ['topic', 'time_range', 'source_urls'], outputKey: 'trend_research', estimatedSeconds: 18 },
      { id: 's2', order: 2, name: 'Trend Digest', agent: 'Research', tool: 'Claude', description: 'Write curated digest with commentary and implications', inputRefs: ['trend_research', 'topic'], outputKey: 'trend_digest', estimatedSeconds: 15 },
    ],
    outputs: [
      { key: 'trend_research', label: 'Research Notes', format: 'markdown' },
      { key: 'trend_digest', label: 'Trend Digest', format: 'markdown' },
    ],
  },

  {
    id: 'wf-023', slug: 'messaging-gap-analysis', name: 'Messaging Gap Analysis',
    cluster: 'Research', icon: '🔍', estimatedMinutes: 10,
    description: 'Compare competitor messaging to identify differentiation gaps and positioning opportunities.',
    agents: ['Research', 'Competitor', 'Strategy'], tools: ['Perplexity'],
    tags: ['positioning', 'messaging', 'competitive', 'differentiation'], version: '1.0',
    inputs: [
      { id: 'competitor_messaging', label: 'Competitor Messaging', type: 'textarea', section: 'basic', required: false, placeholder: 'Paste competitor taglines, website copy, or ad copy…' },
      FILE_UPLOAD_FIELD('competitor_files', 'Competitor Website Screenshots / Ads', '.pdf,.png,.jpg'),
      { id: 'your_positioning', label: 'Your Current Positioning', type: 'textarea', section: 'basic', required: false },
      CONTEXT_NOTES_FIELD,
    ],
    steps: [
      { id: 's1', order: 1, name: 'Messaging Analysis', agent: 'Competitor', tool: 'Claude', description: 'Analyze and categorize competitor messaging themes', inputRefs: ['competitor_messaging', 'competitor_files'], outputKey: 'messaging_analysis', estimatedSeconds: 15 },
      { id: 's2', order: 2, name: 'Gap Analysis', agent: 'Strategy', tool: 'Claude', description: 'Identify gaps, white space, and differentiation opportunities', inputRefs: ['messaging_analysis', 'your_positioning'], outputKey: 'gap_analysis', estimatedSeconds: 15 },
    ],
    outputs: [
      { key: 'messaging_analysis', label: 'Competitor Messaging Analysis', format: 'markdown' },
      { key: 'gap_analysis', label: 'Positioning Gap Analysis', format: 'markdown' },
    ],
  },

  {
    id: 'wf-024', slug: 'account-research-pack', name: 'Account Research Pack',
    cluster: 'Research', icon: '🏦', estimatedMinutes: 10,
    description: 'Deep research pack for a target account: overview, product gaps, and outreach angles.',
    agents: ['Research'], tools: ['Perplexity', 'Crunchbase'],
    tags: ['abm', 'research', 'account', 'intelligence'], version: '1.0',
    inputs: [
      { id: 'company_name', label: 'Company Name', type: 'text', section: 'basic', required: true },
      { id: 'company_website', label: 'Company Website', type: 'url', section: 'basic', required: false },
      FILE_UPLOAD_FIELD('company_report', 'Company Report / Annual Report', '.pdf'),
      { id: 'research_focus', label: 'Research Focus', type: 'multiselect', section: 'advanced', required: false, options: ['Technology Stack', 'Pain Points', 'Strategic Priorities', 'Key Contacts', 'Competitive Context'] },
      CONTEXT_NOTES_FIELD,
    ],
    steps: [
      { id: 's1', order: 1, name: 'Company Research', agent: 'Research', tool: 'Perplexity', description: 'Gather company overview, size, tech stack, news, leadership', inputRefs: ['company_name', 'company_website', 'research_focus'], outputKey: 'company_overview', estimatedSeconds: 20 },
      { id: 's2', order: 2, name: 'Account Research Pack', agent: 'Research', tool: 'Claude', description: 'Synthesize into actionable outreach brief with talking points', inputRefs: ['company_overview', 'company_report'], outputKey: 'account_pack', estimatedSeconds: 15 },
    ],
    outputs: [
      { key: 'company_overview', label: 'Company Overview', format: 'markdown' },
      { key: 'account_pack', label: 'Account Research Pack', format: 'markdown' },
    ],
  },

  // ── CLUSTER 6: ANALYTICS (3) ─────────────────────────────────────────────

  {
    id: 'wf-025', slug: 'campaign-performance-summary', name: 'Campaign Performance Summary',
    cluster: 'Analytics', icon: '📊', estimatedMinutes: 8,
    description: 'Pull campaign metrics and generate a performance summary with insights and recommendations.',
    agents: ['Analytics'], tools: ['HubSpot', 'LinkedIn Ads', 'Google Ads'],
    tags: ['analytics', 'performance', 'campaign', 'reporting'], version: '1.0',
    inputs: [
      { id: 'campaign_id', label: 'Campaign Name / ID', type: 'text', section: 'basic', required: true },
      { id: 'tools_to_query', label: 'Tools to Query', type: 'multiselect', section: 'basic', required: true, options: ['HubSpot', 'LinkedIn Ads', 'Google Ads', 'GA4', 'Salesforce'] },
      { id: 'date_range', label: 'Date Range', type: 'text', section: 'basic', required: true, placeholder: 'e.g., Jan 1 – Feb 28 2026' },
      FILE_UPLOAD_FIELD('metrics_export', 'Metrics Export (CSV)', '.csv,.xlsx'),
      CONTEXT_NOTES_FIELD,
    ],
    steps: [
      { id: 's1', order: 1, name: 'Data Collection', agent: 'Analytics', tool: 'HubSpot', description: 'Pull metrics from connected platforms', inputRefs: ['campaign_id', 'tools_to_query', 'date_range', 'metrics_export'], outputKey: 'raw_metrics', estimatedSeconds: 15 },
      { id: 's2', order: 2, name: 'Performance Summary', agent: 'Analytics', tool: 'Claude', description: 'Synthesize metrics into executive summary with trends', inputRefs: ['raw_metrics', 'campaign_id'], outputKey: 'performance_summary', estimatedSeconds: 15 },
      { id: 's3', order: 3, name: 'Recommendations', agent: 'Analytics', tool: 'Claude', description: 'Prioritized action items to improve performance', inputRefs: ['performance_summary'], outputKey: 'recommendations', estimatedSeconds: 10 },
    ],
    outputs: [
      { key: 'raw_metrics', label: 'Raw Metrics', format: 'markdown' },
      { key: 'performance_summary', label: 'Performance Summary', format: 'markdown' },
      { key: 'recommendations', label: 'Optimization Recommendations', format: 'markdown' },
    ],
  },

  {
    id: 'wf-026', slug: 'funnel-dropoff-diagnosis', name: 'Funnel Drop-Off Diagnosis',
    cluster: 'Analytics', icon: '🔬', estimatedMinutes: 8,
    description: 'Analyze funnel stage metrics to identify drop-off causes and optimization opportunities.',
    agents: ['Analytics'], tools: ['GA4', 'HubSpot'],
    tags: ['funnel', 'analytics', 'conversion', 'optimization'], version: '1.0',
    inputs: [
      { id: 'funnel_metrics', label: 'Funnel Stage Metrics', type: 'textarea', section: 'basic', required: false, placeholder: 'Paste conversion rates or stage counts' },
      FILE_UPLOAD_FIELD('metrics_csv', 'Funnel Metrics CSV', '.csv,.xlsx'),
      { id: 'funnel_stages', label: 'Funnel Stages', type: 'tags', section: 'basic', required: true, placeholder: 'e.g., Awareness, Lead, MQL, SQL, Opportunity, Won' },
      CONTEXT_NOTES_FIELD,
    ],
    steps: [
      { id: 's1', order: 1, name: 'Drop-Off Analysis', agent: 'Analytics', tool: 'Claude', description: 'Calculate stage drop-off rates and identify bottlenecks', inputRefs: ['funnel_metrics', 'metrics_csv', 'funnel_stages'], outputKey: 'dropoff_analysis', estimatedSeconds: 15 },
      { id: 's2', order: 2, name: 'Root Cause & Recommendations', agent: 'Analytics', tool: 'Claude', description: 'Root cause hypotheses + optimization experiments', inputRefs: ['dropoff_analysis'], outputKey: 'optimization_ideas', estimatedSeconds: 15 },
    ],
    outputs: [
      { key: 'dropoff_analysis', label: 'Funnel Drop-Off Analysis', format: 'markdown' },
      { key: 'optimization_ideas', label: 'Optimization Recommendations', format: 'markdown' },
    ],
  },

  {
    id: 'wf-027', slug: 'channel-performance-comparison', name: 'Channel Performance Comparison',
    cluster: 'Analytics', icon: '📉', estimatedMinutes: 8,
    description: 'Compare marketing channel performance and generate budget allocation recommendations.',
    agents: ['Analytics'], tools: ['GA4', 'LinkedIn Ads', 'Google Ads', 'HubSpot'],
    tags: ['analytics', 'channels', 'budget', 'comparison'], version: '1.0',
    inputs: [
      { id: 'channels', label: 'Channels to Compare', type: 'multiselect', section: 'basic', required: true, options: ['LinkedIn Ads', 'Google Ads', 'Email', 'Events', 'Organic Social', 'Content / SEO'] },
      { id: 'kpis', label: 'KPIs to Compare', type: 'multiselect', section: 'basic', required: true, options: ['Impressions', 'CTR', 'Leads', 'MQLs', 'CPL', 'ROAS', 'Pipeline'] },
      FILE_UPLOAD_FIELD('channel_data', 'Channel Data Export', '.csv,.xlsx'),
      CONTEXT_NOTES_FIELD,
    ],
    steps: [
      { id: 's1', order: 1, name: 'Channel Analysis', agent: 'Analytics', tool: 'Claude', description: 'Compare KPIs across channels with benchmarks', inputRefs: ['channels', 'kpis', 'channel_data'], outputKey: 'channel_comparison', estimatedSeconds: 18 },
      { id: 's2', order: 2, name: 'Budget Recommendations', agent: 'Analytics', tool: 'Claude', description: 'Recommended budget shifts and rationale', inputRefs: ['channel_comparison'], outputKey: 'budget_recommendations', estimatedSeconds: 12 },
    ],
    outputs: [
      { key: 'channel_comparison', label: 'Channel Performance Comparison', format: 'markdown' },
      { key: 'budget_recommendations', label: 'Budget Allocation Recommendations', format: 'markdown' },
    ],
  },

  // ── CLUSTER 7: SALES ENABLEMENT (3) ─────────────────────────────────────

  {
    id: 'wf-028', slug: 'one-pager-generator', name: 'One-Pager Generator',
    cluster: 'Sales', icon: '📋', estimatedMinutes: 8,
    description: 'Generate a sales one-pager with messaging, benefits, proof points, and CTA for any product.',
    agents: ['Strategy', 'Copy'], tools: [],
    tags: ['sales', 'collateral', 'one-pager', 'enablement'], version: '1.0',
    inputs: [
      { id: 'product', label: 'Product / Solution', type: 'text', section: 'basic', required: true },
      { id: 'audience', label: 'Target Audience', type: 'text', section: 'basic', required: true },
      { id: 'key_benefits', label: 'Key Benefits', type: 'tags', section: 'basic', required: true },
      { id: 'proof_points', label: 'Proof Points / Stats', type: 'textarea', section: 'advanced', required: false },
      { id: 'cta', label: 'CTA', type: 'text', section: 'basic', required: false, placeholder: 'e.g., Book a Demo' },
      FILE_UPLOAD_FIELD('product_docs', 'Product Deck / Brief', '.pdf,.ppt,.pptx'),
      CONTEXT_NOTES_FIELD,
    ],
    steps: [
      { id: 's1', order: 1, name: 'Messaging Framework', agent: 'Strategy', tool: 'Claude', description: 'Define headline, value prop, and key differentiators', inputRefs: ['product', 'audience', 'key_benefits', 'proof_points'], outputKey: 'messaging', estimatedSeconds: 12 },
      { id: 's2', order: 2, name: 'One-Pager Copy', agent: 'Copy', tool: 'Claude', description: 'Full one-pager copy with all sections', inputRefs: ['messaging', 'cta', 'proof_points'], outputKey: 'one_pager_copy', requiresApproval: true, estimatedSeconds: 18 },
    ],
    outputs: [
      { key: 'messaging', label: 'Messaging Framework', format: 'markdown' },
      { key: 'one_pager_copy', label: 'One-Pager Copy', format: 'markdown' },
    ],
  },

  {
    id: 'wf-029', slug: 'battlecard-generator', name: 'Battlecard Generator',
    cluster: 'Sales', icon: '⚔️', estimatedMinutes: 10,
    description: 'Create a competitive battlecard with strengths, weaknesses, objection handlers, and win themes.',
    agents: ['Research', 'Competitor', 'Strategy'], tools: ['Perplexity'],
    tags: ['sales', 'competitive', 'battlecard', 'objections'], version: '1.0',
    inputs: [
      { id: 'competitor', label: 'Competitor Name', type: 'text', section: 'basic', required: true },
      { id: 'your_strengths', label: 'Your Strengths vs. Competitor', type: 'tags', section: 'basic', required: false },
      { id: 'known_weaknesses', label: 'Known Competitor Weaknesses', type: 'textarea', section: 'advanced', required: false },
      FILE_UPLOAD_FIELD('competitor_info', 'Competitor Product Info', '.pdf,.doc,.docx,.png,.jpg'),
      CONTEXT_NOTES_FIELD,
    ],
    steps: [
      { id: 's1', order: 1, name: 'Competitor Research', agent: 'Research', tool: 'Perplexity', description: 'Gather latest info on competitor product and positioning', inputRefs: ['competitor', 'competitor_info'], outputKey: 'competitor_research', estimatedSeconds: 18 },
      { id: 's2', order: 2, name: 'Battlecard', agent: 'Strategy', tool: 'Claude', description: 'Build complete battlecard with win/lose themes and objection handlers', inputRefs: ['competitor_research', 'your_strengths', 'known_weaknesses'], outputKey: 'battlecard', estimatedSeconds: 20 },
    ],
    outputs: [
      { key: 'competitor_research', label: 'Competitor Research', format: 'markdown' },
      { key: 'battlecard', label: 'Sales Battlecard', format: 'markdown' },
    ],
  },

  {
    id: 'wf-030', slug: 'meeting-brief-generator', name: 'Meeting Brief Generator',
    cluster: 'Sales', icon: '📁', estimatedMinutes: 8,
    description: 'Pre-meeting research pack: company overview, stakeholder map, key talking points, and agenda.',
    agents: ['Research'], tools: ['Perplexity'],
    tags: ['sales', 'meeting', 'prep', 'research'], version: '1.0',
    inputs: [
      { id: 'company_name', label: 'Company Name', type: 'text', section: 'basic', required: true },
      { id: 'meeting_purpose', label: 'Meeting Purpose', type: 'text', section: 'basic', required: true, placeholder: 'e.g., Discovery call, executive presentation' },
      { id: 'attendees', label: 'Known Attendees', type: 'tags', section: 'basic', required: false },
      FILE_UPLOAD_FIELD('account_notes', 'Account Notes / Previous Correspondence', '.pdf,.doc,.docx'),
      { id: 'product_context', label: 'Product / Solution Context', type: 'text', section: 'advanced', required: false },
      CONTEXT_NOTES_FIELD,
    ],
    steps: [
      { id: 's1', order: 1, name: 'Company & Stakeholder Research', agent: 'Research', tool: 'Perplexity', description: 'Research company, industry, leadership, and recent news', inputRefs: ['company_name', 'attendees'], outputKey: 'company_research', estimatedSeconds: 18 },
      { id: 's2', order: 2, name: 'Meeting Brief', agent: 'Research', tool: 'Claude', description: 'Structured brief with agenda, talking points, discovery questions', inputRefs: ['company_research', 'meeting_purpose', 'account_notes', 'product_context'], outputKey: 'meeting_brief', estimatedSeconds: 15 },
    ],
    outputs: [
      { key: 'company_research', label: 'Company & Stakeholder Research', format: 'markdown' },
      { key: 'meeting_brief', label: 'Meeting Preparation Brief', format: 'markdown' },
    ],
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export const WORKFLOW_CLUSTERS: Record<WorkflowCluster, { label: string; icon: string; color: string; description: string }> = {
  Campaign:  { label: 'Campaign Orchestration', icon: '📡', color: 'blue',   description: 'Demand gen, ABM, paid media, nurture' },
  Content:   { label: 'Content Production',     icon: '✍️', color: 'emerald', description: 'Blogs, newsletters, case studies, rewrites' },
  Creative:  { label: 'Creative Studio',         icon: '🎨', color: 'pink',   description: 'Ads, banners, standees, ebook covers' },
  Event:     { label: 'Event Marketing',         icon: '🎪', color: 'orange', description: 'Promo kits, booth messaging, follow-ups' },
  Research:  { label: 'Research & Intelligence', icon: '🔍', color: 'violet', description: 'Competitive intel, trends, account research' },
  Analytics: { label: 'Marketing Analytics',     icon: '📊', color: 'amber',  description: 'Performance, funnel, channel comparison' },
  Sales:     { label: 'Sales Enablement',        icon: '⚔️', color: 'slate',  description: 'One-pagers, battlecards, meeting briefs' },
};

for (const workflow of MARKETING_WORKFLOWS) {
  workflow.inputs = MARKETING_INPUT_FIELDS[workflow.id]!.map(field => {
    const display = workflow.inputs.find(input => input.id === field.id);
    return { ...display, ...field, label: display?.label ?? field.label, section: display?.section ?? field.section, required: field.required === true, options: field.options as string[] | undefined, type: field.type === 'toggle' ? 'checkbox' : field.type };
  });
}

export function getWorkflowsByCluster(): Record<WorkflowCluster, WorkflowDef[]> {
  const grouped = {} as Record<WorkflowCluster, WorkflowDef[]>;
  for (const cluster of Object.keys(WORKFLOW_CLUSTERS) as WorkflowCluster[]) {
    grouped[cluster] = MARKETING_WORKFLOWS.filter(w => w.cluster === cluster);
  }
  return grouped;
}

export function getWorkflowById(id: string): WorkflowDef | undefined {
  return MARKETING_WORKFLOWS.find(w => w.id === id || w.slug === id);
}
