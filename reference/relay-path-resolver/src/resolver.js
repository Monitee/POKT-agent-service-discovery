'use strict';

// resolveAccess(serviceId, agentProfile?) → ServiceAccess
//
// POKT has exactly two actor models, so a service has exactly two access paths:
//   DIRECT  — the agent is its own staked application: stake, sign relays, talk
//             to the suppliers itself. Sovereign, no gateway needed.
//   GATEWAY — the agent uses someone else's gateway app to relay for it.
//
// Callability is decided by SUPPLIERS, not gateways. If suppliers serve the
// service, it is callable in principle — DIRECT is always available, and any
// gateway is a convenience on top. A missing gateway never makes a served
// service "not callable"; it only means the convenience path is absent.
// (This is the corrected model — do not reintroduce the gateway-gated framing.)

const { PocketdTransport } = require('./transport');
const { TTLCache } = require('./cache');
const { buildGatewayIndex, candidateGatewaysFor } = require('./gateway-index');
const { probeGateway } = require('./probe');
const { readEnvCreds } = require('./config');

const DIRECT_REQUIRES = ['app-stake', 'wallet', 'session-warmup'];

class RelayPathResolver {
  constructor(opts = {}) {
    this.transport = opts.transport || new PocketdTransport({ network: opts.network });
    this.cache = opts.cache || new TTLCache(opts.ttlMs || 30_000);
    this.creds = opts.creds || readEnvCreds();
    this.probeTimeoutMs = opts.probeTimeoutMs || 15_000;
  }

  /**
   * @param {string} serviceId
   * @param {Object} [agentProfile]  if given, adds a recommendation
   * @param {string[]} [agentProfile.credentialedGateways]  gateways the agent can already use
   * @param {boolean} [agentProfile.canSelfStake]  holds POKT + tolerates session warmup
   * @param {Object} [opts]
   * @param {boolean} [opts.probe=false]  attempt live probes to confirm gateways
   * @returns {Promise<Object>} ServiceAccess
   */
  async resolveAccess(serviceId, agentProfile, opts = {}) {
    if (!serviceId) throw new Error('resolveAccess requires a serviceId');
    const doProbe = !!opts.probe;

    // --- suppliers (the callability anchor) + service record, in parallel ---
    const [supRes, serviceRec, index] = await Promise.all([
      this.transport.listSuppliers(serviceId),
      this.transport.showService(serviceId).catch(() => null),
      buildGatewayIndex(this.transport, this.cache),
    ]);

    // `suppliers` is a bounded sample; `supplierCount` is the accurate total.
    const suppliers = supRes.suppliers.map((s) => {
      const svc = (s.services || []).find((x) => x.service_id === serviceId);
      const endpoint = svc && svc.endpoints && svc.endpoints[0] ? svc.endpoints[0].url : null;
      return { address: s.operator_address, operator: s.operator_address, endpoint };
    });
    const supplierCount = supRes.total;
    const served = supplierCount > 0;

    // --- gateway branch: candidates from inversion, optionally probe-confirmed ---
    const candidates = candidateGatewaysFor(index, serviceId);
    const gateways = [];
    for (const gw of candidates) {
      const entry = { gateway: gw.address, label: gw.label, serves: 'candidate', access: gw.access };
      if (doProbe) {
        const probe = await probeGateway({
          serviceId, gateway: gw, creds: this.creds, timeoutMs: this.probeTimeoutMs,
        });
        entry.probe = probe;
        if (probe.reachable === 'confirmed') entry.serves = 'confirmed';
        else if (probe.reachable === 'unprobed') entry.serves = 'unprobed';
        else if (probe.reachable === 'failed') entry.serves = 'failed';
        // 'failed' = on-chain candidate whose live probe relay did not succeed.
        // entry.probe carries the failure detail.
      }
      gateways.push(entry);
    }

    const access = {
      serviceId,
      served,
      service: serviceRec
        ? {
            name: serviceRec.name || null,
            computeUnitsPerRelay: serviceRec.compute_units_per_relay
              ? Number(serviceRec.compute_units_per_relay)
              : null,
            owner: serviceRec.owner_address || null,
          }
        : null,
      supplierCount,
      suppliers, // bounded sample of supplierCount; not necessarily the full set
      direct: { available: served, requires: DIRECT_REQUIRES },
      gateways,
      meta: {
        network: this.transport.network,
        resolvedAt: new Date().toISOString(),
        probed: doProbe,
        appsScanned: index.appsScanned,
      },
    };

    if (agentProfile) {
      access.recommendation = recommend(access, agentProfile);
    }
    return access;
  }
}

// --- decision layer ------------------------------------------------------------

// How confident can we be that the agent could actually relay through this
// gateway? The phantom case is the reason this is strict: a stranger's
// public-free gateway that merely *lists* the service via inversion is an
// unconfirmed candidate, not a usable path — recommending it on listing alone
// is exactly the candidate≠serves trap. So:
//   - public-free is only confidently usable when PROBE-CONFIRMED;
//   - a gateway the agent is already credentialed for is usable even unconfirmed
//     (it's a standing relationship), but the recommendation says to verify;
//   - access-required without a credential is never usable.
function gatewayConfidence(g, profile) {
  // A probe that ran and failed is a definitive no — never recommend it, even to
  // a credentialed agent (the credential doesn't fix a gateway that didn't serve).
  if (g.serves === 'failed') return { usable: false };
  const credentialed = (profile.credentialedGateways || []).includes(g.gateway);
  const confirmed = g.serves === 'confirmed';
  if (confirmed && g.access === 'public-free') {
    return { usable: true, rank: 0, why: 'public, no credential, probe-confirmed' };
  }
  if (confirmed && credentialed) {
    return { usable: true, rank: 1, why: 'you are credentialed for it, probe-confirmed' };
  }
  if (credentialed) {
    return {
      usable: true,
      rank: 2,
      why: 'you are credentialed for it (unconfirmed — run --probe to verify it still serves this)',
    };
  }
  return { usable: false };
}

function recommend(access, profile) {
  if (!access.served) {
    return {
      path: 'none',
      why: 'No supplier serves this service — it is described but not callable until one stakes for it.',
    };
  }

  const usable = access.gateways
    .map((g) => ({ g, c: gatewayConfidence(g, profile) }))
    .filter((x) => x.c.usable)
    .sort((a, b) => a.c.rank - b.c.rank); // lowest friction first

  if (usable.length) {
    const { g, c } = usable[0];
    return {
      path: { gateway: g.gateway },
      why: `Gateway path is lowest friction — ${c.why}. No staking or session warmup needed.`,
    };
  }

  if (profile.canSelfStake) {
    return {
      path: 'direct',
      why: 'No usable gateway, but suppliers serve it and you can self-stake — stake an app, delegate, sign your own relays.',
    };
  }

  // Surface an unconfirmed public candidate as a lead, without recommending it
  // outright — checking it is what --probe is for. Exclude 'failed' (already
  // probed and didn't serve) and 'confirmed' (would have been usable above).
  const lead = access.gateways.find(
    (g) => g.access === 'public-free' && g.serves !== 'confirmed' && g.serves !== 'failed',
  );
  const leadNote = lead
    ? ` There is an unconfirmed public candidate (${lead.gateway}) — run --probe to check whether it actually serves this before relying on it.`
    : '';
  return {
    path: 'needs-onboarding',
    why: `Suppliers serve it, but you have no usable gateway and cannot self-stake. Either obtain a credential on a gateway that serves this service, or acquire POKT to self-stake.${leadNote}`,
  };
}

module.exports = { RelayPathResolver, recommend, DIRECT_REQUIRES };
