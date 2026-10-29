import type { PlatformRepository } from '@agentos/db/platform-repository';
import type { AuthUser } from './auth.js';

export async function resolvePlatformPrincipal(repository: PlatformRepository | undefined, user: AuthUser): Promise<AuthUser | undefined> {
  if (!repository) return user;
  const member = await repository.membership({ tenantId: user.tenantId, userId: user.id });
  if (!member) return user;
  if (member.state !== 'active') return undefined;
  const rank = { user: 0, operator: 1, admin: 2 };
  const role = rank[user.role] <= rank[member.role] ? user.role : member.role;
  const scopes = user.personaScopes ?? [];
  const personaScopes = member.personaScopes.includes('*') ? scopes : scopes.includes('*') ? member.personaScopes : scopes.filter(scope => member.personaScopes.includes(scope));
  return { ...user, role, personaScopes: personaScopes as AuthUser['personaScopes'] };
}
export function metricRoute(path: string): string {
  const known = ['/api/operations','/api/evaluations','/api/registry','/api/admin','/api/executions','/api/execute','/api/catalog','/api/artifacts','/api/connections','/api/knowledge','/api/chat','/api/scheduler','/api/auth'];
  return known.find(prefix => path === prefix || path.startsWith(prefix + '/')) ?? '/api/other';
}
export class RequestMeasurements {
  private readonly queue: Array<{ tenant: string; method: string; route: string; status: number; duration: number }> = [];
  private flushing?: Promise<void>;
  dropped = 0;
  constructor(private readonly repository: PlatformRepository) {}
  record(tenant: string, method: string, path: string, status: number, duration: number): void {
    if (this.queue.length >= 1000) { this.dropped++; return; }
    this.queue.push({ tenant, method, route: metricRoute(path), status, duration });
    void this.flush();
  }
  flush(): Promise<void> {
    if (this.flushing) return this.flushing;
    this.flushing = (async () => {
      while (this.queue.length) {
        const batch = this.queue.splice(0, 50);
        const results = await Promise.allSettled(batch.map(item => this.repository.recordRequest(item.tenant, item.method, item.route, item.status, item.duration)));
        this.dropped += results.filter(result => result.status === 'rejected').length;
      }
    })().finally(() => { this.flushing = undefined; if (this.queue.length) void this.flush(); });
    return this.flushing;
  }
}
