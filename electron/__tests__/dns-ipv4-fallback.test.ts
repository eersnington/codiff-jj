import { createRequire } from 'node:module';
import { expect, test } from 'vite-plus/test';

const require = createRequire(import.meta.url);
const { createIpv4FallbackLookup } = require('../dns-ipv4-fallback.cjs') as {
  createIpv4FallbackLookup: (options?: {
    lookup?: (
      hostname: string,
      options: object,
      callback: (error: NodeJS.ErrnoException | null, address?: unknown, family?: number) => void,
    ) => void;
    resolve4?: (
      hostname: string,
      callback: (error: NodeJS.ErrnoException | null, addresses?: Array<string>) => void,
    ) => void;
  }) => (
    hostname: string,
    options: object,
    callback: (error: NodeJS.ErrnoException | null, address?: unknown, family?: number) => void,
  ) => void;
};

const lookupAddress = (lookup: ReturnType<typeof createIpv4FallbackLookup>, hostname: string) =>
  new Promise<unknown>((resolve, reject) => {
    lookup(hostname, {}, (error, address) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(address);
    });
  });

test('uses the system lookup when it returns an address', async () => {
  const lookup = createIpv4FallbackLookup({
    lookup: (_hostname, _options, callback) => {
      callback(null, '127.0.0.1', 4);
    },
    resolve4: () => {
      throw new Error('public DNS should not run when system lookup works');
    },
  });

  await expect(lookupAddress(lookup, 'codiff.eers.dev')).resolves.toBe('127.0.0.1');
});

test('uses public DNS IPv4 when system lookup cannot resolve the host', async () => {
  const lookup = createIpv4FallbackLookup({
    lookup: (_hostname, _options, callback) => {
      callback(Object.assign(new Error('getaddrinfo ENOTFOUND'), { code: 'ENOTFOUND' }));
    },
    resolve4: (hostname, callback) => {
      expect(hostname).toBe('codiff.eers.dev');
      callback(null, ['104.21.19.18', '172.67.184.117']);
    },
  });

  await expect(lookupAddress(lookup, 'codiff.eers.dev')).resolves.toBe('104.21.19.18');
});

test('keeps the original lookup error when public DNS also fails', async () => {
  const lookup = createIpv4FallbackLookup({
    lookup: (_hostname, _options, callback) => {
      callback(Object.assign(new Error('getaddrinfo ENOTFOUND'), { code: 'ENOTFOUND' }));
    },
    resolve4: (_hostname, callback) => {
      callback(Object.assign(new Error('queryA ENOTFOUND'), { code: 'ENOTFOUND' }));
    },
  });

  await expect(lookupAddress(lookup, 'missing.example')).rejects.toMatchObject({
    code: 'ENOTFOUND',
    message: 'getaddrinfo ENOTFOUND',
  });
});
