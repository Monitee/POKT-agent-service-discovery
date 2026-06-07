'use strict';

// Static knowledge the chain doesn't expose.
//
// On-chain data gives gateway *addresses*, not the HTTP relay URLs an agent
// actually POSTs to, nor whether a gateway is open or key-gated. Those are
// off-chain facts. This file is the small, honest seam of known-contract
// knowledge the "known-contracts-first" probe needs — and the place a future
// gateway self-declaration (Issue 6) would augment or replace.

// The dogfood app stake (public address) used as X-App-Address for native-path
// probes. Not a secret — it's a published mainnet address.
const DOGFOOD_APP_ADDRESS = 'pokt1zcutxcp2nw92m8gz4aum8e9lapgztvr7j0d9ay';

const NODEGHOST_GATEWAY = 'pokt1ecrykpsr87juxcpdn2yxq8mnfrvhrs85dk5y3t';

// Gateways we can say something concrete about. Anything not listed defaults to
// access:'access-required' (conservative — never assume a stranger's gateway is
// free) and has no relay URL, so it stays a candidate we can't probe.
const KNOWN_GATEWAYS = {
  [NODEGHOST_GATEWAY]: {
    label: 'NodeGhost',
    access: 'access-required',
    relayBaseUrl: 'https://nodeghost.ai',
  },
  pokt1whj30rkzv2hz44rswnmcyapuahgx27v8wsw437: {
    label: 'broad chain-RPC gateway (28 services)',
    access: 'public-free',
    // No published relay URL known → cannot probe → this is the phantom
    // candidate: it LISTS ai-inference via a delegating app, but on-chain
    // candidacy alone never proves it actually serves it.
    relayBaseUrl: null,
  },
};

// Read probe credentials from the environment at call time. We never read .env
// or any secret file — the operator populates these in their own shell. Absence
// of a credential just means the corresponding probe degrades to 'unprobed'.
function readEnvCreds(env = process.env) {
  return {
    ngKey: env.POKT_RPR_NG_KEY || null,
    modelKey: env.POKT_RPR_MODEL_KEY || null,
    modelEndpoint: env.POKT_RPR_MODEL_ENDPOINT || 'https://api.deepseek.com',
    modelName: env.POKT_RPR_MODEL_NAME || 'deepseek-chat',
    appAddress: env.POKT_RPR_APP_ADDRESS || DOGFOOD_APP_ADDRESS,
  };
}

const JSON_HEADERS = { 'Content-Type': 'application/json' };

// Hardcoded call contracts for the first slice — our own services. Each builder
// returns { url, init } for a minimal real relay, or null when it lacks the
// credentials to make one (→ 'unprobed'). isSuccess decides reachability from
// the response. The general "construct a probe from an arbitrary descriptor"
// case is deliberately out of scope (descriptor layer is being redesigned).
const PROBE_CONTRACTS = {
  // BYOM native-POKT path: model key + endpoint + app address travel in the
  // request, the gateway relays to a supplier, pokt-proxy reconstructs auth.
  'ai-inference': {
    category: 'byom',
    build({ baseUrl, creds }) {
      if (!creds.modelKey) return null;
      return {
        url: `${baseUrl}/pokt/v1/chat/completions`,
        init: {
          method: 'POST',
          headers: {
            ...JSON_HEADERS,
            Authorization: `Bearer ${creds.modelKey}`,
            'X-Endpoint': creds.modelEndpoint,
            'X-App-Address': creds.appAddress,
          },
          body: JSON.stringify({
            model: creds.modelName,
            messages: [{ role: 'user', content: 'Reply in English with the single word: ok' }],
            max_tokens: 1,
          }),
        },
      };
    },
    isSuccess(res, body) {
      return res.ok && typeof body === 'object' && Array.isArray(body.choices);
    },
  },

  'web-search': {
    category: 'turnkey',
    build({ baseUrl, creds }) {
      if (!creds.ngKey) return null;
      return {
        url: `${baseUrl}/v1/tools/search`,
        init: {
          method: 'POST',
          headers: { ...JSON_HEADERS, Authorization: `Bearer ${creds.ngKey}` },
          body: JSON.stringify({ query: 'ping', count: 1 }),
        },
      };
    },
    isSuccess(res) {
      return res.ok;
    },
  },

  'vector-memory': {
    category: 'turnkey',
    build({ baseUrl, creds }) {
      if (!creds.ngKey) return null;
      return {
        url: `${baseUrl}/v1/memory/recall`,
        init: {
          method: 'POST',
          headers: { ...JSON_HEADERS, Authorization: `Bearer ${creds.ngKey}` },
          // owner_token in body too: the relay path strips Authorization.
          body: JSON.stringify({ namespace: 'probe', query: 'ping', owner_token: creds.ngKey }),
        },
      };
    },
    isSuccess(res) {
      return res.ok;
    },
  },

  // text-generation is owned by a third party (pokt1lh9lp8x...), not us, so we
  // have no authoritative contract for it. Left contract-less on purpose →
  // 'unprobed' rather than a guessed request.
};

// Heuristic: does this service id look like a chain-RPC endpoint? Such services
// take a standard cheap read (eth_chainId) and, through a public-free gateway,
// probe for free. We keep the contract here but it only fires when a public
// gateway with a known relay URL is configured (none today → unprobed).
const CHAIN_RPC_HINT = /^(eth|base|bsc|avax|arb|arbitrum|op|optimism|poly|polygon|matic|sol|solana|near|sui|fuse|gnosis|fantom|ftm|celo|moonbeam|kava|scroll|linea|blast|metis|zksync|ink)\b/i;

const CHAIN_RPC_PROBE = {
  category: 'chain-rpc',
  build({ baseUrl }) {
    if (!baseUrl) return null;
    return {
      url: baseUrl,
      init: {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }),
      },
    };
  },
  isSuccess(res, body) {
    return res.ok && typeof body === 'object' && (body.result != null || body.error == null);
  },
};

function looksLikeChainRpc(serviceId) {
  return CHAIN_RPC_HINT.test(serviceId);
}

module.exports = {
  DOGFOOD_APP_ADDRESS,
  NODEGHOST_GATEWAY,
  KNOWN_GATEWAYS,
  PROBE_CONTRACTS,
  CHAIN_RPC_PROBE,
  readEnvCreds,
  looksLikeChainRpc,
};
