'use strict';

// The GATEWAY branch: which gateways can relay a given service.
//
// A gateway record on-chain carries no service binding — "which services can
// this gateway relay" is not a queryable field. It has to be DERIVED by
// inverting the application set: every app declares service_configs and
// delegatee_gateway_addresses, so (service × delegated-gateway) over all apps
// yields, per service, its candidate gateways. We scan all apps once and cache.
//
// These are *candidates*: on-chain delegation says a gateway could relay the
// service, but the final supplier↔gateway wiring is operator config the chain
// doesn't expose. A probe (see probe.js) is what promotes candidate → confirmed.
//
// Forward-compat seam: when gateways can self-declare their supported services
// (convention Issue 6), pass `selfDeclared` to fold that in, with the on-chain
// inversion kept as the cross-check / fallback rather than the sole source.

const { KNOWN_GATEWAYS } = require('./config');

/** access + label for a gateway address; unknown gateways default conservative. */
function classifyGateway(address) {
  const known = KNOWN_GATEWAYS[address];
  return {
    address,
    label: known ? known.label : null,
    access: known ? known.access : 'access-required',
    relayBaseUrl: known ? known.relayBaseUrl || null : null,
  };
}

/**
 * @param {object[]} apps  output of transport.listApplications()
 * @param {Object} [opts]
 * @param {Object<string,string[]>} [opts.selfDeclared]  gateway -> serviceIds[]
 *   (future: gateway self-declaration; merged on top of inversion)
 * @returns {{ byService: Map<string,string[]>, gateways: Map<string,object>, appsScanned: number }}
 */
function invertApplications(apps, opts = {}) {
  const byService = new Map(); // serviceId -> Set<gatewayAddr>
  const gatewayServices = new Map(); // gatewayAddr -> Set<serviceId>

  const addEdge = (serviceId, gateway) => {
    if (!byService.has(serviceId)) byService.set(serviceId, new Set());
    byService.get(serviceId).add(gateway);
    if (!gatewayServices.has(gateway)) gatewayServices.set(gateway, new Set());
    gatewayServices.get(gateway).add(serviceId);
  };

  for (const app of apps) {
    const services = (app.service_configs || []).map((c) => c.service_id).filter(Boolean);
    const gateways = app.delegatee_gateway_addresses || [];
    for (const svc of services) {
      for (const gw of gateways) addEdge(svc, gw);
    }
  }

  // Fold in any self-declared edges (forward-compat; empty today).
  for (const [gw, services] of Object.entries(opts.selfDeclared || {})) {
    for (const svc of services) addEdge(svc, gw);
  }

  // Freeze into plain arrays + classified gateway records.
  const byServiceArr = new Map();
  for (const [svc, set] of byService) byServiceArr.set(svc, [...set]);

  const gateways = new Map();
  for (const [gw, set] of gatewayServices) {
    gateways.set(gw, { ...classifyGateway(gw), serviceIds: [...set] });
  }

  return { byService: byServiceArr, gateways, appsScanned: apps.length };
}

/**
 * Build (or fetch from cache) the inverted gateway index. Short TTL: app
 * delegations are stable across a block or two, and one agent session resolves
 * many services off a single scan.
 */
async function buildGatewayIndex(transport, cache, opts = {}) {
  const key = `gateway-index:${transport.network}`;
  return cache.wrap(key, async () => {
    const apps = await transport.listApplications();
    return invertApplications(apps, opts);
  }, opts.ttlMs);
}

/** Candidate gateways for one service, as classified records. */
function candidateGatewaysFor(index, serviceId) {
  const addrs = index.byService.get(serviceId) || [];
  return addrs.map((addr) => index.gateways.get(addr) || classifyGateway(addr));
}

module.exports = {
  classifyGateway,
  invertApplications,
  buildGatewayIndex,
  candidateGatewaysFor,
};
