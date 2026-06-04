# Agent-Native Service Discovery Convention for POKT — v0.1 (draft)

**Status:** Draft for internal review, then to float past POKT contacts before building on it.
**Author:** Jaren (NodeGhost)
**Date:** 2026-06-03
**Basis:** the Phase 0 on-chain surveys — metadata, read-path, topology — run against mainnet on `pocketd` v0.1.32.

A convention for how a POKT service describes itself so an AI agent can find it, work out how to call it, and judge what it costs — from on-chain data plus an optional, integrity-checked off-chain spec. It is not a protocol change. It lives entirely inside the existing `metadata.experimental_api_specs` field, as a shared convention over bytes the chain otherwise treats as freeform.

---

## 1. The problem

A POKT service exposes almost nothing on-chain. Surveying mainnet, every service carries four queryable fields — `id`, `name`, `compute_units_per_relay`, `owner_address` — plus one freeform slot, `metadata.experimental_api_specs`, holding up to 256 KiB of bytes the chain neither parses nor validates. That slot was empty across all 173 services until we wrote a test payload to our own; for practical purposes it's unused ecosystem-wide.

It's also the only place a real "how do I call this" contract can live, and with no shared convention for what goes in it, an agent can't read one service's metadata against another's. Three symptoms turned up in the survey:

- There is no description field in v0.1.32, only `name` — and operators are already stuffing sentence-length descriptions into `name` (thirteen of them do, up to 138 characters). The demand for a description channel is real and unmet.
- IDs aren't semantic. The namespace is messy already (`arb-one` beside `arb_one`, three spellings of base-testnet), so an agent can't tell what a service does from its ID.
- Cost discovery already works — `cupr` is populated everywhere — but the call contract has nowhere to live.

We're early enough to define the convention that fills the slot instead of inheriting one. That's the opening.

---

## 2. Principles

Each of these comes from what the surveys actually found, not from preference.

**Thin descriptor, spec behind a pointer.** The on-chain payload stays small; a full API spec, when one is needed, lives off-chain and the descriptor points to it. Inlining full specs doesn't scale — a bulk `--dehydrated=false` enumeration carrying 256 KiB specs across every service balloons fast (173 services at even 10 KB each is ~1.7 MB a call, and it grows with the ecosystem), the metadata is fragile (§6), and rewriting a large on-chain blob costs gas. The chain already strips metadata from bulk queries by default, which reads as a deliberate nudge toward two-tier discovery. Thin descriptors keep even a full bulk pull cheap — roughly 86 KB for all 173 fully populated.

**Storage-agnostic pointer, integrity required.** A pointer is any resolvable URI, `ipfs://` or `https://`, plus a way to verify the content. The integrity check is what lets the spec live anywhere: tampering is detectable regardless of host, so the convention doesn't have to bless one storage backend, which keeps it an open standard rather than a captured one. An `ipfs://` CID gives integrity for free; an `https://` pointer carries an on-chain SHA256.

**The owner's descriptor is authoritative.** Only the service owner can write `experimental_api_specs`, so the owner's declaration is canonical. Suppliers serving the service ID are trusted to conform; the chain doesn't enforce it (§7).

**Degrade gracefully.** If an off-chain spec goes unreachable, the agent still holds the on-chain descriptor — type, summary, provisioning, pricing — so discovery and routing survive and only the bespoke call-schema is lost. That's reason enough to keep the descriptor self-sufficient for well-known interfaces, so the common case needs no fetch at all.

**Say what it leaves out.** The convention deliberately omits anything the base layer already answers or that belongs to a different layer — gateways, relay-auth, suppliers (§5). A wrong tool is a bug you fix; a wrong convention propagates to everyone who adopts it, so the bar is to add only what isn't already on-chain.

---

## 3. The descriptor

A single UTF-8 JSON object in `metadata.experimental_api_specs`:

```json
{
  "convention": "pokt-agent-service/v0.1",
  "type": "text-embedding",
  "summary": "Embeds text into 1024-dim vectors. OpenAI-compatible embeddings interface.",
  "provisioning": "turnkey",
  "interface": {
    "profile": "openai-embeddings/v1"
  },
  "pricing": {
    "model": "per-relay",
    "response_envelope": { "typical_tokens": 512, "max_tokens": 8192 }
  },
  "updated": "2026-06-03T00:00:00Z"
}
```

The fields:

- **`convention`** (required) — the convention and version this descriptor follows, e.g. `pokt-agent-service/v0.1`. An evolving standard needs an explicit version so a reader knows how to parse it and so the schema can change without silently breaking consumers. It's the first thing the SDK checks; an unknown convention means skip or degrade.

- **`type`** (required) — a machine-matchable capability identifier (`text-generation`, `text-embedding`, `web-search`, `chain-rpc`, and so on). This is what an agent filters on, rather than the messy `id` or the free-text `name`. Whether to reuse an existing vocabulary or define our own is an open question (§7).

- **`summary`** (required) — a short natural-language description for matching against a task. This is the description channel operators are currently faking with `name`. Bounded (proposed ≤256 chars) to keep descriptors thin.

- **`provisioning`** (required) — `turnkey` or `byom`. Whether an agent can call directly, or has to set something up first, typically registering its own backend. Not every service is call-and-go: NodeGhost's `ai-inference` is BYOM by design. For a BYOM service the setup steps belong in the `interface` spec, since registering a backend is itself an API call. An agent that ignores this on a BYOM service will build a perfectly valid request that routes to nothing.

- **`interface`** (required, one of):
  - **`profile`** — a named, well-known interface the SDK already understands (`openai-chat/v1`, `openai-embeddings/v1`). Fully on-chain, no fetch. Use it whenever a service speaks a standard contract.
  - **`spec`** — for bespoke contracts: `{ "uri": "ipfs://… | https://…", "format": "openapi" | "openrpc", "sha256": "…" }`. SHA256 is required for `https://`; an `ipfs://` CID already covers integrity, so the hash is optional there. The agent fetches, verifies, parses, and builds a tool definition.

- **`pricing`** (recommended) — the budgeting hint. `model` is `per-relay`, the only thing the base layer meters. `response_envelope` declares the expected output size (`typical_tokens` / `max_tokens`, or a row/byte analog for non-LLM services). This is what turns per-relay pricing from illegible into usable: a fixed-cost backend can honestly state its envelope, and an agent can estimate cost from `cupr` plus the envelope before it calls. It doesn't repeat `cupr`; it adds only what the chain leaves out.

- **`updated`** (recommended) — ISO timestamp of the descriptor content, for caching and staleness checks.

- **`gateway_hint`** (optional) — a single convenience relay path, usually the owner's own gateway, for agents that don't want to resolve relay-path from topology or self-stake. A courtesy, and explicitly not an authoritative gateway list (§5).

- **`x`** (optional) — namespaced extension space for additions that don't warrant a version bump.

### Two worked examples

A turnkey service (`web-search`, illustrative):
```json
{
  "convention": "pokt-agent-service/v0.1",
  "type": "web-search",
  "summary": "Web search returning ranked results with titles, URLs, and snippets.",
  "provisioning": "turnkey",
  "interface": { "spec": { "uri": "ipfs://<cid>", "format": "openapi" } },
  "pricing": { "model": "per-relay", "response_envelope": { "typical_results": 10 } },
  "updated": "2026-06-03T00:00:00Z"
}
```

A BYOM service (`ai-inference`, illustrative — bring-your-own-model plumbing):
```json
{
  "convention": "pokt-agent-service/v0.1",
  "type": "text-generation",
  "summary": "OpenAI-compatible inference relay. Bring your own model/backend (self-hosted or TEE, e.g. Acurast); register it, then call.",
  "provisioning": "byom",
  "interface": {
    "spec": { "uri": "ipfs://<cid>", "format": "openapi", "sha256": "<hex>" }
  },
  "pricing": { "model": "per-relay", "note": "Token cost sits on the operator's own fixed-cost backend, not metered per-token." },
  "updated": "2026-06-03T00:00:00Z"
}
```
The BYOM spec has to document the register-backend step alongside `/v1/chat/completions`, since "register a backend" isn't part of the standard OpenAI profile.

---

## 4. Discovery to call

What an agent, through the SDK, actually does:

1. **Enumerate.** One `all-services --dehydrated=false` pulls every thin descriptor cheaply, and the SDK caches it as a discovery index. Because the descriptors are small, there's no need to enumerate-then-rehydrate them one at a time — they come in bulk.
2. **Match and budget.** Filter the index on `type` and `summary` against the task, pick a service, and estimate cost from on-chain `cupr` plus the descriptor's `pricing.response_envelope`.
3. **Understand the contract.** A `profile` means the SDK already knows the contract and builds the tool definition directly, no fetch. A `spec` means fetch it off-chain, verify against the CID or SHA256, parse, and generate the tool definition.
4. **Resolve the relay path, and check reachability.** Suppliers come from `supplier list-suppliers --service-id <id>` in one query; candidate gateways come from inverting the application set (`service_configs × delegatee_gateway_addresses`), which the SDK builds and caches since the chain has no native query for it. Reachability gets decided here too: the on-chain join yields *candidate* gateways — the supplier↔gateway wiring is partly off-chain operator config — so the SDK narrows to candidates and confirms with a cheap probe relay. No candidate gateway means the service is discoverable but not callable; treat it as unavailable. Otherwise pick a confirmed gateway the agent can reach.
5. **Provision if needed.** For a BYOM service, run the setup the spec describes (register a backend) before calling.
6. **Call.** Build the relay — target service ID, the app-layer request as the payload, gateway-specific relay auth — and send it.

Steps 1–3 are the convention's core, and they run off on-chain data plus an optional verified fetch. Steps 4–6 ride on POKT's existing relay mechanics; what the convention adds there is making the relay path resolvable, not redefining how relays work.

---

## 5. What it leaves out, and why

- **Gateway lists.** Relay-path is derivable on-chain (the topology survey: suppliers by `--service-id`, gateways by inverting the app set). A gateway list inside a per-service descriptor would be unmaintainable — which services a gateway serves is operator-configured and shifts over time, it's already derivable on-chain, and a copy in the descriptor would only duplicate chain state and drift. The chain is the source of truth and the SDK joins it. The one concession is the optional `gateway_hint`.
- **Relay-layer auth.** How an agent authenticates to a gateway is the gateway's policy, varies by gateway, and is part of the agent's standing relationship with it — not a per-service fact. Application-layer auth, what the backend itself expects, lives in the `interface` spec's security schemes. So there's no relay-auth field here.
- **Suppliers.** Already on-chain and queryable per service. No reason to copy them in.

One thing this leans on, worth stating plainly: a gateway relays only the services it's configured for — both the on-chain delegation and the supplier wiring have to be in place. A gateway isn't a universal relay that any app can push arbitrary services through; delegated mode lets external apps use a gateway's existing menu, it doesn't extend that menu. That's exactly why relay-path resolution matters, and why discoverability and reachability are not the same thing. A service can carry a perfectly good descriptor and still be uncallable because nothing relays it. So the relay-path step (§4.4) doubles as a reachability check, with one limit: on-chain data shows candidate paths (a gateway with a delegated app for the service, plus staked suppliers), while the final supplier↔gateway wiring is operator config the chain doesn't expose — a probe relay is what confirms a path is actually live. If there's no candidate gateway at all, the service is described but not callable until someone stands up that configuration.

So the agent's relay on-ramp is access to a gateway already configured for the service it needs — a credential on one, or its own app stake delegated to one — set up once and reused across every service that gateway serves. This is where NodeGhost sits: it configures gateway and suppliers so the services it offers are reachable, and its agent onboarding is one way an agent gets onto that menu.

---

## 6. Keeping metadata alive

POKT service updates replace the entire metadata payload. Any routine change — a new `cupr`, a rename — silently wipes the metadata unless the owner re-supplies the full file every time. Our own `ai-inference` is the proof: metadata attached in March, then erased by a later cost-per-relay update, which is plausibly part of why the field sits empty across the ecosystem.

So the convention comes with a rule, and the reference tooling has to enforce it: every service update carries the complete descriptor forward. A tool that emits an update without the current metadata is a footgun, and the CLI should refuse to do it or warn loudly.

---

## 7. Open questions

1. **Capability taxonomy.** Reuse an existing vocabulary for `type` — the HuggingFace-style task names already appearing on-chain — or define our own? Reuse helps interoperability; a custom set fits POKT's mix of AI and chain-RPC services better.
2. **Conformance and trust.** The descriptor is owner-authored, but supplier conformance to it isn't enforced on-chain. A service ID is a routing label, not a guarantee of uniform backend behavior — it's uniform for `ai-inference` today only because all its suppliers are ours. How much should the convention say about trust, and is a conformance signal worth it?
3. **Integrity for `ipfs://`.** Let the CID stand on its own as the integrity guarantee, or still require an on-chain SHA256 for consistency across pointer types?
4. **`experimental_api_specs` stability.** The field is flagged experimental and subject to change upstream. The convention depends on it, so it's worth confirming POKT's intent for the field before building deep — and this convention is a concrete answer to the "TODO: coming soon" sitting on it today.
5. **BYOM expression.** Is a `provisioning` enum plus setup-in-the-spec enough, or does BYOM deserve a first-class structured field — the register endpoint, the expected backend contract?
