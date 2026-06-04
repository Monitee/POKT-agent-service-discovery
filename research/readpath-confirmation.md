# Read-Path Confirmation: ai-inference Metadata Restore

**Status:** Confirmed — the read path surfaces on-chain metadata on both discovery surfaces. The payload written is an interim probe, not the convention itself.
**Date:** 2026-06-02, mainnet, `pocketd` v0.1.32.

## The write (one tx, on a service we own)

`add-service` on `ai-inference`, preserving cupr=400000, attaching the interim probe payload (`ai-inference-metadata-probe.json`) via `--experimental-metadata-file`.

- **txhash:** `07C4E2700E5D9A523F39EA466AF12CD1C111C31BBBB024D590383BC5285C9179`
- **committed block height:** `780304`
- **code:** `0` (`/pocket.service.MsgAddServiceResponse`), gas_used 62544 / 300000
- Mempool admission (height 0) was confirmed first, then commit verified via `pocketd query tx ... -o json` showing a real height + code 0.

## `show-service` read path

```
pocketd query service show-service ai-inference --network main -o json
```

Returned service keys: `compute_units_per_relay, id, metadata, name, owner_address`. The `metadata` field is now present (was absent across all 173 services pre-write). Structure:

```json
"metadata": { "experimental_api_specs": "<base64>" }
```

**Field name in v0.1.32 is `metadata.experimental_api_specs`** (base64-encoded bytes). Base64-decoded payload is **byte-identical** to the local probe file (`decoded == local` → True; parsed-JSON equal → True). The payload round-trips intact — no truncation, no re-encoding, UTF-8 em-dashes preserved.

## `all-services` ecosystem sweep — the discovery surface

```
pocketd query service all-services --dehydrated=false --network main -o json --page-limit 300
```

**Metadata appears in the ecosystem sweep too — NOT show-service-only.** `ai-inference` in the `all-services` result carries the same key set including `metadata`, with the full `experimental_api_specs` base64 present. This is the surface an agent actually discovers through (enumerate all services + read their specs in one query), so the discover→understand loop can run purely off `all-services --dehydrated=false`. Confirmed working end-to-end.

- Total services: **173** (unchanged).
- Services with metadata now: **1 of 173 — only `ai-inference` (us).** This both (i) confirms the read path surfaces metadata when present, and (ii) re-validates that the earlier 0/173 result was genuine ecosystem emptiness, not a rendering artifact. We are demonstrably first.

## Pricing preservation check

`compute_units_per_relay` reads **`400000`** on BOTH surfaces (`show-service` and `all-services`). The full-payload-replace update preserved the live service's pricing — we did not re-price it. id/name/owner also unchanged (`ai-inference` / `"AI Inference"` / `pokt1ke5x7jtcfcxargaahv4sglfr7dufjcqrrq5552`).

## Conclusions

- The read path is proven: write metadata → it is queryable, intact, on both `show-service` and `all-services --dehydrated=false`.
- On-chain field is `metadata.experimental_api_specs`, base64-encoded freeform bytes (no schema enforced by the chain — the chain stores and returns opaque bytes).
- Agents can rely on a single `all-services --dehydrated=false` call to enumerate + read specs; no per-service `show-service` fan-out required.
- The attached payload is an **interim probe**, explicitly flagged in its own `note` field to be replaced by a convention-conformant descriptor. It is not itself the convention.
