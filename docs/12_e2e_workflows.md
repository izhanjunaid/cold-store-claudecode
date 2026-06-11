# ColdChain — End-to-End Operational Workflows

**Version**: 1.0  
**Date**: March 2026

---

## WF-01: Produce Inbound — Farmer Deposits Produce

**Trigger**: Farmer or transporter arrives at cold store with loaded vehicle  
**Actors**: Operator, Farmer (or Arhti)  
**Outcome**: Active lot created; storage receipt issued; produce physically stowed

### Steps

| # | Actor | Action | System Response |
|---|---|---|---|
| 1 | Security | Logs truck at gate (Vehicle: LHR-1234, Driver: Ali) | Generates Inward Gate Pass (ARRIVED) |
| 2 | Operator | Checks party exists; searches by phone number | Returns party record OR prompts to create new party |
| 3 | Operator | Creates party if new: name, phone, type (FARMER), optional Arhti link | Party saved; party_id assigned |
| 4 | Operator | Opens "New Inbound" form and links Gate Pass | Blank lot creation form |
| 4 | Operator | Selects party, commodity (POTATO), variety (Cardinal) | Chamber dropdown filtered to potato-compatible chambers |
| 5 | Operator | Enters quantity (500 bags) | |
| 6 | Operator | Weighs produce on facility scale; enters declared weight (10,500 kg) and accepted weight (10,200 kg) | System calculates variance: 2.86% — EXCEEDS threshold. Yellow dispute warning shown. `weight_dispute_note` becomes required |
| 8 | Operator | Enters dispute note: "Scale variance. Farmer acknowledged. Both parties agreed on 10,200 kg." | |
| 9 | Operator | Selects Chamber B, Rate Plan "Potato Standard 2026 (Seasonal)", enters vehicle LHR-1234 | Available chamber capacity updated in preview |
| 9a | Operator | Enters the marka painted on the sacks (e.g. "ASLAM-7") | Recorded on the lot; later printed on the parchi and searchable in the lot list |
| 10 | Operator | Reviews and saves lot | System: generates LOT-260301; creates inbound event; updates chamber |
| 11 | System | Auto-generates storage receipt PDF | Printed at counter |
| 12 | Operator | Hands printed receipt to farmer | |
| 13 | Warehouse staff | Directs vehicle to Chamber B; produce stacked | (Physical operation) |
| 14 | Security | As truck leaves, logs Outward Pass against LHR-1234 | Status = CLEARED; Turnaround Time calculated |

**Documents Generated**: Storage Receipt (Parchi) — LOT-260301-0042  
**Edge Cases**:
- Party already has active lots: system shows active lot count on party page (no restriction)
- Chamber B at 95% capacity: red warning shown; operator must acknowledge before proceeding

---

## WF-02: Mid-Storage Ownership Transfer (Partial)

**Trigger**: Farmer (Ghulam) verbally agrees to sell 200 of his 500 stored bags to Trader (Ahmad)  
**Actors**: Manager, Farmer (verbally present or on phone), Trader  
**Outcome**: 200-bag child lot transferred to trader; original 300-bag lot continues under farmer

### Steps

| # | Actor | Action | System Response |
|---|---|---|---|
| 1 | Manager | Opens lot LOT-260301-0042 | Lot detail shows: owner = Ghulam, balance = 500 bags, ACTIVE |
| 2 | Manager | Clicks "Transfer Ownership" | Transfer form opens |
| 3 | Manager | Selects transfer type: PARTIAL | Quantity field appears |
| 4 | Manager | Enters quantity: 200 bags | |
| 5 | Manager | Searches and selects new owner: Trader Ahmad | |
| 6 | Manager | Enters effective date: today | |
| 7 | Manager | Enters optional transfer price: Rs. 1,200,000 | |
| 8 | Manager | Adds note: "Farmer Ghulam sold to Ahmad verbally on site. Confirmed by both." | |
| 9 | Manager | Submits | System: reduces LOT-260301-0042 balance to 300; creates LOT-260301-0042-T1 with 200 bags owned by Ahmad; appends ownership_history record on both lots |
| 10 | System | Generates Ownership Transfer Acknowledgment PDF | Printed and given to both parties |
| 11 | System | Billing reset: System generates invoice for Ghulam. Ghulam must pay invoice immediately (or Ahmad officially assumes balance) before ownership transfer is committed. Ahmad's new lot accrues from today | |

**Documents Generated**: Ownership Transfer Acknowledgment  
**Edge Cases**:
- Manager attempts to transfer 600 bags (exceeds balance): blocked with error
- New owner does not exist: manager must create party first
- Same-day transfer and withdrawal: supported — child lot is withdrawn on same day as transfer

---

## WF-03: Partial Withdrawal with Service Charges

**Trigger**: Trader Ahmad requests to withdraw 100 bags from his lot LOT-260301-0042-T1  
**Actors**: Operator, Manager, Trader  
**Outcome**: 100 bags dispatched; invoice finalized; lot balance updated to 100 bags

### Steps

| # | Actor | Action | System Response |
|---|---|---|---|
| 1 | Operator | Opens lot LOT-260301-0042-T1 | Detail shows: owner = Ahmad, balance = 200 bags, ACTIVE |
| 2 | Operator | Clicks "New Withdrawal" | Withdrawal form |
| 3 | Operator | Selects PARTIAL, enters quantity: 100 bags, outbound date: today | |
| 4 | Operator | Enters vehicle number, optional buyer name | |
| 5 | Operator | Saves withdrawal | System creates outbound event with status PENDING; generates dispatch note (gate pass) |
| 6 | Warehouse staff | Physically removes 100 bags and loads onto vehicle | (Physical operation) |
| 7 | Operator | Records outbound weight: 2,030 kg | System calculates: inbound prorated weight = 2,040 kg; variance = 0.49% — within range |
| 8 | System | Auto-calculates storage bill | Duration: 15 days (transfer date to today). Rate: Seasonal Rs.250/bag. 100 bags × Rs.250 = Rs.25,000. |
| 9 | Operator | Adds service charge: Loading — 100 bags × Rs.10 = Rs.1,000 | Line item added |
| 10 | Manager | Reviews invoice preview: Rs.26,000 total | |
| 11 | Manager | Finalizes invoice | Invoice INV-202603-0088 locked. Posted to Ahmad's ledger. |
| 12 | Operator | Prints invoice + dispatch note | Handed to trader |
| 13 | System | Updates lot LOT-260301-0042-T1 balance: 200 − 100 = 100 bags, status ACTIVE | |
| 14 | Security | Driver presents dispatch note at gate | System validates it links to PAID invoice (or explicit credit authorization); Gate Pass CLEARED |

**Documents Generated**: Dispatch Note (Gate Pass), Invoice INV-202603-0088  
**Edge Cases**:
- Outbound weight not recorded: invoice stays in DRAFT; cannot finalize; dispatch note can still be generated
- Truck leaves before weight is recorded: operator records estimated weight; creates manual note; adjusts after actual weigh-out at destination (bilateral agreement)

---

## WF-04: Full Withdrawal and Season Settlement

**Trigger**: Farmer Ghulam withdraws all remaining 300 bags at end of season  
**Actors**: Manager, Farmer (Ghulam or his Arhti, Hameed)  
**Outcome**: Lot closed; final invoice issued; bill settled from mandi sale proceeds

### Steps

| # | Actor | Action | System Response |
|---|---|---|---|
| 1 | Manager | Opens lot LOT-260301-0042 | Balance = 300 bags; days in storage = 95 |
| 2 | Manager | Initiates FULL withdrawal | |
| 3 | Operator | Records outbound weight: 6,010 kg | Inbound accepted weight was 6,120 kg; variance = 1.8% (natural shrinkage — within range) |
| 4 | System | Calculates storage bill | 300 bags × Rs.250 seasonal rate = Rs.75,000 |
| 5 | Manager | Adds services: Loading Rs.3,000, Sorting Rs.1,500 | Total = Rs.79,500 |
| 6 | Manager | Applies advance: Ghulam had paid Rs.20,000 in March | Advance deducted: Balance due = Rs.59,500 |
| 7 | Manager | Finalizes invoice | INV-202606-0143 locked |
| 8 | Arhti Hameed | Receives mandi sale proceeds; pays cold store bill on behalf of farmer | |
| 9 | Accountant | Records payment: Rs.59,500, method = BANK_TRANSFER, ref TXN-9927 | Payment allocated to INV-202606-0143; balance = Rs.0 |
| 10 | System | Lot LOT-260301-0042 closed; status = CLOSED; closed_at = today | |

**Documents Generated**: Invoice INV-202606-0143, Payment Receipt  
**Edge Cases**:
- Farmer cannot pay immediately: invoice status = FINALIZED, balance due remains; appears in aging report; lot closed regardless
- Arhti disputes the loading charge: manager issues credit note for Rs.3,000; revised balance = Rs.56,500

---

## WF-05: Quality Inspection and Confirmed Spoilage

**Trigger**: Manager notices deterioration in Chamber A during routine walk-through in summer heat  
**Actors**: Manager, Cold Store Owner  
**Outcome**: Spoilage recorded; lot quantity adjusted; owner notified; billing adjusted

### Steps

| # | Actor | Action | System Response |
|---|---|---|---|
| 1 | Manager | Opens Quality module; selects "New Inspection" | |
| 2 | Manager | Selects lot, enters inspection date, observations, marks condition flags: ROTTEN_SPOTS | |
| 3 | Manager | Uploads 3 photos of affected bags | Saved to S3; URLs stored on inspection record |
| 4 | Manager | Saves inspection record | Inspection record created with status INFORMATIONAL |
| 5 | Manager | Creates spoilage record: 40 bags affected, cause = NATURAL_DECAY | |
| 6 | Manager | Saves spoilage | Status = PENDING_REVIEW |
| 7 | Owner | Reviews spoilage record and photos on dashboard "Attention Required" panel | |
| 8 | Owner | Confirms spoilage | System: lot balance reduced by 40 bags; audit_log entry created; spoilage status = CONFIRMED |
| 9 | System | Notify owner party (if SMS configured): "40 bags spoilage confirmed in lot LOT-260301-0042 on [date]" | |
| 10 | Owner | Decides: no billing adjustment (natural spoilage accepted by both parties) | No financial adjustment made. *If owner accepted liability, JE-12 would be triggered to offset the invoice, bypassing standard credit notes.* |

**Edge Cases**:
- Owner disputes spoilage: status set to DISPUTED; lot quantity NOT changed; mediating notes recorded; resolution handled offline; system holds until confirmed
- Spoilage from cold chain failure (power cut): cause = TEMPERATURE_FAILURE; automatically flags liability review; dispute process likely

---

## WF-06: Month-End Financial Reconciliation

**Trigger**: End of month (automated or manual trigger)  
**Actors**: Accountant, Owner  
**Outcome**: All receivables reviewed; overdue parties flagged; payments recorded; AR aging report generated

### Steps

| # | Actor | Action | System Response |
|---|---|---|---|
| 1 | Accountant | Opens Receivables Aging Report | Table shows all parties with outstanding balances segmented into 0–30, 31–60, 61–90, 90+ day buckets |
| 2 | Accountant | Exports report to PDF | Shared with owner |
| 3 | Owner | Reviews 90+ day column | Ahmad has Rs.150,000 overdue 92 days |
| 4 | Owner | Contacts Ahmad; agrees on post-dated cheque | (Offline) |
| 5 | Accountant | Records advance: Rs.50,000 cheque received (post-dated — cleared date in future) | Payment recorded with reference number; marked as advance |
| 6 | Accountant | For monthly-rate lots: generates interim invoices for ongoing storage | System calculates monthly accrual per lot; draft invoices created; manager finalizes |
| 7 | System | Generates daily cash summary for the month | Total invoiced, total collected, closing AR balance |
| 8 | Owner | Reviews seasonal summary (if end of season) | Total bags in, bags out, revenue, outstanding |

**Documents Generated**: AR Aging Report, Monthly Party Statements, Seasonal Summary  
**Edge Cases**:
- Cheque bounces later: accountant reverses payment; invoice re-opens; `dishonored_cheque_flag` set on party; owner alerted
- Party has credit balance (overpayment): visible in aging report as negative; applied to next invoice automatically

---

## WF-07: Peshgi Loan Issue & Final Recovery

**Trigger**: Farmer (Ghulam) requests a 100,000 PKR advance (Peshgi) to buy seeds for the upcoming season.  
**Actors**: Owner, Farmer, Manager  
**Outcome**: Peshgi loan generated; AR updated; GL updated; later recovered at storage settlement.

### Steps

| # | Actor | Action | System Response |
|---|---|---|---|
| 1 | Farmer | Requests 100k advance from Owner | |
| 2 | Owner | Negotiates terms and agrees; opens "Issue Peshgi" module | |
| 3 | Owner | Selects Party (Ghulam), Amount (100,000), Method (Bank Transfer) | |
| 4 | Owner | Submits the loan | System creates `party_loans` entry; triggers JE-18 (DR 1140 Peshgi / CR 1020 Bank). |
| 5 | System | Generates Loan Acknowledgment PDF | Signed by Ghulam |
| 6 | Farmer | Stores produce all season. End of season, sells produce in mandi. | |
| 7 | Manager | Processes final withdrawal and creates storage invoice (e.g. 50,000 PKR) | |
| 8 | Manager | Clicks "Settle Accounts" | System shows Storage AR: 50,000. Peshgi Loan: 100,000. Total Due: 150,000. |
| 9 | Farmer | Pays 150,000 PKR cash to clear all dues | |
| 10 | Manager | Records Payment of 150,000 | System allocates 50k to invoice (JE-02) and 100k to loan (JE-19: Peshgi Recovered). Loan status = RECOVERED. |
