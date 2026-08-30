import { createRequire } from 'node:module';
import { expect, test } from 'vite-plus/test';

const require = createRequire(import.meta.url);
const { resolvePlanShareTarget, resolveWalkthroughShareTarget } =
  require('../walkthrough-sharing.cjs') as {
    resolvePlanShareTarget: (options: {
      email?: string;
      forcePublic?: boolean;
      overrideUrl?: string;
    }) => {
      authenticated: boolean;
      internal: boolean;
      serviceUrl: string;
    };
    resolveWalkthroughShareTarget: (options: {
      email?: string;
      forcePublic?: boolean;
      overrideUrl?: string;
    }) => {
      authenticated: boolean;
      internal: boolean;
      serviceUrl: string;
    };
  };

test('routes users without a Cloudflare Git identity to the public service', () => {
  expect(resolvePlanShareTarget({})).toEqual({
    authenticated: false,
    internal: false,
    serviceUrl: 'https://codiff.eers.dev',
  });
  expect(resolvePlanShareTarget({ overrideUrl: 'http://localhost:6002/' })).toEqual({
    authenticated: false,
    internal: false,
    serviceUrl: 'http://localhost:6002',
  });
});

test('routes Cloudflare git identities to the authenticated internal service', () => {
  expect(
    resolveWalkthroughShareTarget({
      email: 'Ada@Cloudflare.com ',
    }),
  ).toEqual({
    authenticated: true,
    internal: true,
    serviceUrl: 'https://codiff.cloudflare.dev',
  });
});

test('routes all external Git identities to the public service', () => {
  expect(
    resolveWalkthroughShareTarget({
      email: 'cpojer@example.com',
    }),
  ).toEqual({
    authenticated: false,
    internal: false,
    serviceUrl: 'https://codiff.eers.dev',
  });
});

test('keeps explicit development servers unauthenticated and preserves audience routing', () => {
  expect(
    resolveWalkthroughShareTarget({
      email: 'ada@cloudflare.com',
      overrideUrl: 'http://localhost:6001/',
    }),
  ).toEqual({
    authenticated: false,
    internal: true,
    serviceUrl: 'http://localhost:6001',
  });
});

test('forces Cloudflare Git identities to the public service when requested', () => {
  expect(
    resolveWalkthroughShareTarget({
      email: 'ada@cloudflare.com',
      forcePublic: true,
    }),
  ).toEqual({
    authenticated: false,
    internal: false,
    serviceUrl: 'https://codiff.eers.dev',
  });
});
