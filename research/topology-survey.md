# Topology Survey: Resolving a Service's Relay Path from On-Chain Data

**Scope:** Whether `pocketd` can resolve, from on-chain data alone, which suppliers serve a given service (`ai-inference`) and which gateways can relay it — and the query ergonomics of doing so.
**Status:** Yes — resolvable read-only, with caveats. Validated against NodeGhost's known topology — reproduces it exactly.
**Date:** 2026-06-02, mainnet, `pocketd` v0.1.32. Read-only (no tx, no keys).

---

## 1. Query surfaces — what filtering exists

| Module | List command | Service filter? | Pagination | Carries service info? |
|---|---|---|---|---|
| supplier | `list-suppliers` | **YES — `--service-id`** (+ `--operator-address`, `--owner-address`) | page-key/limit, `--page-count-total`, `--dehydrated` | yes — `services[].service_id` |
| application | `list-application` | **NO** — list-all only | `--limit`/`--page`/`--page-key` | yes — `service_configs[].service_id` + `delegatee_gateway_addresses` |
| gateway | `list-gateway` | **NO** — list-all only | `--limit`/`--page`/`--page-key` | **NO** — only `{address, stake, unstake_session_end_height}` |

Key structural fact: **a gateway record carries no service binding.** "Which services can this gateway relay" is *not* a queryable field — it must be **derived** from the applications that delegate to it (`app.service_configs × app.delegatee_gateway_addresses`). The relay-path graph is anchored on the **application** object, which is the only place service↔gateway↔stake all meet.

---

## 2. Suppliers serving `ai-inference`

```
pocketd query supplier list-suppliers --service-id ai-inference --dehydrated --network main -o json
```
**3 suppliers** (one clean filtered query, no client-side filtering):

| Operator address | Services staked |
|---|---|
| `pokt1ke5x7jtcfcxargaahv4sglfr7dufjcqrrq5552` | ai-inference, vector-memory, web-search |
| `pokt18vngxe4ew5nwuhyq5zzuvxwu9rdwtr67smw4me` | ai-inference, vector-memory, web-search |
| `pokt1pp9wxxw4530585s00szza6f09ytaezl2p2szk8` | ai-inference, vector-memory, web-search |

**Total supplier count (scan size if no `--service-id` existed): 5186** (via `--page-count-total`). Raw filtered output saved to `topo-suppliers-ai-inference.json`.

> Note: a `--dehydrated` full pull at `--page-limit 5000` failed with gRPC `ResourceExhausted` (5.5 MB > 4 MB max message). Unfiltered supplier enumeration **must** paginate (≤~1000/page). The `--service-id` filter sidesteps this entirely.

## 3. Applications staking `ai-inference` + their gateway delegations

No service filter → scanned **all 134 applications** (single page at `--limit 1000`) and filtered client-side. **3 apps** stake ai-inference:

| App address | Delegates to gateway |
|---|---|
| `pokt1ecrykpsr87juxcpdn2yxq8mnfrvhrs85dk5y3t` | `pokt1ecryk...` (NodeGhost gateway — self) |
| `pokt1zcutxcp2nw92m8gz4aum8e9lapgztvr7j0d9ay` | `pokt1ecryk...` (NodeGhost gateway) — the dogfood test stake |
| `pokt1dhw9s8czn68uhdxyn9xph0dtaegytk2r8r44kh` | `pokt1whj30rkzv2hz44rswnmcyapuahgx27v8wsw437` (a *different*, third-party gateway) |

## 4. Gateways

```
pocketd query gateway list-gateway --network main -o json
```
**6 gateways total** on mainnet. Both gateways relevant to ai-inference are registered (`pokt1ecryk...`, `pokt1whj30rk...`). Gateway objects carry only address+stake — no service data (see §1).

## 5. Join — relay-path view for `ai-inference`

Derived by inverting the application set (`service_configs ∩ delegatee_gateway_addresses`):

**(a) Suppliers serving it (backends exist):**
`pokt1ke5x...`, `pokt18v...`, `pokt1pp9w...` — the three NodeGhost RelayMiner nodes.

**(b) Gateways that can relay it (have ≥1 ai-inference-staked app delegating to them):**
- `pokt1ecrykpsr87juxcpdn2yxq8mnfrvhrs85dk5y3t` — services carried: **ai-inference, text-generation, vector-memory, web-search** (the NodeGhost gateway).
- `pokt1whj30rkzv2hz44rswnmcyapuahgx27v8wsw437` — a 28-service general-purpose gateway carrying ai-inference alongside chain-RPC services (arb-one, avax, base, bsc, eth, solana, …).

## 6. Validation against known NodeGhost topology

| Expected (known NodeGhost topology) | Survey result | Match |
|---|---|---|
| Gateway `pokt1ecryk...` carries the four services | Derived service set = {ai-inference, text-generation, vector-memory, web-search} | ✅ exact |
| Suppliers `pokt1ke5x...` / `pokt18v...` / `pokt1pp9w...` serve ai-inference | `--service-id ai-inference` returned exactly those three | ✅ exact |
| Dogfood stake `pokt1zcut...` delegates to NG gateway | Appears as ai-inference app → `pokt1ecryk...` | ✅ |

**The method reproduces NodeGhost's topology exactly** — the on-chain join is correct. It also returns a second ecosystem gateway relaying ai-inference (`pokt1whj30rk...`) and the four-service gateway composition. Note: `text-generation` is owned by a separate operator (`pokt1lh9lp8x...`) and is relayed through the NodeGhost gateway by delegation; the gateway-carries-service derivation holds regardless of service ownership.

## 7. Ergonomics verdict

| Relationship | Query shape | Scan size | Clean? |
|---|---|---|---|
| service → suppliers | **one filtered query** (`--service-id`) | 3 returned (5186 total avoided) | ✅ clean, one call |
| service → apps | list-all + client filter (no service filter) | 134 apps, single page | ⚠️ list-all, but tiny |
| service → gateways | **not directly queryable** — derive via apps | join over the 134 apps | ⚠️ derived, no native index |
| gateways (registry) | list-all | 6 | ✅ trivial |

**Plain-RPC-node feasibility: YES at current ecosystem scale — no indexer needed.**
- **Supplier side is ideal:** `--service-id` gives the backend set in one tiny call. (Never enumerate suppliers unfiltered — 5186 rows, and the dehydrated full pull blows the 4 MB gRPC message cap; paginate or filter.)
- **Gateway/relay side is the cost:** there is **no service→gateway index on-chain**. An SDK must list **all** applications (134 today, one page) and build the inverse index `service_id → {gateways}` from `service_configs × delegatee_gateway_addresses`. Cheap now; it scales with total app count (paginated, linear), not with the queried service.
- **No streaming/joins server-side:** the chain gives flat lists; the graph is assembled client-side. For an SDK this is a handful of paginated queries + an in-memory join — entirely feasible against a public RPC endpoint. An indexer only becomes worthwhile if app/supplier counts grow orders of magnitude or you want historical/aggregate views.

**Bottom line for the convention/SDK:** relay-path resolution is on-chain-derivable today with `pocketd`/RPC alone. The clean primitive is `supplier --service-id`; the gap is that **gateway↔service must be reconstructed from the application set** — worth noting as the one place the base layer offers no direct query, and a candidate thing the discovery layer should cache/expose.
