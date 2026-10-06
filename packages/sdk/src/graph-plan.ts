export interface GraphNodeState { id: string; status: string }
export interface GraphDependency { from: string; to: string; enabled?: boolean }
export interface GraphPlan { ready: string[]; skipped: string[]; blocked: string[] }

export function validateGraph(nodes: readonly { id: string }[], edges: readonly GraphDependency[]): void {
    if (!nodes.length || nodes.length > 10_000 || edges.length > 50_000) throw new Error('Invalid graph size');
    const incoming = new Map<string, number>();
    const outgoing = new Map<string, string[]>();
    for (const node of nodes) {
        if (!node.id || node.id.length > 200 || incoming.has(node.id)) throw new Error('Duplicate or invalid graph node');
        incoming.set(node.id, 0);
        outgoing.set(node.id, []);
    }
    const seen = new Set<string>();
    for (const edge of edges) {
        if (!incoming.has(edge.from) || !incoming.has(edge.to)) throw new Error('Graph edge references an unknown node');
        const key = JSON.stringify([edge.from, edge.to]);
        if (seen.has(key)) throw new Error('Duplicate graph edge');
        seen.add(key);
        incoming.set(edge.to, incoming.get(edge.to)! + 1);
        outgoing.get(edge.from)!.push(edge.to);
    }
    const ready = [...incoming].filter(([, count]) => count === 0).map(([id]) => id);
    let visited = 0;
    for (let index = 0; index < ready.length; index++) {
        const id = ready[index]!;
        visited++;
        for (const next of outgoing.get(id)!) {
            const count = incoming.get(next)! - 1;
            incoming.set(next, count);
            if (count === 0) ready.push(next);
        }
    }
    if (visited !== nodes.length) throw new Error('Graph contains a cycle');
}

export function resolveGraphInput(value: unknown, context: Record<string, unknown>, depth = 0): unknown {
    if (depth > 32) throw new Error('Input binding depth exceeded');
    const resolve = (path: string) => {
        let current: unknown = context;
        for (const part of path.trim().split('.')) {
            if (!part || ['__proto__','prototype','constructor'].includes(part) || !current || typeof current !== 'object' || !Object.hasOwn(current, part)) throw new Error(`Unresolved input binding: ${path}`);
            current = (current as Record<string, unknown>)[part];
        }
        return structuredClone(current);
    };
    if (typeof value === 'string') {
        const exact = value.match(/^\{\{\s*([^{}]+?)\s*\}\}$/);
        if (exact) return resolve(exact[1]!);
        return value.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (_match, path: string) => {
            const resolved = resolve(path);
            if (resolved !== null && typeof resolved === 'object') throw new Error('Structured values require an exact input binding');
            return String(resolved ?? '');
        });
    }
    if (Array.isArray(value)) return value.map(item => resolveGraphInput(item, context, depth + 1));
    if (value && typeof value === 'object') {
        if (Object.hasOwn(value, '$ref')) {
            const ref = (value as { $ref?: unknown }).$ref;
            if (typeof ref !== 'string' || Object.keys(value).length !== 1) throw new Error('Invalid structured input binding');
            return resolve(ref);
        }
        return Object.fromEntries(Object.entries(value).map(([key, item]) => {
            if (['__proto__','constructor','prototype'].includes(key)) throw new Error('Unsafe input key');
            return [key, resolveGraphInput(item, context, depth + 1)];
        }));
    }
    return value;
}

export function planGraph(nodes: readonly GraphNodeState[], edges: readonly GraphDependency[]): GraphPlan {
    const states = new Map(nodes.map(node => [node.id, node.status]));
    const incoming = new Map<string, GraphDependency[]>();
    for (const edge of edges) {
        const list = incoming.get(edge.to) ?? [];
        list.push(edge);
        incoming.set(edge.to, list);
    }
    const good = new Set(['complete','completed','simulated']);
    const bad = new Set(['failed','failure','rejected','cancelled','unsupported','inconclusive','blocked']);
    const skipped: string[] = [], blocked: string[] = [];
    let changed = true;
    while (changed) {
        changed = false;
        for (const node of nodes) {
            if (states.get(node.id) !== 'pending') continue;
            const dependencies = incoming.get(node.id) ?? [];
            if (!dependencies.length) continue;
            const active = dependencies.filter(edge => edge.enabled !== false && states.get(edge.from) !== 'skipped');
            if (active.some(edge => bad.has(states.get(edge.from) ?? 'blocked'))) {
                states.set(node.id, 'blocked'); blocked.push(node.id); changed = true;
            } else if (!active.length) {
                states.set(node.id, 'skipped'); skipped.push(node.id); changed = true;
            }
        }
    }
    const ready = nodes.filter(node => {
        if (states.get(node.id) !== 'pending') return false;
        return (incoming.get(node.id) ?? []).every(edge => edge.enabled === false || states.get(edge.from) === 'skipped' || good.has(states.get(edge.from) ?? ''));
    }).map(node => node.id);
    return { ready, skipped, blocked };
}
