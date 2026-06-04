# On-Chain POKT Service Metadata Survey

**Status:** Read-only survey, complete.
**Queried:** 2026-06-02, mainnet (`--network main`), `pocketd` v0.1.32, block height 780268 (node synced, not catching up).
**Raw source of truth:** `phase0-raw.json` (verbatim responses + provenance). Also `ai-inference-raw.json`, `all-services-full.json`.

## Method

Confirmed flag syntax first via `--help` (the doc's `--dehydrated=false` is correct for this release):
- `show-service [id]` — includes metadata **by default**; `--dehydrated` excludes it.
- `all-services` — excludes metadata by default; **`--dehydrated=false` includes it.**

Commands run (read-only; no `tx` commands, ai-inference metadata untouched):
```
pocketd query service show-service ai-inference --network main --output json
pocketd query service all-services --dehydrated=false --network main --output json --page-limit 300
```
Pagination: `all-services` reported `total: 173`, returned 100 on the default page. Re-ran with `--page-limit 300` → all **173** services in one response, empty `pagination` (complete; nothing dropped).

---

## The headline finding

**Across all 173 services on mainnet — including our own `ai-inference` — the queryable on-chain service record contains exactly four fields and nothing else:**

```
id   name   compute_units_per_relay   owner_address
```

- `metadata` field: **absent / empty on 100% of services (0 / 173).** Even with `--dehydrated=false`, no service returned any metadata payload. (Proto3 JSON omits empty `bytes`, so "absent" = "empty.")
- There is **no `description` field** in v0.1.32 output — the only human-readable free-text field is **`name`**.

The metadata feature is not merely "largely unused" — it is **entirely unused on mainnet.** No service carries a metadata payload, so the field is open territory for a convention to define.

---

## Our `ai-inference` metadata field

**Nothing.** `show-service ai-inference` (metadata included by default) returns only:
```json
{ "service": {
    "id": "ai-inference",
    "name": "AI Inference",
    "compute_units_per_relay": "400000",
    "owner_address": "pokt1ke5x7jtcfcxargaahv4sglfr7dufjcqrrq5552" } }
```
No `metadata` key. Text output (`-o text`) confirms — same four fields.

ai-inference's metadata field is blank today. The history: on 2026-03-28 it was first registered at compute_units_per_relay 5000 with no metadata, then a follow-up `add-service` attached metadata via `--experimental-metadata-file` (a JSON payload with a description and an `endpoints.chat` field). That tx landed (code 0) and the metadata was confirmed visible in the raw query output at the time — POKTscan's UI didn't render it, but the chain returned it.

What overwrote it: today's record shows compute_units_per_relay **400000**, not the original 5000. A later `add-service` changed the cost-per-relay; because updates replace the ENTIRE payload, that update dropped the metadata by not re-including the file. The cause is full-payload-replace update semantics — not a persistence failure, wrong network, or v0.1.32 rendering gap. The read path does surface metadata when present, so the 0/173 result reflects genuine ecosystem emptiness, not a rendering artifact.

There is no live metadata to inspect today — our service is blank — but it is trivially restorable.

Ownership scope: of the "four staked services," three are owned by our Supplier Node 1 address (`pokt1ke5x...`): `ai-inference`, `vector-memory`, `web-search`. **`text-generation` is owned by a separate operator** (`pokt1lh9lp8x...`) and is reached through the NodeGhost gateway by delegation — not ours to update. Metadata writes are scoped to the three services we own.

## Ecosystem metadata coverage

| | count |
|---|---|
| Total services on mainnet | **173** |
| With non-empty `metadata` | **0** |
| With empty/absent `metadata` | **173 (100%)** |

No service in the ecosystem has attached an API spec, so a convention defined here would be the first on-chain.

## Existing on-chain metadata formats

**N/A — zero services carry metadata, so there is no existing format to conform to or diverge from.** No OpenAPI, no OpenRPC, no freeform — nothing. There is no de-facto precedent on-chain. Any convention defined here is unconstrained by prior on-chain art (constrained only by the base-layer fields and the 256 KiB cap).

---

## Secondary observations

1. **`name` is the only populated human-readable field, and operators are already overloading it as a description.** Most names are short labels (median 11 chars, e.g. "Bitcoin", "Base", "AI Inference"). But **13 services stuff full sentences into `name`** (max 138 chars) — e.g. `text-generation` → *"machine learning task of generating text given another text - Large language models of medium size are included here"*, `object-detection`, `text-to-image`, etc. (the HuggingFace-task-style services). This is direct evidence that **operators want a description channel and, lacking one, abuse `name`.** A convention that gives them a real place to put it is solving a problem people are already hitting.

2. **`compute_units_per_relay` is populated and meaningful on every service** (range observed 1 → 400000). So *cost-per-relay discovery already works today* with zero convention — it's the API-contract / "how do I call this" half that has no on-chain answer.

3. **ID namespace is already messy** — duplicate/aliased services exist: `arb-one` vs `arb_one`, `arb-sepolia-testnet` vs `arb_sep_test`, `base-test` vs `base-testnet` vs `base-sepolia-testnet`, `giwa-sepolia` vs `giwa-sepolia-testnet`. An agent can't rely on ID naming conventions to disambiguate; this argues for the convention carrying explicit machine-readable identity/typing rather than inferring from the ID string.

4. **The on-chain record is tiny and the metadata field (256 KiB) is the *only* place a real call contract could live.** There's no description field, no tags, no endpoint hints in the base record — so the convention's payload has to carry essentially everything an agent needs beyond {name, cost, owner}.

5. **On-chain metadata is fragile by update semantics — a footgun.** Updates replace the entire service payload, so ANY routine update (changing compute_units_per_relay, renaming) silently wipes metadata unless the owner re-supplies the full metadata file every time. Our own ai-inference is the proof: metadata was attached in March, then erased by a later cost-per-relay update. This is plausibly a *partial cause of ecosystem-wide emptiness* — not purely "nobody attached it," but "attached once, then wiped by a later update." A convention that expects agents to rely on present, current on-chain metadata must confront this: either tooling that refuses to emit an update without the metadata file, or treating the on-chain payload as a durable pointer rather than the canonical store.

---

## What the base layer constrains

- We are defining on a blank slate — no on-chain precedent to be compatible with.
- The base layer gives us only: stable `id`, free-text `name`, `compute_units_per_relay`, `owner_address`. Everything else an agent needs must come from the metadata payload (≤256 KiB) or off-chain pointers within it.
- Our own `ai-inference` has no metadata to preserve, so its descriptor can be authored fresh.
- Operators are already signalling demand for a description channel by abusing `name`.
- Metadata persistence is not automatic. Full-payload-replace update semantics mean the convention needs an operational discipline (or tooling guardrail) to keep metadata from silently rotting on routine service updates.
