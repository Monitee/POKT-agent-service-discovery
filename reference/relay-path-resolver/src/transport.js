'use strict';

// Transport layer.
//
// Everything the resolver knows about the chain comes through a Transport. Today
// the only implementation shells out to `pocketd`; the interface is deliberately
// narrow (three reads) so it can later be backed by a direct gRPC/RPC client
// without touching the resolver. Keep the surface here read-only — no tx, no keys.

const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const execFileAsync = promisify(execFile);

const POKT_ADDR_RE = /^pokt1[a-z0-9]{38}$/;

/**
 * @typedef {Object} Transport
 * @property {(serviceId: string) => Promise<object[]>} listSuppliers
 * @property {() => Promise<object[]>} listApplications
 * @property {(serviceId: string) => Promise<object|null>} showService
 * @property {string} network
 */

class PocketdTransport {
  /**
   * @param {Object} [opts]
   * @param {string} [opts.network='main']  pocketd --network moniker
   * @param {string} [opts.bin='pocketd']   binary name/path
   * @param {number} [opts.pageSize=500]    application pagination page size
   * @param {number} [opts.timeoutMs=60000] per-query timeout
   */
  constructor(opts = {}) {
    this.network = opts.network || 'main';
    this.bin = opts.bin || 'pocketd';
    this.pageSize = opts.pageSize || 500;
    this.timeoutMs = opts.timeoutMs || 60000;
    // 32 MiB: comfortably above any single filtered/ paginated page, well under
    // the unfiltered-supplier responses we explicitly refuse to make.
    this.maxBuffer = opts.maxBuffer || 32 * 1024 * 1024;
  }

  async _run(args) {
    const full = [...args, '--network', this.network, '-o', 'json'];
    let stdout;
    try {
      ({ stdout } = await execFileAsync(this.bin, full, {
        timeout: this.timeoutMs,
        maxBuffer: this.maxBuffer,
      }));
    } catch (err) {
      const detail = (err.stderr || err.message || '').toString().trim();
      throw new Error(`pocketd ${args.slice(0, 3).join(' ')} failed: ${detail}`);
    }
    try {
      return JSON.parse(stdout);
    } catch {
      throw new Error(`pocketd ${args.slice(0, 3).join(' ')} returned non-JSON output`);
    }
  }

  /**
   * Suppliers serving a service, with their endpoints. One filtered query.
   *
   * Returns { suppliers, total }: a bounded SAMPLE of supplier records plus the
   * accurate total via --page-count-total. We deliberately do NOT enumerate the
   * full set — popular services have thousands of suppliers (eth ~4063), and
   * callability only needs the count plus a few endpoints for the direct path.
   * Pulling all of them would be slow and risks the same 4 MB gRPC cap that the
   * HARD RULE (never enumerate suppliers UNFILTERED) exists to avoid. --dehydrated
   * drops service_config_history/rev_share but keeps the endpoints we want.
   *
   * Note: suppliers use --page-limit/--page-offset/--page-count-total — different
   * flag names from `list-application` (which uses --limit/--page).
   */
  async listSuppliers(serviceId, { sampleLimit = 100 } = {}) {
    if (!serviceId || typeof serviceId !== 'string') {
      throw new Error('listSuppliers requires a serviceId (refusing unfiltered enumeration)');
    }
    const res = await this._run([
      'query', 'supplier', 'list-suppliers', '--service-id', serviceId,
      '--dehydrated', '--page-limit', String(sampleLimit), '--page-count-total',
    ]);
    const suppliers = res.supplier || [];
    const totalRaw = res.pagination && res.pagination.total;
    const total = totalRaw != null && totalRaw !== '0' ? Number(totalRaw) : suppliers.length;
    return { suppliers, total };
  }

  /**
   * Every application on-chain. The chain has no service filter for applications,
   * so the gateway index has to scan the whole set (~134 today) and invert it.
   * Paginated via --page; --page-key is currently ignored by pocketd, --page works.
   */
  async listApplications() {
    const all = [];
    let page = 1;
    // Safety backstop against a runaway loop if pagination semantics ever shift.
    const MAX_PAGES = 1000;
    while (page <= MAX_PAGES) {
      const res = await this._run([
        'query', 'application', 'list-application',
        '--limit', String(this.pageSize),
        '--page', String(page),
      ]);
      const apps = res.applications || [];
      all.push(...apps);
      if (apps.length < this.pageSize) break;
      page++;
    }
    return all;
  }

  /** Service record: id, name, compute_units_per_relay, owner_address. */
  async showService(serviceId) {
    if (!serviceId) throw new Error('showService requires a serviceId');
    try {
      const res = await this._run(['query', 'service', 'show-service', serviceId]);
      return res.service || null;
    } catch (err) {
      // A non-existent service id surfaces as a query error, not an empty result.
      if (/not found|does not exist|unknown/i.test(err.message)) return null;
      throw err;
    }
  }
}

module.exports = { PocketdTransport, POKT_ADDR_RE };
