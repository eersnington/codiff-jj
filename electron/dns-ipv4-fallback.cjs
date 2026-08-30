// @ts-check

const dns = require('node:dns');

const PUBLIC_DNS_SERVERS = ['1.1.1.1', '1.0.0.1', '8.8.8.8'];
const originalLookup = dns.lookup.bind(dns);

/**
 * @param {{
 *   lookup?: typeof dns.lookup;
 *   resolve4?: (hostname: string, callback: (error: NodeJS.ErrnoException | null, addresses?: Array<string>) => void) => void;
 * }} [options]
 */
const createIpv4FallbackLookup = ({
  lookup = originalLookup,
  resolve4 = (hostname, callback) => {
    const resolver = new dns.Resolver();
    resolver.setServers(PUBLIC_DNS_SERVERS);
    resolver.resolve4(hostname, callback);
  },
} = {}) => {
  /**
   * @param {string} hostname
   * @param {import('node:dns').LookupOneOptions | import('node:dns').LookupAllOptions | import('node:dns').LookupOptions | number | ((error: NodeJS.ErrnoException | null, address?: unknown, family?: number) => void)} options
   * @param {((error: NodeJS.ErrnoException | null, address?: unknown, family?: number) => void)=} callback
   */
  return (hostname, options, callback) => {
    if (typeof options === 'function') {
      callback = options;
      options = {};
    }
    const lookupOptions = typeof options === 'number' ? { family: options } : options || {};
    const finish = callback;
    if (typeof finish !== 'function') {
      throw new TypeError('callback is required');
    }

    lookup(hostname, lookupOptions, (error, address, family) => {
      if (!error || lookupOptions.family === 6) {
        finish(error, address, family);
        return;
      }

      resolve4(hostname, (resolveError, addresses) => {
        if (resolveError || !addresses || addresses.length === 0) {
          finish(error, address, family);
          return;
        }

        if (lookupOptions.all) {
          finish(
            null,
            addresses.map((value) => ({ address: value, family: 4 })),
          );
          return;
        }

        finish(null, addresses[0], 4);
      });
    });
  };
};

let installed = false;

const installIpv4DnsFallback = () => {
  if (installed) {
    return;
  }
  installed = true;
  dns.lookup = createIpv4FallbackLookup();
};

module.exports = {
  createIpv4FallbackLookup,
  installIpv4DnsFallback,
};
