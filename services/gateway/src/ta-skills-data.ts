/**
 * Talent Acquisition Persona — Skill Catalog
 * 8 skills for recruiting, sourcing, screening, interviews, and offers.
 * @author Phani Marupaka <https://linkedin.com/in/phani-marupaka>
 * @copyright © 2026 Phani Marupaka. All rights reserved.
 */

// Shared schema keeps catalog validation aligned across personas
import type { UnifiedSkillDef as TASkillDef } from '@agentos/skills/schema';

export const TA_SKILLS: TASkillDef[] = [
  {
    id: 'ta-001', slug: 'jd-generator', name: 'Job Description Generator',
    description: 'Generate a comprehensive, inclusive job description from a hiring brief. Includes responsibilities, requirements, compensation range, and DEI-optimized language.',
    icon: '📄', persona: 'ta', executableType: 'skill', cluster: 'Requisition', complexity: 'moderate', estimatedTime: '30–60s',
    inputs: [
      { id: 'role_title', label: 'Role Title', type: 'text', required: true, placeholder: 'e.g. Senior Backend Engineer', section: 'basic' },
      { id: 'department', label: 'Department', type: 'select', required: true, options: ['Engineering', 'Product', 'Marketing', 'HR', 'Finance', 'Sales', 'Design', 'Data'], section: 'basic' },
      { id: 'level', label: 'Seniority Level', type: 'select', required: true, options: ['Junior', 'Mid', 'Senior', 'Staff', 'Principal', 'Director', 'VP'], section: 'basic' },
      { id: 'hiring_brief', label: 'Hiring Brief', type: 'textarea', required: true, placeholder: 'Describe what this person will do, key projects, team context...', section: 'basic' },
      { id: 'location', label: 'Location', type: 'select', options: ['Remote', 'Hybrid', 'On-site'], section: 'basic' },
      { id: 'comp_range', label: 'Compensation Range', type: 'text', placeholder: '$150K–$200K', section: 'advanced' },
      { id: 'must_haves', label: 'Must-Have Skills', type: 'textarea', placeholder: 'List non-negotiable requirements', section: 'advanced' },
      { id: 'nice_to_haves', label: 'Nice-to-Have Skills', type: 'textarea', placeholder: 'List preferred but optional skills', section: 'advanced' },
    ],
    steps: [
      { id: 'ta-001-s1', order: 1, name: 'Analyze Hiring Brief & Market Context', agent: 'JD Specialist', tool: 'Claude', outputKey: 'brief_analysis' },
      { id: 'ta-001-s2', order: 2, name: 'Generate Role Responsibilities', agent: 'JD Specialist', tool: 'Claude', outputKey: 'responsibilities' },
      { id: 'ta-001-s3', order: 3, name: 'Define Requirements & Qualifications', agent: 'JD Specialist', tool: 'Claude', outputKey: 'requirements' },
      { id: 'ta-001-s4', order: 4, name: 'DEI Language Optimization', agent: 'Inclusion Reviewer', tool: 'Claude', outputKey: 'dei_review' },
      { id: 'ta-001-s5', order: 5, name: 'Compile Final JD', agent: 'JD Specialist', tool: 'Claude', outputKey: 'final_jd', requiresApproval: true },
    ],
    outputs: ['brief_analysis', 'responsibilities', 'requirements', 'dei_review', 'final_jd'],
    requiredTools: ['Claude'], optionalTools: ['Confluence', 'Google Drive'],
    tags: ['jd', 'hiring', 'requisition', 'dei'],
  },
  {
    id: 'ta-002', slug: 'hiring-scorecard', name: 'Hiring Scorecard Builder',
    description: 'Create a structured interview scorecard with competencies, behavioral indicators, and rating rubrics aligned to the role requirements.',
    icon: '📊', persona: 'ta', executableType: 'skill', cluster: 'Requisition', complexity: 'moderate', estimatedTime: '30–45s',
    inputs: [
      { id: 'role_title', label: 'Role Title', type: 'text', required: true, section: 'basic' },
      { id: 'jd_text', label: 'Job Description', type: 'textarea', required: true, placeholder: 'Paste the JD or reference a previous JD generation', section: 'basic' },
      { id: 'interview_rounds', label: 'Interview Rounds', type: 'select', required: true, options: ['2', '3', '4', '5'], section: 'basic' },
      { id: 'competency_focus', label: 'Competency Focus', type: 'multiselect', options: ['Technical', 'Leadership', 'Communication', 'Problem Solving', 'Culture Fit', 'Domain Expertise'], section: 'basic' },
    ],
    steps: [
      { id: 'ta-002-s1', order: 1, name: 'Extract Key Competencies from JD', agent: 'Scorecard Analyst', tool: 'Claude', outputKey: 'competencies' },
      { id: 'ta-002-s2', order: 2, name: 'Generate Behavioral Indicators', agent: 'Scorecard Analyst', tool: 'Claude', outputKey: 'behavioral_indicators' },
      { id: 'ta-002-s3', order: 3, name: 'Build Rating Rubrics', agent: 'Scorecard Analyst', tool: 'Claude', outputKey: 'rubrics' },
      { id: 'ta-002-s4', order: 4, name: 'Map to Interview Rounds', agent: 'Panel Designer', tool: 'Claude', outputKey: 'panel_plan', requiresApproval: true },
    ],
    outputs: ['competencies', 'behavioral_indicators', 'rubrics', 'panel_plan'],
    requiredTools: ['Claude'], optionalTools: [],
    tags: ['scorecard', 'interview', 'competency', 'rubric'],
  },
  {
    id: 'ta-003', slug: 'resume-screener', name: 'Resume Screening & Ranking',
    description: 'Score and rank candidate resumes against must-have and nice-to-have requirements. Identify red flags and recommend shortlist.',
    icon: '📑', persona: 'ta', executableType: 'skill', cluster: 'Screening', complexity: 'moderate', estimatedTime: '45–90s',
    inputs: [
      { id: 'role_title', label: 'Role Title', type: 'text', required: true, section: 'basic' },
      { id: 'must_haves', label: 'Must-Have Requirements', type: 'textarea', required: true, section: 'basic' },
      { id: 'nice_to_haves', label: 'Nice-to-Haves', type: 'textarea', section: 'basic' },
      { id: 'resumes', label: 'Upload Resumes', type: 'file', required: true, multiple: true, accept: '.pdf,.docx,.txt', section: 'basic' },
      { id: 'max_shortlist', label: 'Max Shortlist Size', type: 'select', options: ['3', '5', '8', '10'], section: 'advanced' },
    ],
    steps: [
      { id: 'ta-003-s1', order: 1, name: 'Parse & Extract Resume Data', agent: 'Resume Parser', tool: 'Claude', outputKey: 'parsed_resumes' },
      { id: 'ta-003-s2', order: 2, name: 'Score Against Must-Haves', agent: 'Candidate Matcher', tool: 'Claude', outputKey: 'must_have_scores' },
      { id: 'ta-003-s3', order: 3, name: 'Score Against Nice-to-Haves', agent: 'Candidate Matcher', tool: 'Claude', outputKey: 'nice_to_have_scores' },
      { id: 'ta-003-s4', order: 4, name: 'Red Flag Detection', agent: 'Bias Checker', tool: 'Claude', outputKey: 'red_flags' },
      { id: 'ta-003-s5', order: 5, name: 'Generate Ranked Shortlist', agent: 'Candidate Matcher', tool: 'Claude', outputKey: 'shortlist', requiresApproval: true },
    ],
    outputs: ['parsed_resumes', 'must_have_scores', 'nice_to_have_scores', 'red_flags', 'shortlist'],
    requiredTools: ['Claude'], optionalTools: ['LinkedIn'],
    tags: ['resume', 'screening', 'ranking', 'shortlist'],
  },
  {
    id: 'ta-004', slug: 'outreach-generator', name: 'Candidate Outreach Generator',
    description: 'Generate personalized recruiter outreach messages for sourced candidates. Multi-channel (email, LinkedIn, InMail) with A/B variants.',
    icon: '✉️', persona: 'ta', executableType: 'skill', cluster: 'Sourcing', complexity: 'simple', estimatedTime: '15–30s',
    inputs: [
      { id: 'role_title', label: 'Role Title', type: 'text', required: true, section: 'basic' },
      { id: 'company_name', label: 'Company Name', type: 'text', required: true, section: 'basic' },
      { id: 'candidate_profile', label: 'Candidate Profile', type: 'textarea', required: true, placeholder: 'Paste LinkedIn profile summary or candidate notes', section: 'basic' },
      { id: 'channel', label: 'Channel', type: 'select', required: true, options: ['Email', 'LinkedIn InMail', 'LinkedIn Connection Note'], section: 'basic' },
      { id: 'tone', label: 'Tone', type: 'select', options: ['Professional', 'Casual', 'Technical', 'Executive'], section: 'advanced' },
    ],
    steps: [
      { id: 'ta-004-s1', order: 1, name: 'Analyze Candidate Profile', agent: 'Outreach Specialist', tool: 'Claude', outputKey: 'candidate_analysis' },
      { id: 'ta-004-s2', order: 2, name: 'Generate Personalized Outreach', agent: 'Outreach Specialist', tool: 'Claude', outputKey: 'outreach_draft' },
      { id: 'ta-004-s3', order: 3, name: 'Create A/B Variant', agent: 'Outreach Specialist', tool: 'Claude', outputKey: 'ab_variant' },
    ],
    outputs: ['candidate_analysis', 'outreach_draft', 'ab_variant'],
    requiredTools: ['Claude'], optionalTools: ['LinkedIn'],
    tags: ['outreach', 'sourcing', 'email', 'linkedin'],
  },
  {
    id: 'ta-005', slug: 'interview-kit', name: 'Interview Kit Generator',
    description: 'Generate a structured interview kit with questions, evaluation criteria, and interviewer guide for each round.',
    icon: '🎤', persona: 'ta', executableType: 'skill', cluster: 'Interview', complexity: 'moderate', estimatedTime: '30–60s',
    inputs: [
      { id: 'role_title', label: 'Role Title', type: 'text', required: true, section: 'basic' },
      { id: 'round', label: 'Interview Round', type: 'select', required: true, options: ['Phone Screen', 'Technical', 'System Design', 'Behavioral', 'Hiring Manager', 'Bar Raiser'], section: 'basic' },
      { id: 'competencies', label: 'Target Competencies', type: 'textarea', required: true, placeholder: 'List competencies to evaluate in this round', section: 'basic' },
      { id: 'duration_min', label: 'Duration (minutes)', type: 'select', options: ['30', '45', '60', '90'], section: 'basic' },
    ],
    steps: [
      { id: 'ta-005-s1', order: 1, name: 'Design Question Set', agent: 'Interview Designer', tool: 'Claude', outputKey: 'questions' },
      { id: 'ta-005-s2', order: 2, name: 'Create Evaluation Rubric', agent: 'Interview Designer', tool: 'Claude', outputKey: 'rubric' },
      { id: 'ta-005-s3', order: 3, name: 'Generate Interviewer Guide', agent: 'Interview Designer', tool: 'Claude', outputKey: 'interviewer_guide' },
    ],
    outputs: ['questions', 'rubric', 'interviewer_guide'],
    requiredTools: ['Claude'], optionalTools: [],
    tags: ['interview', 'questions', 'rubric', 'guide'],
  },
  {
    id: 'ta-006', slug: 'interview-debrief', name: 'Interview Debrief Synthesizer',
    description: 'Synthesize interviewer feedback into a structured debrief with recommendation. Detects signal gaps and bias patterns.',
    icon: '📋', persona: 'ta', executableType: 'skill', cluster: 'Evaluation', complexity: 'complex', estimatedTime: '45–90s',
    inputs: [
      { id: 'candidate_name', label: 'Candidate Name', type: 'text', required: true, section: 'basic' },
      { id: 'role_title', label: 'Role Title', type: 'text', required: true, section: 'basic' },
      { id: 'interviewer_feedback', label: 'Interviewer Feedback', type: 'textarea', required: true, placeholder: 'Paste all interviewer feedback (separate by interviewer)', section: 'basic' },
      { id: 'scorecard_data', label: 'Scorecard Scores', type: 'textarea', placeholder: 'Paste scorecard ratings if available', section: 'advanced' },
    ],
    steps: [
      { id: 'ta-006-s1', order: 1, name: 'Parse & Structure Feedback', agent: 'Debrief Analyst', tool: 'Claude', outputKey: 'structured_feedback' },
      { id: 'ta-006-s2', order: 2, name: 'Detect Signal Gaps & Conflicts', agent: 'Debrief Analyst', tool: 'Claude', outputKey: 'signal_analysis' },
      { id: 'ta-006-s3', order: 3, name: 'Bias Pattern Check', agent: 'Bias Checker', tool: 'Claude', outputKey: 'bias_check' },
      { id: 'ta-006-s4', order: 4, name: 'Generate Recommendation Memo', agent: 'Debrief Analyst', tool: 'Claude', outputKey: 'recommendation', requiresApproval: true },
    ],
    outputs: ['structured_feedback', 'signal_analysis', 'bias_check', 'recommendation'],
    requiredTools: ['Claude'], optionalTools: [],
    tags: ['debrief', 'feedback', 'bias', 'recommendation'],
  },
  {
    id: 'ta-007', slug: 'candidate-comparison', name: 'Candidate Comparison Pack',
    description: 'Generate a side-by-side comparison of shortlisted candidates with strengths, weaknesses, and hiring recommendation.',
    icon: '⚖️', persona: 'ta', executableType: 'skill', cluster: 'Evaluation', complexity: 'moderate', estimatedTime: '30–60s',
    inputs: [
      { id: 'role_title', label: 'Role Title', type: 'text', required: true, section: 'basic' },
      { id: 'candidates', label: 'Candidate Profiles & Feedback', type: 'textarea', required: true, placeholder: 'Paste candidate summaries and interview results', section: 'basic' },
      { id: 'evaluation_criteria', label: 'Evaluation Criteria', type: 'textarea', placeholder: 'Key criteria for comparison', section: 'advanced' },
    ],
    steps: [
      { id: 'ta-007-s1', order: 1, name: 'Parse Candidate Data', agent: 'Comparison Analyst', tool: 'Claude', outputKey: 'parsed_candidates' },
      { id: 'ta-007-s2', order: 2, name: 'Generate Comparison Matrix', agent: 'Comparison Analyst', tool: 'Claude', outputKey: 'comparison_matrix' },
      { id: 'ta-007-s3', order: 3, name: 'Draft Hiring Recommendation', agent: 'Comparison Analyst', tool: 'Claude', outputKey: 'recommendation', requiresApproval: true },
    ],
    outputs: ['parsed_candidates', 'comparison_matrix', 'recommendation'],
    requiredTools: ['Claude'], optionalTools: [],
    tags: ['comparison', 'evaluation', 'hiring-decision'],
  },
  {
    id: 'ta-008', slug: 'talent-market-analysis', name: 'Talent Market Analysis',
    description: 'Analyze the talent market for a specific role — availability, salary benchmarks, competitive landscape, and sourcing strategy recommendations.',
    icon: '📈', persona: 'ta', executableType: 'skill', cluster: 'Intelligence', complexity: 'complex', estimatedTime: '60–120s',
    inputs: [
      { id: 'role_title', label: 'Role Title', type: 'text', required: true, section: 'basic' },
      { id: 'location', label: 'Location/Market', type: 'text', required: true, placeholder: 'e.g. US Remote, Bay Area, London', section: 'basic' },
      { id: 'key_skills', label: 'Key Skills', type: 'textarea', required: true, placeholder: 'List the technical/domain skills needed', section: 'basic' },
      { id: 'competitors', label: 'Key Competitors', type: 'textarea', placeholder: 'Companies competing for same talent', section: 'advanced' },
    ],
    steps: [
      { id: 'ta-008-s1', order: 1, name: 'Analyze Talent Supply', agent: 'Market Analyst', tool: 'Claude', outputKey: 'supply_analysis' },
      { id: 'ta-008-s2', order: 2, name: 'Benchmark Compensation', agent: 'Market Analyst', tool: 'Claude', outputKey: 'comp_benchmark' },
      { id: 'ta-008-s3', order: 3, name: 'Competitive Landscape', agent: 'Market Analyst', tool: 'Claude', outputKey: 'competitive_landscape' },
      { id: 'ta-008-s4', order: 4, name: 'Sourcing Strategy Recommendation', agent: 'Market Analyst', tool: 'Claude', outputKey: 'sourcing_strategy' },
    ],
    outputs: ['supply_analysis', 'comp_benchmark', 'competitive_landscape', 'sourcing_strategy'],
    requiredTools: ['Claude'], optionalTools: ['LinkedIn'],
    tags: ['market-analysis', 'compensation', 'sourcing', 'intelligence'],
  },
];

export function getTASkill(idOrSlug: string): TASkillDef | undefined {
  return TA_SKILLS.find(s => s.id === idOrSlug || s.slug === idOrSlug);
}

export function getTASkillsByCluster(cluster?: string): TASkillDef[] {
  return cluster ? TA_SKILLS.filter(s => s.cluster === cluster) : TA_SKILLS;
}
