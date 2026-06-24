/**
 * Skill File System Loader — Load skills from /skills/<persona>/<slug>/SKILL.md.
 *
 * Parses YAML frontmatter + markdown body into runtime skill definitions.
 * Falls back silently when the folder doesn't exist so existing TS skill
 * literals continue to work.
 *
 * Folder layout:
 *   skills/engineering/pr-review-assistant/SKILL.md
 *   skills/engineering/pr-review-assistant/examples/good-review.md (optional)
 *   skills/engineering/pr-review-assistant/prompt.txt               (optional)
 *
 * Frontmatter schema (YAML between `---` delimiters):
 *   id: eng-001
 *   slug: pr-review-assistant
 *   name: PR Review Assistant
 *   description: ...
 *   icon: 🔍
 *   cluster: Code Quality
 *   complexity: moderate
 *   estimatedTime: 45–90s
 *   requiredTools: [Claude]
 *   optionalTools: [GitHub]
 *   tags: [code-review, pr]
 *   inputs:
 *     - id: repo
 *       label: Repository
 *       type: text
 *       required: true
 *       section: basic
 *   steps:
 *     - id: s1
 *       order: 1
 *       name: Fetch PR
 *       agent: Code Reviewer
 *       outputKey: pr_metadata
 *   outputs: [pr_metadata, review_summary]
 *
 * @author Phani Marupaka <https://linkedin.com/in/phani-marupaka>
 * @copyright © 2026 Phani Marupaka. All rights reserved.
 */

import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Locate the repo-root `skills/` directory regardless of the process working dir
 * (the gateway is launched from services/gateway/, so process.cwd() is wrong).
 * Resolution order: EAOS_SKILLS_DIR env → module-relative repo root → cwd/skills.
 */
function skillsBaseDir(): string {
    if (process.env.EAOS_SKILLS_DIR) return process.env.EAOS_SKILLS_DIR;
    try {
        // services/gateway/{src,dist}/skill-fs-loader → up 3 → repo root
        const repoSkills = resolve(dirname(fileURLToPath(import.meta.url)), '../../../skills');
        if (existsSync(repoSkills)) return repoSkills;
    } catch { /* fall through */ }
    return resolve(process.cwd(), 'skills');
}

// ═══════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════

export interface FSSkillDef {
    id: string;
    slug: string;
    name: string;
    description: string;
    icon?: string;
    persona: string;
    cluster?: string;
    complexity?: 'simple' | 'moderate' | 'complex';
    estimatedTime?: string;
    inputs?: unknown[];
    steps?: unknown[];
    outputs?: string[];
    requiredTools?: string[];
    optionalTools?: string[];
    tags?: string[];
    systemPrompt?: string;     // from markdown body
    sourcePath?: string;       // absolute path to SKILL.md
    supportingFiles?: string[]; // relative paths
    extends?: string;          // parent skill id
    adopted?: boolean;         // true when imported from an external SKILL.md (no native id/slug)
    attribution?: string;      // upstream source label (e.g. "gstack (MIT)")
}

export interface FSLoadResult {
    skills: FSSkillDef[];
    errors: Array<{ path: string; error: string }>;
}

// ═══════════════════════════════════════════════════════════════
// YAML Parser (minimal, sufficient for our frontmatter shape)
// ═══════════════════════════════════════════════════════════════

/**
 * Parse a small subset of YAML:
 *   - scalars (strings, numbers, booleans)
 *   - flow sequences: `[a, b, c]`
 *   - block sequences with dashes
 *   - nested maps via indentation
 *
 * Not a full YAML parser — suitable for SKILL.md frontmatter.
 */
function parseYaml(text: string): Record<string, unknown> {
    const lines = text.split('\n');
    const result: Record<string, unknown> = {};
    let i = 0;

    const parseScalar = (s: string): unknown => {
        const trimmed = s.trim();
        if (trimmed === '') return '';
        if (trimmed === 'true') return true;
        if (trimmed === 'false') return false;
        if (trimmed === 'null' || trimmed === '~') return null;
        if (/^-?\d+$/.test(trimmed)) return parseInt(trimmed, 10);
        if (/^-?\d+\.\d+$/.test(trimmed)) return parseFloat(trimmed);
        // Flow sequence: [a, b, c]
        if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
            const inner = trimmed.slice(1, -1);
            if (!inner.trim()) return [];
            return inner.split(',').map(s => parseScalar(s.trim()));
        }
        // Strip surrounding quotes
        if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
            return trimmed.slice(1, -1);
        }
        return trimmed;
    };

    const getIndent = (line: string): number => {
        let n = 0;
        while (n < line.length && line[n] === ' ') n++;
        return n;
    };

    const parseBlock = (baseIndent: number): unknown => {
        // Detect whether this block is a sequence or a map by peeking at the first non-empty line
        let firstContentLine = i;
        while (firstContentLine < lines.length && (lines[firstContentLine]!.trim() === '' || lines[firstContentLine]!.trim().startsWith('#'))) {
            firstContentLine++;
        }
        if (firstContentLine >= lines.length) return null;
        const firstLine = lines[firstContentLine]!;
        const indent = getIndent(firstLine);
        if (indent < baseIndent) return null;

        // Is it a sequence?
        if (firstLine.slice(indent).startsWith('- ')) {
            return parseSequence(indent);
        }
        return parseMap(indent);
    };

    const parseSequence = (indent: number): unknown[] => {
        const arr: unknown[] = [];
        while (i < lines.length) {
            const line = lines[i]!;
            if (line.trim() === '' || line.trim().startsWith('#')) { i++; continue; }
            const lineIndent = getIndent(line);
            if (lineIndent < indent) break;
            if (lineIndent > indent || !line.slice(lineIndent).startsWith('- ')) break;
            // `- key: value` inline or `- value`
            const after = line.slice(lineIndent + 2);
            if (after.includes(':')) {
                // Start a new map item — advance i, then parse map starting with this line's key
                // Rebuild a virtual line without the `- ` prefix
                lines[i] = ' '.repeat(lineIndent + 2) + after;
                const item = parseMap(lineIndent + 2);
                arr.push(item);
            } else {
                arr.push(parseScalar(after));
                i++;
            }
        }
        return arr;
    };

    const parseMap = (indent: number): Record<string, unknown> => {
        const obj: Record<string, unknown> = {};
        while (i < lines.length) {
            const line = lines[i]!;
            if (line.trim() === '' || line.trim().startsWith('#')) { i++; continue; }
            const lineIndent = getIndent(line);
            if (lineIndent < indent) break;
            if (lineIndent > indent) { i++; continue; } // Skip over-indented lines (handled by recursive calls)

            const content = line.slice(lineIndent);
            const colonIdx = content.indexOf(':');
            if (colonIdx === -1) { i++; continue; }

            const key = content.slice(0, colonIdx).trim();
            const rest = content.slice(colonIdx + 1).trim();
            i++;

            if (rest === '') {
                // Nested value on subsequent lines
                const nested = parseBlock(lineIndent + 2);
                obj[key] = nested;
            } else {
                obj[key] = parseScalar(rest);
            }
        }
        return obj;
    };

    // Top-level is a map
    i = 0;
    while (i < lines.length && (lines[i]!.trim() === '' || lines[i]!.trim().startsWith('#'))) i++;
    if (i >= lines.length) return result;

    return parseMap(0);
}

// ═══════════════════════════════════════════════════════════════
// Skill Loader
// ═══════════════════════════════════════════════════════════════

const FRONTMATTER_RE = /^---\s*\n([\s\S]*?)\n---\s*\n?/;

function parseSkillMd(content: string, sourcePath: string): FSSkillDef | null {
    const match = FRONTMATTER_RE.exec(content);
    if (!match) return null;

    const yaml = match[1]!;
    const body = content.slice(match[0].length).trim();

    try {
        const frontmatter = parseYaml(yaml) as any;

        // Derive identity from the folder layout when the frontmatter omits it.
        // External skill libraries (gstack, mattpocock/skills — the `.claude` SKILL.md
        // standard) ship only `name` + `description`, so synthesize id/slug/persona from
        // skills/<persona>/<slug>/SKILL.md rather than rejecting them.
        const segs = sourcePath.split(/[\\/]/);
        const dirSlug = segs.length >= 2 ? segs[segs.length - 2]! : 'skill';
        const dirPersona = segs.length >= 3 ? segs[segs.length - 3]! : 'general';

        const slug = frontmatter.slug ? String(frontmatter.slug) : dirSlug;
        const name = frontmatter.name ? String(frontmatter.name) : slug;
        const adopted = !frontmatter.id;
        const id = frontmatter.id ? String(frontmatter.id) : `fs.${dirPersona}.${slug}`;

        // A SKILL.md with frontmatter but no usable name and no body is not a skill.
        if (!name && !body) return null;

        // Normalize the two community frontmatter dialects onto our fields:
        //   gstack:     allowed-tools[], triggers[], preamble-tier
        //   mattpocock: name, description (the markdown body carries the skill)
        const allowedTools = frontmatter['allowed-tools'] ?? frontmatter.allowedTools;
        const triggers = frontmatter.triggers;
        const requiredTools = Array.isArray(frontmatter.requiredTools)
            ? frontmatter.requiredTools.map(String)
            : Array.isArray(allowedTools) ? allowedTools.map(String) : [];
        const tags = [
            ...(Array.isArray(frontmatter.tags) ? frontmatter.tags.map(String) : []),
            ...(Array.isArray(triggers) ? triggers.map(String) : []),
        ];

        const skill: FSSkillDef = {
            id,
            slug,
            name,
            description: String(frontmatter.description ?? ''),
            icon: frontmatter.icon ? String(frontmatter.icon) : undefined,
            persona: String(frontmatter.persona ?? dirPersona),
            cluster: frontmatter.cluster ? String(frontmatter.cluster) : (adopted ? 'Adopted Skills' : undefined),
            complexity: frontmatter.complexity as any,
            estimatedTime: frontmatter.estimatedTime ? String(frontmatter.estimatedTime) : undefined,
            inputs: Array.isArray(frontmatter.inputs) ? frontmatter.inputs : [],
            steps: Array.isArray(frontmatter.steps) ? frontmatter.steps : [],
            outputs: Array.isArray(frontmatter.outputs) ? frontmatter.outputs : [],
            requiredTools,
            optionalTools: Array.isArray(frontmatter.optionalTools) ? frontmatter.optionalTools.map(String) : [],
            tags,
            systemPrompt: body || undefined,
            sourcePath,
            extends: frontmatter.extends ? String(frontmatter.extends) : undefined,
            adopted,
        };
        return skill;
    } catch (err) {
        console.warn(`[skill-fs-loader] failed to parse ${sourcePath}:`, err);
        return null;
    }
}

/**
 * Load skills for a persona from /skills/<persona>/<slug>/SKILL.md.
 *
 * Returns null if the folder doesn't exist so callers can fall back to
 * the existing TS literal arrays.
 */
export function loadSkillsFromFs(persona: string, skillsRoot?: string): FSLoadResult | null {
    const root = skillsRoot ?? join(skillsBaseDir(), persona);

    if (!existsSync(root)) return null;

    let stat;
    try { stat = statSync(root); } catch { return null; }
    if (!stat.isDirectory()) return null;

    const result: FSLoadResult = { skills: [], errors: [] };

    let entries: string[];
    try { entries = readdirSync(root); } catch (err) {
        result.errors.push({ path: root, error: err instanceof Error ? err.message : String(err) });
        return result;
    }

    for (const entry of entries) {
        const skillDir = join(root, entry);
        let entryStat;
        try { entryStat = statSync(skillDir); } catch { continue; }
        if (!entryStat.isDirectory()) continue;

        const skillMdPath = join(skillDir, 'SKILL.md');
        if (!existsSync(skillMdPath)) continue;

        try {
            const content = readFileSync(skillMdPath, 'utf-8');
            const parsed = parseSkillMd(content, skillMdPath);
            if (parsed) {
                parsed.persona = persona;

                // Collect supporting files
                try {
                    const files = readdirSync(skillDir).filter(f => f !== 'SKILL.md');
                    if (files.length > 0) parsed.supportingFiles = files;
                } catch {}

                result.skills.push(parsed);
            } else {
                result.errors.push({ path: skillMdPath, error: 'Invalid or missing frontmatter' });
            }
        } catch (err) {
            result.errors.push({ path: skillMdPath, error: err instanceof Error ? err.message : String(err) });
        }
    }

    return result;
}

// ═══════════════════════════════════════════════════════════════
// Hot reload (manual trigger via API)
// ═══════════════════════════════════════════════════════════════

let loadedCache: Map<string, FSLoadResult> = new Map();

export function getFsSkills(persona: string): FSLoadResult | null {
    if (loadedCache.has(persona)) return loadedCache.get(persona)!;
    const result = loadSkillsFromFs(persona);
    if (result) loadedCache.set(persona, result);
    return result;
}

export function reloadFsSkills(persona?: string): { reloaded: string[]; errors: Array<{ path: string; error: string }> } {
    const errors: Array<{ path: string; error: string }> = [];
    const reloaded: string[] = [];

    if (persona) {
        loadedCache.delete(persona);
        const result = loadSkillsFromFs(persona);
        if (result) {
            loadedCache.set(persona, result);
            reloaded.push(persona);
            errors.push(...result.errors);
        }
    } else {
        // Reload all cached personas
        const personas = Array.from(loadedCache.keys());
        loadedCache.clear();
        for (const p of personas) {
            const result = loadSkillsFromFs(p);
            if (result) {
                loadedCache.set(p, result);
                reloaded.push(p);
                errors.push(...result.errors);
            }
        }
    }

    return { reloaded, errors };
}

export function getAllFsSkills(): FSSkillDef[] {
    const all: FSSkillDef[] = [];
    for (const result of loadedCache.values()) {
        all.push(...result.skills);
    }
    return all;
}

/**
 * Eagerly load every persona folder under skills/ (skills/<persona>/<slug>/SKILL.md).
 * Called once at gateway boot so getAllFsSkills() and the unified catalog include
 * adopted community skills without waiting for a per-persona request to warm the cache.
 */
export function warmAllFsSkills(skillsRoot?: string): { personas: string[]; total: number } {
    const root = skillsRoot ?? skillsBaseDir();
    if (!existsSync(root)) return { personas: [], total: 0 };

    let entries: string[];
    try { entries = readdirSync(root); } catch { return { personas: [], total: 0 }; }

    const personas: string[] = [];
    let total = 0;
    for (const entry of entries) {
        let st;
        try { st = statSync(join(root, entry)); } catch { continue; }
        if (!st.isDirectory()) continue;

        const result = loadSkillsFromFs(entry);
        if (result) {
            loadedCache.set(entry, result);
            if (result.skills.length > 0) { personas.push(entry); total += result.skills.length; }
        }
    }
    return { personas, total };
}
