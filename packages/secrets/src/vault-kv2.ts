import type { SecretReference, SecretValue, SecretAuditEntry, SecretVault } from './vault.js';
import { isOwnedSecretPath, isSecretOwnerSegment } from './namespace.js';

export interface VaultRequest { url: string; method: 'GET' | 'POST'; headers: Record<string, string>; body?: unknown; signal?: AbortSignal }
export class VaultKV2 implements Pick<SecretVault, 'get' | 'rotate'> {
  private readonly audit: SecretAuditEntry[] = [];
  private readonly base: string;
  constructor(private readonly options: { tenantId: string; userId: string; address: string; mount?: string; token: () => Promise<string>; request: (request: VaultRequest) => Promise<unknown>; onAudit?: (entry: SecretAuditEntry) => Promise<void> }) {
    const url = new URL(options.address);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('Vault requires a configured HTTPS origin');
    if (!isSecretOwnerSegment(options.tenantId) || !isSecretOwnerSegment(options.userId) || !/^[a-zA-Z0-9_-]{1,200}$/.test(options.mount ?? 'secret')) throw new Error('Invalid Vault scope');
    this.base = `${url.origin}/v1/${encodeURIComponent(options.mount ?? 'secret')}/data/`;
  }
  private location(ref: SecretReference): string {
    if (ref.provider !== 'vault' || !isOwnedSecretPath(ref.path, this.options) || ref.key && !/^[a-zA-Z0-9_-]{1,200}$/.test(ref.key) || ref.version && !/^[1-9][0-9]{0,8}$/.test(ref.version)) throw new Error('Secret reference is outside the authorized scope');
    return this.base + ref.path.split('/').map(encodeURIComponent).join('/');
  }
  private async record(ref: SecretReference, success: boolean, action: 'read' | 'rotate') {
    const entry: SecretAuditEntry = { action, path: ref.path, actor: `${this.options.tenantId}/${this.options.userId}`, timestamp: new Date(), success };
    this.audit.push(entry);
    if (this.audit.length > 1000) this.audit.shift();
    await this.options.onAudit?.(entry);
  }
  private async read(ref: SecretReference) {
    const url = this.location(ref);
    const token = await this.options.token();
    if (!token) throw new Error('Vault authentication is not configured');
    let response: unknown;
    try { response = await this.options.request({ url: `${url}${ref.version ? `?version=${ref.version}` : ''}`, method: 'GET', headers: { 'X-Vault-Token': token } }); }
    catch { throw new Error('Vault request failed'); }
    const data = (response as { data?: { data?: Record<string, unknown>; metadata?: { version?: number; destroyed?: boolean; deletion_time?: string } } })?.data;
    if (!data?.data || !data.metadata || !Number.isInteger(data.metadata.version) || data.metadata.version! < 1 || data.metadata.destroyed || data.metadata.deletion_time || ref.version && String(data.metadata.version) !== ref.version) throw new Error('Secret version is unavailable');
    const value = data.data[ref.key ?? 'token'];
    if (typeof value !== 'string' || !value || value.length > 64_000) throw new Error('Secret field is unavailable');
    return { value, version: String(data.metadata.version), fields: data.data };
  }
  async get(ref: SecretReference): Promise<SecretValue> {
    this.location(ref);
    let success = false;
    try { const result = await this.read(ref); success = true; return { ref: { ...ref, version: result.version }, value: result.value, version: result.version }; }
    finally { await this.record(ref, success, 'read'); }
  }
  async rotate(ref: SecretReference, value: string): Promise<void> {
    const url = this.location(ref);
    if (!ref.version || !value || value.length > 64_000) throw new Error('Rotation requires an expected version and bounded value');
    let success = false;
    try {
      const previous = await this.read(ref);
      const response = await this.options.request({ url, method: 'POST', headers: { 'X-Vault-Token': await this.options.token() }, body: { options: { cas: Number(ref.version) }, data: { ...previous.fields, [ref.key ?? 'token']: value } } }) as { data?: { version?: number } };
      if (response.data?.version !== Number(ref.version) + 1) throw new Error('Rotation version was not confirmed');
      const verified = await this.read({ ...ref, version: String(response.data.version) });
      if (verified.value !== value) throw new Error('Rotated value did not match');
      success = true;
    } catch { throw new Error('Vault rotation was not acknowledged'); }
    finally { await this.record(ref, success, 'rotate'); }
  }
  auditLog(): SecretAuditEntry[] { return [...this.audit]; }
}
