'use strict';

// Category-aware, known-contracts-first probe.
//
// A candidate gateway (from the app-set inversion) is only *proven* to serve a
// service by relaying a real, minimal request through it. This module does that
// for the contracts we know — our own services through our gateway, and the
// generic chain-RPC read through a public gateway. It is deliberately
// conservative: when it lacks a contract, a relay URL, or the credentials to
// build a request, it returns 'unprobed' rather than guessing.
//
// Outcomes:
//   confirmed — relay succeeded, the gateway demonstrably serves the service.
//   failed    — we relayed (or tried to) and it did not succeed → candidate that
//               does not actually serve (the phantom case), or a live outage.
//   unprobed  — we did not attempt: no known contract / no relay URL / no creds.

const { PROBE_CONTRACTS, CHAIN_RPC_PROBE, looksLikeChainRpc } = require('./config');

function pickContract(serviceId) {
  if (PROBE_CONTRACTS[serviceId]) return PROBE_CONTRACTS[serviceId];
  if (looksLikeChainRpc(serviceId)) return CHAIN_RPC_PROBE;
  return null;
}

async function readBody(res) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/**
 * @param {Object} args
 * @param {string} args.serviceId
 * @param {Object} args.gateway   classified gateway record ({ relayBaseUrl, access, ... })
 * @param {Object} args.creds     from readEnvCreds()
 * @param {number} [args.timeoutMs=15000]
 * @returns {Promise<{reachable:string, latencyMs?:number, detail:string}>}
 */
async function probeGateway({ serviceId, gateway, creds, timeoutMs = 15_000 }) {
  const contract = pickContract(serviceId);
  if (!contract) {
    return { reachable: 'unprobed', detail: `no known call contract for "${serviceId}"` };
  }
  const baseUrl = gateway && gateway.relayBaseUrl;
  if (!baseUrl) {
    return {
      reachable: 'unprobed',
      detail: `no known relay URL for gateway ${gateway ? gateway.address : '(unknown)'}`,
    };
  }

  const request = contract.build({ baseUrl, creds });
  if (!request) {
    return { reachable: 'unprobed', detail: `missing credentials for ${contract.category} probe` };
  }

  const startedHr = process.hrtime.bigint();
  try {
    const res = await fetch(request.url, {
      ...request.init,
      signal: AbortSignal.timeout(timeoutMs),
      redirect: 'manual',
    });
    const body = await readBody(res);
    const latencyMs = Number((process.hrtime.bigint() - startedHr) / 1_000_000n);
    if (contract.isSuccess(res, body)) {
      return { reachable: 'confirmed', latencyMs, detail: `HTTP ${res.status}` };
    }
    const snippet = typeof body === 'string' ? body.slice(0, 120) : JSON.stringify(body).slice(0, 120);
    return { reachable: 'failed', latencyMs, detail: `HTTP ${res.status}: ${snippet}` };
  } catch (err) {
    const latencyMs = Number((process.hrtime.bigint() - startedHr) / 1_000_000n);
    const reason = err.name === 'TimeoutError' ? `timeout after ${timeoutMs}ms` : err.message;
    return { reachable: 'failed', latencyMs, detail: reason };
  }
}

module.exports = { probeGateway, pickContract };
