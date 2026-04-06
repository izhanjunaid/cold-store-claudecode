# Phase 1: Domain Exploration — Agri Cold Storage & Mandi Ecosystem

> **Scope**: Lahore, Pakistan | Agri cold storage integrated with mandi trade flows  
> **Date**: March 2026

---

## 1. Ecosystem Overview

Pakistan's mandi (wholesale agricultural market) system is the central node through which agricultural produce—vegetables, fruits, and other perishables—flows from producers (farmers) to end buyers (retailers, exporters, processors). Cold storage facilities in this ecosystem serve as **buffer nodes** that extend the economic life of perishable produce beyond the harvest window.

In Lahore's peri-urban and mandi-adjacent zones, cold stores are not passive warehouses. They are **active financial and operational intermediaries** that:

- Hold produce owned by multiple parties simultaneously
- Enable price speculation by allowing farmers/traders to delay sale
- Serve as collateral sites for informal credit
- Facilitate produce quality management across variable seasonal conditions

This makes the system structurally different from a standard 3PL warehouse. The cold store operator is simultaneously a **service provider**, **credit facilitator**, **quality custodian**, and **operational intermediary** in the supply chain.

---

## 2. Key Actors

### 2.1 Farmer (Kisan / Producer)
- Brings post-harvest produce to the cold store, either directly or via a commission agent
- May or may not have marketing capability — many are price-takers
- Often stores produce to wait for better market prices
- Has weak digital literacy; interactions are predominantly verbal/paper-based
- May not own transportation; relies on contracted vehicles (trucks/pickups)
- Credit-dependent: typically owes money to input suppliers and/or commission agents

### 2.2 Commission Agent (Arhtis / Arthiya)
- Central actor in the mandi supply chain; officially charges 2–4% commission on produce sold
- Operates as a **de facto financier**: advances cash to farmers before harvest (advance credit), then recovers it from sale proceeds
- Acts as intermediary, aggregator, and sometimes co-owner of stored produce
- Has trust relationships with cold store operators — informal billing runs on credit with settlement cycles
- Often decides **when** produce is taken to market based on price intelligence
- Maintains handwritten or informal digital ledgers (sometimes WhatsApp-based records)

### 2.3 Trader / Speculator (Trader/Commission Buyer)
- Purchases produce in bulk, often not physically; uses cold storage as a speculation platform
- May buy produce still in the field (standing crop purchase) or post-harvest in the cold store
- Stores purchased produce in the cold store under own name and withdraws to sell when prices are favorable
- Has strong price intelligence networks (WhatsApp groups, mandi informants)
- Often leverages banked relationships with the cold store on favorable credit terms

### 2.4 Cold Store Operator (Cold Store Owner / Manager)
- Owns and operates the refrigerated facility
- Manages stock on behalf of multiple clients simultaneously
- Issues storage receipts (kachchi parchi / confirmed receipts)
- Charges for storage (per unit per day/week, or seasonal lump sum), handling, and services
- Often extends informal credit (delayed billing, advance services) to trusted clients
- Key operational challenge: tracking multi-owner stock at lot level within shared chambers

### 2.5 Transporter / Carrier
- Contracted for bringing produce from fields/mandis to cold stores, and for dispatch from cold stores to buyers
- Weight discrepancies between farm weight and cold store weight are common and disputed
- Cold store records inbound weight at receipt; outbound weight at delivery

### 2.6 Buyer (Retailer / Exporter / Processor / Mandi Buyer)
- Purchases produce from the cold store or via commission agent
- May receive produce at the cold store gate or require delivery
- Payment terms range from immediate cash to 7–30 day credit

### 2.7 Quality Inspector / Watchman (Optional)
- In larger operations, a quality gatekeeper who certifies produce at inbound and outbound
- Often the same as the store manager in small/medium operations

---

## 3. Produce Lifecycle: Harvest to Dispatch

```
[Farm/Field]
    │
    ▼
[Harvest & Field-Grade Sorting]
    │ Transport (truck/pickup by farmer or transporter)
    ▼
[Mandi OR] ─────────────────────────▶ [Cold Store: Inbound Receipt]
    │  (if pre-sold or consigned to arhtis)        │
    ▼                                               ▼
[Commission Agent weighs,                  [Weight recorded]
  grades, sells partially]                 [Lot assigned: owner, variety, date, chamber]
    │ Unsold portion                        [Storage receipt issued]
    ▼                                               │
[Cold Store: Inbound Receipt]              [Held in chamber]
                                                    │
                        ┌───────────────────────────┤
                        │                           │
                        ▼                           ▼
               [Partial Withdrawal]          [Full Withdrawal]
               (Owner requests             (Entire lot dispatched)
               N bags/crates)                       │
                        │                           │
                        ▼                           ▼
                [Recount/Reweigh]           [Outbound Weight]
                [Update lot balance]        [Final bill generated]
                [Partial bill generated]    [Settlement]
                        │
                        ▼
                [Mandi Sale or Direct Buyer Delivery]
                        │
                        ▼
                [Payment → Arhti/Trader/Farmer]
                [Cold Store bill deducted from proceeds]
```

---

## 4. Mandi Dynamics & Their Impact on System Design

### 4.1 Price Volatility and Storage Decisions
- Agri commodity prices in Pakistan can vary 50–200% within a single season
- Farmers and traders store produce specifically to **sell at price peaks**
- The cold store system must record **hold durations accurately** to calculate storage costs per lot per day
- No concept of a fixed delivery date — withdrawal timing is market-driven

### 4.2 Seasonal Demand Spikes
- Potato: stored Feb–May (post-harvest), peak demand for packing Aug–Nov
- Onion: stored June–September; stored and released through monsoon shortage
- Fruits (Kinnow, guava): Jan–March storage spike in Central Punjab
- Cold stores may be **oversubscribed** during peak intake season → slot/capacity management is required

### 4.3 Multi-Owner Stock in Shared Chambers
- A single chamber may contain produce from 10–30 different owner-lots
- Physical co-mingling of same-variety produce from different owners is common in smaller operations
- Lot-level segregation via tagging (colored tags, handwritten markers) is the current norm
- System must track **virtual lot boundaries** within physical chambers

### 4.4 Weight Loss (Shrinkage / Dehydration Loss)
- Perishables lose moisture during cold storage; typical loss: 2–8% over 3–6 months
- Weight loss is economically significant — it affects billing (if charged by current weight) and settlement disputes
- Some agreements peg bills to **inbound weight**; others to **outbound weight**
- Weight variance between inbound and outbound must be tracked and reported per lot

### 4.5 Mandi Auction & Price Discovery
- Produce not pre-sold may go through mandi auction upon withdrawal
- Commission agent coordinates timing of release based on price intelligence
- Cold store is sometimes called to **certify freshness/quality** before buyer bidding

### 4.6 Commission Agent as Financial Hub
- Farmers often receive net proceeds (sale price – commission – cold store bill – transport – advances)
- The cold store operator must coordinate billing with the commission agent, who pools deductions
- Settlement of bills often happens **after sale**, not before withdrawal (trust-based credit)

---

## 5. Common Inefficiencies in Current Ecosystem

| Inefficiency | Root Cause | System Design Implication |
|---|---|---|
| Disputed inbound/outbound weights | No standardized digital weighbridge | Mandatory digital weigh-in/out with discrepancy logging |
| Multi-owner lot confusion | Paper tags, verbal records | Lot-level digital tagging with owner linkage |
| Billing disputes | Informal/verbal billing terms | Formally defined billing contracts per client |
| Credit overextension | No exposure tracking | Credit limits and aging receivables dashboard |
| Produce lost/misplaced | No systematic lot tracking | Chamber + rack/row/stack location mapping |
| Spoilage discovered at withdrawal | No periodic quality check system | Periodic inspection records per lot |
| Cash flow opacity | No integrated AR/AP | Double-entry accounting tied to operational events |
| Late/missed billing | Manual bill generation | Auto-bill generation on trigger events |
| Seasonal capacity crisis | No forward booking | Inbound advance booking system |

---

## 6. Credit, Trust, and Informal Accounting Practices

### 6.1 Credit Cycles
- **Farmer credit**: Advance given by arhti pre-harvest; recovered at mandi sale. Cold store fee is deducted from same pool.
- **Trader credit**: Cold store extends net-30/60 informal credit to established traders. No formal agreement — based purely on relationship trust.
- **Seasonal credit peaks**: During peak season (Feb–May), large volumes arrive simultaneously. Cold store absorbs service cost upfront and collects at end of season.

### 6.2 Informal Accounting
- Most cold stores maintain paper ledger (bahi khata) or basic Excel per client
- No double-entry bookkeeping — receivables, billings, and payments are tracked separately with no reconciliation mechanism
- Cash receipts are common; cheques sometimes; bank transfers increasingly common for large traders

### 6.3 Trust Mechanisms
- Storage receipt (parchi) is a semi-formal instrument — effectively a bearer document for produce ownership
- Disputes arise when parchas are lost, or produce is handed over to wrong party
- System must handle **release authorization** — who can authorize withdrawal of a lot

---

## 7. Structural Differences from Generic WMS/ERP

| Dimension | Generic WMS/ERP | Agri Cold Storage Platform |
|---|---|---|
| **Inventory ownership** | Facility-owned or single owner | Multi-party, multi-owner in same physical space |
| **Billing trigger** | On dispatch/sale | On combination of duration + weight + services |
| **Inventory valuation** | Cost-based | Market-price speculative (owner retains title) |
| **Delivery date** | Pre-scheduled | Market-driven, variable |
| **Lot identity** | SKU/barcode | Variety + owner + inbound date + batch |
| **Quality tracking** | Pass/fail | Degradation curve across storage period |
| **Financial model** | Transactional | Credit-based with settlement cycles |
| **User literacy** | Trained operators | Semi-literate farmers, informal traders |
| **Regulatory context** | Customs, compliance | Informal; mandi bylaws; tax informality |
| **Integration points** | ERP, OMS | Mandi price feeds, weighbridge, transport |

---

## 8. Domain-Specific Constraints

1. **Perishability**: Produce has a finite storage life; system must track days-in-storage and flag lots approaching quality risk thresholds
2. **Weight as the unit of value**: All billing, settlement, and valuation is weight-based; weight must be captured accurately at inbound and outbound
3. **Multi-party trust**: The system must support multiple concurrent owners of different lots in the same facility, with strict access control per lot
4. **Informal credit norms**: The system must model credit cycles without requiring formal finance agreements upfront
5. **Seasonal throughput spikes**: Architecture must handle 5–10x volume surges during peak intake months
6. **Low digital literacy**: UI/UX must support operators with minimal technical training; Urdu/bilingual support is essential
7. **Regulatory informality**: GST, income tax, and mandi fees are handled inconsistently; the system should support compliance without enforcing it
8. **Partial withdrawals**: Owners frequently withdraw partial lots (e.g., 100 of 500 bags), which must update lot balances, trigger partial billing, and maintain integrity of the remaining stock
9. **Ownership transfer**: Produce ownership may transfer mid-storage (farmer sells to trader while produce remains in store); system must track ownership change without physical movement
10. **Damage and spoilage**: Partial lot spoilage (natural, temperature failure, handling) must be recorded, attributed, and potentially disputed — insurance and liability handling required

---

*Phase 1 complete. Proceeding to Phase 2: Clarifying Questions.*
