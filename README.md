# POKT Agent-Native Service Discovery

A convention for how a Pocket Network service describes itself so that AI agents can discover it, work out how to call it, and judge what it costs — from on-chain data plus an optional, integrity-checked off-chain spec.

**Status:** v0.1 draft. This is a proposal, not a finished standard — the open design questions are tracked as [issues](../../issues), and input from the POKT ecosystem is exactly what this stage is for.

## The idea in one line

Self-describing services for AI agents: a service announces what it does and how to call it, so an agent can find and use it on its own — without a human wiring anything up.

## Why

A Pocket service exposes almost nothing on-chain today — `id`, `name`, `compute_units_per_relay`, `owner_address`, plus one freeform metadata slot, `experimental_api_specs`, that is effectively unused across the network. That slot is the only place a real "how do I call this" contract can live, and with no shared convention for what goes in it, an agent can't read one service's metadata against another's.

This convention fills the slot. It's a concrete answer to the "TODO: coming soon" sitting on the experimental metadata feature. It is not a protocol change — it lives entirely inside `experimental_api_specs` as a shared convention over bytes the chain otherwise treats as freeform.

## Grounded in what's actually on-chain

The design isn't theoretical. It comes out of surveying mainnet directly (see [`/research`](./research)):

- The metadata slot is empty across the ecosystem — early enough to define the convention rather than inherit one.
- A service's relay path (which suppliers serve it, which gateways can relay it) is derivable from on-chain topology, so the descriptor doesn't need to carry it.
- Service metadata is wiped by any routine service update unless re-supplied — a fragility the convention accounts for, and which is a candidate for a protocol-level fix.

## How it works

A thin JSON descriptor in `experimental_api_specs` carries what an agent needs: a capability type, a short summary, the call contract (either a known interface profile or a pointer to an off-chain spec with an integrity hash), and pricing legibility. A full API spec, when one is needed, lives off-chain behind a verifiable pointer, keeping the on-chain payload small and bulk discovery cheap.

The full design is in [`SPEC.md`](./SPEC.md).

## Relationship to ERC-8004

This is the **discovery / service-capability** layer, and it complements ERC-8004's trust layers rather than duplicating them. ERC-8004 answers *who is this agent and can I trust it* (identity, reputation, validation); this convention answers *what does this service do and how do I call it*. The two compose cleanly: an agent discovers and calls a self-describing service through this convention, and leans on the ERC-8004 trust layers — including POKT's proposal that turns the supplier set into a multi-validator validation network — for trust.

## Contributing

The open questions for v0.1 are filed as [issues](../../issues): capability taxonomy, conformance and trust, pointer integrity, field stability, and how to express bring-your-own-model services. Open a new issue or weigh in on an existing one — this is the stage where ecosystem input shapes the convention.

## License

[CC0 1.0](./LICENSE) — public domain. Adopt, fork, and build on this freely. It's meant to be an open convention, not a captured one.
