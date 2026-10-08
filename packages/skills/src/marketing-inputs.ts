import type { UnifiedInputField } from './schema.js';

type Field = [string, UnifiedInputField['type'], boolean, string[]?];
const notes: Field = ['context_notes', 'textarea', false];
const fields: Record<string, Field[]> = {
  'wf-001': [['webinar_title', 'text', true], ['description', 'textarea', true], ['date', 'date', true], ['speakers', 'tags', true], ['audience', 'text', true], ['cta', 'text', true], ['channels', 'multiselect', false, ['Email', 'LinkedIn Ads', 'Social Posts', 'Landing Page']], ['webinar_brief', 'file', false], ['tools', 'multiselect', false, ['HubSpot', 'LinkedIn Ads', 'Google Drive']], notes],
  'wf-002': [['product_name', 'text', true], ['feature_description', 'textarea', true], ['audience', 'text', true], ['launch_date', 'date', true], ['core_benefit', 'text', true], ['cta', 'text', false], ['differentiators', 'tags', false], ['product_docs', 'file', false], ['tools', 'multiselect', false, ['HubSpot', 'WordPress']], notes],
  'wf-003': [['account_list', 'tags', true], ['target_personas', 'tags', true], ['value_prop', 'textarea', true], ['offer', 'text', false], ['event_context', 'text', false], ['account_notes', 'file', false], ['tools', 'multiselect', false, ['Salesforce', 'HubSpot']], notes],
  'wf-004': [['campaign_goal', 'select', true, ['Lead Generation', 'Brand Awareness', 'Event Registration', 'Product Trial', 'Pipeline Acceleration']], ['audience', 'text', true], ['budget', 'text', false], ['channels', 'multiselect', true, ['LinkedIn Ads', 'Google Ads', 'Meta Ads', 'Display']], ['key_message', 'text', true], ['offer', 'text', true], ['image_theme', 'text', false], notes],
  'wf-005': [['objective', 'text', true], ['audience', 'text', true], ['channels', 'multiselect', true, ['LinkedIn', 'Google Ads', 'Email', 'Events', 'Blog', 'Social', 'PR']], ['timeline', 'text', false], ['budget', 'text', false], ['campaign_brief', 'file', false], notes],
  'wf-006': [['audience', 'text', true], ['funnel_stage', 'select', true, ['Awareness', 'Consideration', 'Decision', 'Post-Purchase']], ['offer', 'text', true], ['num_emails', 'select', true, ['5', '6', '7']], ['tone', 'select', false, ['Professional', 'Conversational', 'Executive', 'Technical']], ['tools', 'multiselect', false, ['HubSpot', 'Salesforce', 'Mailchimp']], notes],
  'wf-007': [['blog_title', 'text', true], ['audience', 'text', true], ['key_points', 'textarea', true], ['primary_keyword', 'text', false], ['secondary_keywords', 'tags', false], ['word_count', 'select', false, ['600–800', '800–1200', '1200–1800', '1800+']], ['brief_file', 'file', false], notes],
  'wf-008': [['whitepaper', 'file', false], ['audience', 'text', true], ['blog_length', 'select', false, ['Short (600–800w)', 'Medium (800–1200w)', 'Long (1200–1800w)']], ['focus_section', 'text', false], notes],
  'wf-009': [['source_content', 'file', false], ['num_articles', 'select', true, ['4', '5', '6']], ['audience', 'text', true], notes],
  'wf-010': [['client_name', 'text', true], ['industry', 'text', true], ['problem', 'textarea', true], ['solution', 'textarea', true], ['results', 'textarea', true], ['interview_notes', 'file', false], notes],
  'wf-011': [['newsletter_title', 'text', true], ['audience', 'text', true], ['article_links', 'textarea', false], ['articles', 'file', false], ['commentary_tone', 'select', false, ['Expert insight', 'Conversational', 'Neutral summary', 'Opinionated']], notes],
  'wf-012': [['draft_text', 'textarea', true], ['tone', 'multiselect', true, ['Executive', 'Thought Leadership', 'Conversational', 'Formal', 'LinkedIn Post']], ['preserve_points', 'text', false], notes],
  'wf-013': [['campaign_message', 'text', true], ['audience', 'text', true], ['format', 'multiselect', true, ['Single Image', 'Carousel', 'Video (script)', 'Document Ad']], ['visual_theme', 'text', false], ['brand_assets', 'file', false], notes],
  'wf-014': [['event_name', 'text', true], ['audience', 'text', true], ['product_focus', 'text', true], ['theme', 'text', false], ['brand_voice', 'select', false, ['Bold', 'Professional', 'Friendly', 'Technical']], notes],
  'wf-015': [['product_message', 'text', true], ['audience', 'text', true], ['sizes', 'multiselect', true, ['300×250', '728×90', '160×600', '1080×1080', '1200×628']], ['cta', 'text', false], notes],
  'wf-016': [['title', 'text', true], ['subtitle', 'text', false], ['theme', 'text', true], ['style', 'multiselect', true, ['Modern', 'Corporate', 'Minimal', 'Bold', 'Illustrative']], notes],
  'wf-017': [['event_name', 'text', true], ['event_date', 'date', true], ['speakers', 'tags', false], ['audience', 'text', true], ['key_message', 'text', true], ['cta', 'text', true], ['tools', 'multiselect', false, ['HubSpot', 'LinkedIn Ads']], notes],
  'wf-018': [['event', 'text', true], ['product_focus', 'text', true], ['headline_theme', 'text', false], ['audience', 'text', true], notes],
  'wf-019': [['event', 'text', true], ['meeting_purpose', 'text', true], ['account_list', 'file', false], ['value_prop', 'textarea', true], ['tools', 'multiselect', false, ['Salesforce', 'HubSpot']], notes],
  'wf-020': [['event_name', 'text', true], ['event_summary', 'textarea', true], ['lead_list', 'file', false], ['next_step', 'text', true], notes],
  'wf-021': [['competitor_list', 'tags', true], ['market_segment', 'text', false], ['focus_areas', 'multiselect', false, ['Product Updates', 'Marketing / Messaging', 'Funding / M&A', 'Partnerships', 'Talent', 'Pricing']], notes],
  'wf-022': [['topic', 'text', true], ['time_range', 'select', false, ['Last week', 'Last month', 'Last quarter']], ['source_urls', 'textarea', false], notes],
  'wf-023': [['competitor_messaging', 'textarea', false], ['competitor_files', 'file', false], ['your_positioning', 'textarea', false], notes],
  'wf-024': [['company_name', 'text', true], ['company_website', 'url', false], ['company_report', 'file', false], ['research_focus', 'multiselect', false, ['Technology Stack', 'Pain Points', 'Strategic Priorities', 'Key Contacts', 'Competitive Context']], notes],
  'wf-025': [['campaign_id', 'text', true], ['tools_to_query', 'multiselect', true, ['HubSpot', 'LinkedIn Ads', 'Google Ads', 'GA4', 'Salesforce']], ['date_range', 'text', true], ['metrics_export', 'file', false], notes],
  'wf-026': [['funnel_metrics', 'textarea', false], ['metrics_csv', 'file', false], ['funnel_stages', 'tags', true], notes],
  'wf-027': [['channels', 'multiselect', true, ['LinkedIn Ads', 'Google Ads', 'Email', 'Events', 'Organic Social', 'Content / SEO']], ['kpis', 'multiselect', true, ['Impressions', 'CTR', 'Leads', 'MQLs', 'CPL', 'ROAS', 'Pipeline']], ['channel_data', 'file', false], notes],
  'wf-028': [['product', 'text', true], ['audience', 'text', true], ['key_benefits', 'tags', true], ['proof_points', 'textarea', false], ['cta', 'text', false], ['product_docs', 'file', false], notes],
  'wf-029': [['competitor', 'text', true], ['your_strengths', 'tags', false], ['known_weaknesses', 'textarea', false], ['competitor_info', 'file', false], notes],
  'wf-030': [['company_name', 'text', true], ['meeting_purpose', 'text', true], ['attendees', 'tags', false], ['account_notes', 'file', false], ['product_context', 'text', false], notes],
};

export const MARKETING_INPUT_FIELDS: Record<string, UnifiedInputField[]> = Object.fromEntries(Object.entries(fields).map(([id, specs]) => [id, specs.map(([key, type, required, options]) => ({ id: key, label: key.replace(/_/g, ' '), type, required, options, section: required ? 'basic' as const : 'advanced' as const }))]));
