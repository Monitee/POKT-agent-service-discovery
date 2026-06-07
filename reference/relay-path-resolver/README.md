# pokt-relay-path-resolver

Reference tool for the [Agent-Native Service Discovery convention](../../README.md).
Given a POKT service ID, it resolves **how an agent can actually reach the
service** — not just that the service exists.

Discovery tells an agent a service is *described*. This tool tells it whether the
service is *callable*, and by which path.

## The model: served, and two access paths

POKT has exactly two actor models, so a service has exactly two ways an agent can
reach it:

- **DIRECT** — the agent is its own staked application: it stakes, signs its own
  relays, and talks to the suppliers directly. Sovereign, no gateway needed.
- **GATEWAY** — the agent uses someone else's gateway application to relay for it.
  Lower friction, but it depends on a gateway that already serves the service and
  that the agent can access.

**Callability is decided by suppliers, not gateways.** If suppliers serve a
service, it is callable in principle — DIRECT is always available, and a gateway
is a convenience on top. A service is *not callable* only when **no supplier
serves it**. The absence of a gateway never makes a served service uncallable.

> Note: this is the corrected model. An earlier draft of the convention's
> `SPEC.md` §4.4 framed a service with no gateway as "discoverable but not
> callable" — that is a known bug being fixed. This tool implements the
> served-based model above.

## Install / run

No dependencies beyond Node ≥ 20 and a working [`pocketd`](https://docs.pokt.network)
on `PATH` (mainnet read access; no keys, no transactions).

```bash
node bin/resolve.js ai-inference
node bin/resolve.js ai-inference --probe                 # live-confirm gateways
node bin/resolve.js ai-inference --json                  # raw ServiceAccess
node bin/resolve.js ai-inference --can-self-stake        # adds a recommendation
node bin/resolve.js eth --credentialed-gateway pokt1ecryk... --probe
```

As a library:

```js
const { resolveAccess, RelayPathResolver } = require('pokt-relay-path-resolver');

const access = await resolveAccess('ai-inference');
// or reuse a resolver to share the cached gateway index across many services:
const resolver = new RelayPathResolver({ network: 'main' });
const a = await resolver.resolveAccess('web-search', { canSelfStake: true }, { probe: true });
```

## Output: `ServiceAccess`

```jsonc
{
  "serviceId": "ai-inference",
  "served": true,                       // suppliers exist → callable in principle
  "service": { "name": "AI Inference", "computeUnitsPerRelay": 400000, "owner": "pokt1ke5x..." },
  "supplierCount": 3,                   // accurate total
  "suppliers": [                        // bounded SAMPLE (popular services have thousands)
    { "address": "pokt1ke5x...", "operator": "pokt1ke5x...", "endpoint": "http://<supplier-host>:8546" }
  ],
  "direct": { "available": true, "requires": ["app-stake", "wallet", "session-warmup"] },
  "gateways": [                         // candidate relays from the app-set inversion
    { "gateway": "pokt1ecryk...", "label": "NodeGhost", "serves": "candidate", "access": "access-required" }
  ],
  "recommendation": {                   // only when an agent profile is passed
    "path": "direct",                   // 'direct' | { gateway } | 'none' | 'needs-onboarding'
    "why": "..."
  },
  "meta": { "network": "main", "resolvedAt": "...", "probed": false, "appsScanned": 134 }
}
```

### How each field is resolved

- **suppliers** — `supplier list-suppliers --service-id <id>`, one filtered query.
  We return a bounded sample plus the accurate `supplierCount` (via
  `--page-count-total`); we never enumerate the full set, and never query
  suppliers unfiltered (a full pull blows pocketd's 4 MB gRPC message cap).
- **gateways** — the chain has **no** service→gateway index, so candidates are
  *derived* by inverting every application's `service_configs ×
  delegatee_gateway_addresses`. These are **candidates**: on-chain delegation says
  a gateway *could* relay the service, but the final supplier↔gateway wiring is
  off-chain operator config.
- **`serves`** — `candidate` (on-chain says it could) → `confirmed` once a probe
  relay succeeds → `failed` when a probe relay ran but did not succeed →
  `unprobed` when we tried to verify but had no way to (no known relay URL / no
  credentials).
- **`access`** — `public-free` (no key, e.g. an open chain-RPC gateway) vs
  `access-required` (needs a credential or your own delegated stake). Unknown
  gateways default to `access-required` — we never assume a stranger's gateway is
  open.

## Probing: candidate ≠ serves

A gateway listing a service via an app delegation does **not** prove it actually
serves it. `--probe` relays a minimal real request to confirm:

- **chain-RPC services** — a cheap standard read (`eth_chainId`) through a
  public-free gateway → free.
- **our own services** — a hardcoded minimal request per service through our
  gateway → costs CU.

The first slice hardcodes the call contracts for our four services; constructing a
probe from an arbitrary descriptor is **out of scope** (the descriptor/metadata
layer is being protocol-redesigned). Probing is default-safe: where it lacks a
contract, a relay URL, or credentials, it returns `unprobed` rather than guessing.

**The phantom-candidate demonstration.** The broad 28-service gateway
`pokt1whj30rk...` lists `ai-inference` via a delegating app, so it shows up as a
GATEWAY candidate — but it almost certainly does not serve it. That is the live
proof that *candidate ≠ serves*, and it is why the recommendation layer will not
confidently route an agent to an unconfirmed public gateway. A public path is only
recommended once **probe-confirmed**; an unconfirmed gateway is recommendable only
when the agent already holds a credential there (a standing relationship), and even
then the recommendation says to verify.

### Probe credentials

Read from the environment at call time — **never** from any file. Absence of a
credential just degrades the corresponding probe to `unprobed`.

| Env var | Used for |
|---|---|
| `POKT_RPR_NG_KEY` | turnkey services (web-search, vector-memory) |
| `POKT_RPR_MODEL_KEY` | `ai-inference` BYOM model-provider key |
| `POKT_RPR_MODEL_ENDPOINT` | model base URL (default `https://api.deepseek.com`) |
| `POKT_RPR_MODEL_NAME` | model name (default `deepseek-chat`) |
| `POKT_RPR_APP_ADDRESS` | `X-App-Address` (default: the dogfood stake) |

## Scope

**In:** topology resolution (suppliers + gateway-index inversion), known/standard
probes, public-vs-access classification, the two-path model, the recommendation
layer, the CLI.

**Out (deferred):** descriptor/metadata parsing, validation, or generation;
descriptor-driven probe construction; capability/type matching. Those belong to the
schema layer, which is under protocol redesign.

## Architecture

```
bin/resolve.js        thin CLI
src/index.js          public entry point
src/resolver.js       resolveAccess() + the recommendation/decision layer
src/transport.js      Transport interface; PocketdTransport (swap to direct RPC later)
src/gateway-index.js  app-set inversion → candidate gateways (cached, short TTL)
src/probe.js          category-aware, known-contracts-first reachability probe
src/config.js         known gateways, call contracts, env-cred reader
src/cache.js          tiny TTL cache (index + supplier lists; probes stay live)
```

The `Transport` interface is the seam for moving off the `pocketd` CLI to a direct
gRPC/RPC client later — the resolver only knows the three read methods.
