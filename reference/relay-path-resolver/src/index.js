'use strict';

// Public entry point for the library.

const { RelayPathResolver, recommend, DIRECT_REQUIRES } = require('./resolver');
const { PocketdTransport } = require('./transport');
const { TTLCache } = require('./cache');
const { invertApplications, classifyGateway } = require('./gateway-index');
const { probeGateway } = require('./probe');
const config = require('./config');

/** Convenience: one-shot resolve with default pocketd transport. */
async function resolveAccess(serviceId, agentProfile, opts = {}) {
  const resolver = new RelayPathResolver(opts);
  return resolver.resolveAccess(serviceId, agentProfile, opts);
}

module.exports = {
  RelayPathResolver,
  resolveAccess,
  recommend,
  DIRECT_REQUIRES,
  PocketdTransport,
  TTLCache,
  invertApplications,
  classifyGateway,
  probeGateway,
  config,
};
