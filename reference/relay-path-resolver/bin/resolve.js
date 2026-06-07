#!/usr/bin/env node
'use strict';

// Thin CLI: `resolve <serviceId>` prints the ServiceAccess for a POKT service.
//
//   resolve ai-inference
//   resolve ai-inference --probe
//   resolve ai-inference --json
//   resolve ai-inference --probe --can-self-stake          (adds a recommendation)
//   resolve ai-inference --credentialed-gateway pokt1ecryk... --probe

const { RelayPathResolver } = require('../src/index');

function parseArgs(argv) {
  const args = { _: [], probe: false, json: false, network: 'main', profile: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case '--probe': args.probe = true; break;
      case '--json': args.json = true; break;
      case '--network': args.network = argv[++i]; break;
      case '--can-self-stake':
        (args.profile ||= {}).canSelfStake = true; break;
      case '--credentialed-gateway':
        (args.profile ||= {});
        (args.profile.credentialedGateways ||= []).push(argv[++i]);
        break;
      case '-h': case '--help': args.help = true; break;
      default:
        if (a.startsWith('--')) { console.error(`unknown flag: ${a}`); process.exit(2); }
        args._.push(a);
    }
  }
  return args;
}

const HELP = `resolve <serviceId> [options]

Resolve how an agent can reach a POKT service.

Options:
  --probe                      live-probe candidate gateways to confirm they serve it
  --json                       emit raw ServiceAccess JSON
  --network <moniker>          pocketd network (default: main)
  --can-self-stake             agent profile: holds POKT, tolerates session warmup
  --credentialed-gateway <a>   agent profile: a gateway the agent can already use (repeatable)
  -h, --help                   show this help

A recommendation is produced only when an agent profile flag is given.

Probe credentials (optional, read from env; never from files):
  POKT_RPR_NG_KEY              ng- key for turnkey services (web-search, vector-memory)
  POKT_RPR_MODEL_KEY           model provider key for ai-inference (BYOM)
  POKT_RPR_MODEL_ENDPOINT      model base URL (default https://api.deepseek.com)
  POKT_RPR_MODEL_NAME          model name (default deepseek-chat)
  POKT_RPR_APP_ADDRESS         X-App-Address (default: dogfood stake)`;

function fmt(access) {
  const L = [];
  const s = access.service;
  L.push(`service:  ${access.serviceId}${s && s.name ? `  "${s.name}"` : ''}`);
  if (s) {
    const cupr = s.computeUnitsPerRelay != null ? s.computeUnitsPerRelay.toLocaleString() : '?';
    L.push(`          cupr=${cupr}  owner=${s.owner || '?'}`);
  }
  L.push(`callable: ${access.served ? 'YES — suppliers serve it' : 'NO — no supplier serves it'}`);
  L.push('');

  L.push(`DIRECT path (be your own staked app): ${access.direct.available ? 'available' : 'unavailable'}`);
  if (access.direct.available) L.push(`  requires: ${access.direct.requires.join(', ')}`);
  if (access.suppliers.length) {
    const SHOW = 5;
    const sample = access.suppliers.slice(0, SHOW);
    const more = access.supplierCount - sample.length;
    const label = access.supplierCount === access.suppliers.length
      ? `${access.supplierCount} supplier(s):`
      : `${access.supplierCount} supplier(s) (showing ${sample.length}):`;
    L.push(`  ${label}`);
    for (const sup of sample) L.push(`    - ${sup.address}  ${sup.endpoint || '(no endpoint)'}`);
    if (more > 0) L.push(`    … and ${more} more`);
  }
  L.push('');

  L.push(`GATEWAY path (use a gateway's app): ${access.gateways.length} candidate(s)`);
  for (const g of access.gateways) {
    const tag = `[${g.serves}/${g.access}]`;
    L.push(`  - ${g.gateway} ${tag}${g.label ? `  ${g.label}` : ''}`);
    if (g.probe) L.push(`      probe: ${g.probe.reachable}${g.probe.latencyMs != null ? ` (${g.probe.latencyMs}ms)` : ''} — ${g.probe.detail}`);
  }
  if (!access.gateways.length) L.push('  (none — DIRECT is still available for a served service)');

  if (access.recommendation) {
    L.push('');
    const p = access.recommendation.path;
    const pStr = typeof p === 'string' ? p : `gateway ${p.gateway}`;
    L.push(`RECOMMENDATION: ${pStr}`);
    L.push(`  ${access.recommendation.why}`);
  }

  L.push('');
  L.push(`(network=${access.meta.network}, apps scanned=${access.meta.appsScanned}, probed=${access.meta.probed})`);
  return L.join('\n');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || args._.length !== 1) {
    console.log(HELP);
    process.exit(args.help ? 0 : 2);
  }
  const serviceId = args._[0];
  const resolver = new RelayPathResolver({ network: args.network });
  const access = await resolver.resolveAccess(serviceId, args.profile, { probe: args.probe });
  console.log(args.json ? JSON.stringify(access, null, 2) : fmt(access));
}

main().catch((err) => {
  console.error(`error: ${err.message}`);
  process.exit(1);
});
