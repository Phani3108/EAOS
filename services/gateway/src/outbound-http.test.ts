import { describe, expect, it } from 'vitest';
import { validateDestination } from './outbound-http.js';

describe('outbound destination policy', () => {
  it('bounds stalled DNS with the same cancellation budget as dispatch', async () => {
    const controller = new AbortController();
    const resolving = validateDestination('https://api.example.invalid/path', ['https://api.example.invalid'], () => new Promise(() => {}), undefined, controller.signal);
    controller.abort();
    await expect(resolving).rejects.toThrow('Outbound resolution cancelled');
  });
  it('rejects private, metadata and mapped-private addresses', async () => {
    for (const address of ['127.0.0.1','10.0.0.1','169.254.169.254','::1','::ffff:127.0.0.1','fd00::1']) await expect(validateDestination('https://api.example.invalid/path', ['https://api.example.invalid'], async () => [{ address, family: address.includes(':') ? 6 : 4 }])).rejects.toThrow();
  });
  it('requires an exact authorized HTTPS origin and rejects ambiguous DNS', async () => {
    const lookup = async () => [{ address: '8.8.8.8', family: 4 }];
    await expect(validateDestination('https://api.example.invalid/path', ['https://api.example.invalid'], lookup)).resolves.toMatchObject({ address: '8.8.8.8' });
    await expect(validateDestination('http://api.example.invalid/path', ['http://api.example.invalid'], lookup)).rejects.toThrow();
    await expect(validateDestination('https://other.example.invalid/path', ['https://api.example.invalid'], lookup)).rejects.toThrow();
    await expect(validateDestination('https://user:password@api.example.invalid/path', ['https://api.example.invalid'], lookup)).rejects.toThrow();
    await expect(validateDestination('https://api.example.invalid/path', ['https://api.example.invalid'], async () => [...await lookup(), { address: '127.0.0.1', family: 4 }])).rejects.toThrow();
  });
});
