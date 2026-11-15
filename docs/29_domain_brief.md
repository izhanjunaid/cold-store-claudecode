# 29 — Domain brief: how a cold store in Pakistan works

Written 2026-11-16. This replaces `docs/01_domain_exploration.md` as the reference for how the business works. `docs/01` cites no sources and is kept as history only.

## How to read this

Every statement carries one of three tags.

- **[Source]** — taken from a document, with a link in section 9. The strength of the source is stated where it is weak.
- **[Owner]** — told to me by Izhan about his own store in Lahore. It is true for that store. It is not assumed for other stores.
- **[Inference]** — my own reasoning. It is not confirmed.

Published information on this trade in Pakistan is thin. Much of what is below rests on one source or on comparison with India and Bangladesh. Section 7 lists what is still uncertain, and `docs/30_questionnaire.md` is the tool for confirming it.

## 1. The short version

A cold store rents cold space. Farmers, traders and commission agents put goods in at harvest, when prices are low, and take them out over the following months, when prices are higher. The store never owns these goods. It earns rent (kiraya), and smaller amounts from labour charges and other services.

Three things make it more than a warehouse.

1. **Many owners share one room.** Each owner's goods are a separate lot, known by its marka (the mark on the bags) and its receipt (parchi).
2. **Money runs on credit and trust.** Some clients pay when they take goods out. Regular clients run an account (khata) that is settled later. The store may also lend cash (peshgi) against the goods it holds.
3. **Goods change owner without moving.** A farmer may sell his stored lot to a trader. The lot stays on the same rack.

Stores differ most in five things: what they store and in what unit, how rent is counted, when rent is paid, how much lending and selling the store does for its clients, and whether bills carry tax. Section 6 sets these out. These differences are what the settings must cover.

## 2. Who is involved

- **Farmer (kisan, zamindar).** Stores to wait for a better price, or to keep seed potato for his next planting. A Planning Commission study says Punjab farmers commonly sell 50–60% of the crop fresh and put the rest in a cold store "for seed as well for sale at high prices", and that about 20% of the crop is kept in cold stores as seed. **[Source: Planning Commission 2020]** Seed is taken out to plant, not to sell. **[Inference]** A lot that is seed has no sale and no buyer, so the software must not assume every lot ends in a sale.
- **Commission agent (arhti).** Sells the farmer's produce in the mandi (wholesale market) for a commission (arhat). He is also the farmer's lender: he supplies seed, fertiliser, chemicals and empty bags on credit, and the farmer is then "bound to sell in market through the commission agent who provided the loan". **[Source: Planning Commission 2020]** Commission is reported at 1.5–2.5% by a mandi software vendor **[Source: Pakka Khata, weak]** and at "sometimes more than 10 percent" for indebted small potato farmers by an academic study **[Source: ResearchGate study, seen in summary only]**. The two figures conflict; the real range is uncertain.
  - A **kacha arhti** only arranges the sale and takes commission. A **pakka arhti** buys the lot himself and resells it. **[Source: Pakka Khata, weak]** These words are unrelated to the software's KATCHI and PACCI books.
- **Trader or stockist (beopari).** Buys from the field at harvest, stores, and sells later. **[Source: Planning Commission 2020]**
- **Cold store owner.** May be a pure landlord of cold space, or also a trader, or also a large farmer storing his own crop. "Some of the big potato farmers have established their own cold storages." **[Source: SMEDA Okara profile]** At Izhan's store the owner also trades his own stock and sometimes sells clients' goods for them. **[Owner]**
- **Munshi.** The store's clerk. Writes the receipts, keeps the books, books withdrawals.
- **Gate staff (chowkidar).** Checks what enters and leaves.
- **Labour (palledar, mazdoor).** Unloads, stacks and loads bags. Usually paid per bag. **[Inference from the per-bag loading charges in the sources below]**
- **Buyer.** Whoever takes the goods in the end. He may collect them from the store himself.

## 3. The cycle, from arrival to settlement

### 3.1 Before the season: booking space
In Bangladesh and India, space is booked before harvest, and a booking slip itself has value and is traded. **[Source: Bangladesh and West Bengal news reports]** Whether Pakistani stores take bookings or deposits before the season is **not confirmed**. Izhan's store has not been asked yet. (Open question 1.)

### 3.2 Arrival (amad)
A truck or trolley arrives. The bags or crates are counted, sometimes weighed, and stacked in a room. The owner's mark (marka) is on the bags. The munshi writes a receipt (parchi, also called a rasid) naming the owner, the goods, the count and the place. **[Owner, and the software as built]**

- **The receipt is usually the only contract.** A Pakistani commerce study found that for about 60% of commercial storage users the only contract was a simple receipt from the storage owner. **[Source: State of Domestic Commerce study, old, seen in summary only]**
- **Units.** Potatoes are in bags (bori). Bag sizes named in sources are 40, 50, 60, 100 and 120 kg. **[Source: Pakka Khata; Dawn 2026 (60 kg); SMEDA Okara (120 kg)]** Apples and kinnow are in crates (peti, crate). A government study sized one store as "60,000 bags of potato or 180,000 crates", so one bag takes the space of about three crates. **[Source: Ministry of Commerce/SMEDA study 2015]**
- **Weight.** Most of Izhan's clients do not record weight. **[Owner]** Where rent is per bag, weight does not affect the bill. **[Inference]**
- **Advance rent at arrival.** A vendor guide says most operators take 25–50% of the rent when goods come in. **[Source: Pakka Khata, weak]** Indian Punjab stores were reported planning to take 50% in advance. **[Source: Down To Earth]** Izhan did not list this among his own arrangements. **[Owner]** So it varies.

### 3.3 While in storage
- **Rent runs** by one of the bases in section 4.
- **Shrinkage and spoilage.** Potatoes lose weight and some rot. Who bears the loss is **not confirmed** for Pakistan. One report says Pakistani storage owners declined responsibility for rot caused by power failures. **[Source: Potato News Today 2019, seen in summary only]** In Uttar Pradesh the law makes the store liable to compensate for loss caused by its negligence and requires it to tell the owner when goods start to deteriorate. **[Source: UP Regulation of Cold Storages Act 1976, ss. 12, 17, 18, 24]** Pakistan has no cold-store law of that kind that I could find; Punjab has a Registration of Godowns Act 2014, which a 2024 report says was not being applied for lack of bylaws. **[Source: Express Tribune]**
- **Sorting and re-bagging.** Indian software lists grading and bardana (bag) charges as normal services. **[Source: ColdStoreApp listing]** Not confirmed for Pakistan.
- **Change of owner.** A stored lot can be sold while it stays in the room. In Bengal and Bangladesh this is done by selling the receipt. **[Source: The Wire; Financial Express BD]** Izhan's store handles sales for clients **[Owner]**; how the papers change hands there is not yet known.
- **Peshgi.** See section 5.

### 3.4 Withdrawal (nikasi)
The owner, or someone he sends, asks for some or all of the bags. Partial withdrawals are the norm, and tracking them is "where manual registers most often go wrong". **[Source: Pakka Khata, weak]** Labour loads the truck. The gate checks the load.

Who may collect is a real risk: the receipt works almost like a bearer paper, so a store needs a rule for releasing goods to someone other than the owner. **[Inference, consistent with the receipt-trading reports above]**

### 3.5 Billing and payment
- At Izhan's store, some clients pay rent for what they take at each withdrawal, and regular clients run a khata settled later. **[Owner]**
- An unpaid client's goods are the store's security. In Uttar Pradesh the store has a legal lien: it may hold the goods until its charges are paid. **[Source: UP Act s. 20]** In Pakistan this works by custom. **[Inference]**
- When the store sells the client's goods, rent and peshgi would naturally be taken from the sale money. **[Inference]** Izhan does not know how his own store settles these sales. (Open question 4.)

### 3.6 End of season and unclaimed goods
When prices crash, owners abandon goods because the rent is more than the goods are worth. This happened in Pakistan in 2025–26 ("storage rent in many cases exceeds the market price") and repeatedly in India. **[Source: Dawn 2025–26; Business Standard 2017]** In Uttar Pradesh the store may auction such goods after written notice. **[Source: UP Act s. 17]** What Pakistani stores do is **not confirmed**. (Open question 7.) The software must at least let a store close out an abandoned lot and write off or recover the rent.

## 4. Rent (kiraya) and other charges

### 4.1 Bases seen
| Basis | Where seen | Evidence |
|---|---|---|
| Per bag for the whole season, whatever the length of stay | Potato belt (Okara, Sahiwal). SMEDA: Rs 200–225 per 120 kg bag. A district committee fixed Rs 260 per bag in a Sahiwal dispute. | **[Source: SMEDA Okara; Dawn]** Rupee figures are old. |
| Per bag per month | General guide for Pakistan; a 2015 government study assumed Rs 100 per bag per month. | **[Source: Pakka Khata, weak; Ministry of Commerce 2015]** |
| Per crate per month | Fruit. The 2015 study assumed Rs 35 per crate per month. | **[Source: Ministry of Commerce 2015, seen in summary only]** |
| Half month first, then whole months, then leftover days | Apples at Lahore stores. | **[Owner]** |
| Per kg or per quintal for the season | India (per quintal), Bangladesh (per kg). Not seen in Pakistan. | **[Source: Indian and Bangladeshi news]** |

### 4.2 Rules that vary
- **Part periods.** A part month may be billed as a full month, a half month, or by days. Early withdrawal is "usually charged a full month". **[Source: Pakka Khata, weak]**
- **Rate by client.** Rates depend on commodity, bag size and room. **[Source: Pakka Khata, weak]** Whether regular clients get their own negotiated rate is not confirmed but likely. **[Inference]** (Open question 3.)
- **Who sets the rate.** Usually the store. In disputes a district committee or the owners' association has set one rate for an area. **[Source: Dawn; Profit 2023]**

### 4.3 Other charges
- **Loading and unloading labour (palledari, mazdoori).** A 2015 study assumed Rs 30 per bag and Rs 8 per crate. **[Source: Ministry of Commerce 2015, seen in summary only]** Whether the store bills it, or the client pays the labourers directly, is not confirmed. (Open question 5.)
- **Bags (bardana), sorting, weighing (tulai).** Common in Indian practice. Not confirmed here.

### 4.4 Deductions on a mandi sale
These matter only if the store sells for the client. A mandi sale slip can carry: commission (arhat), bag cost (bardana), weighing (tulai), cuts for moisture or dirt (kaat), and the market committee fee. **[Source: Pakka Khata, weak]**

## 5. Peshgi and credit

- **Who lends.** The arhti is the main lender to farmers in Pakistan. **[Source: Planning Commission 2020]** Cold store owners lending against stored potatoes is well documented in Bangladesh (at 18–22% interest) **[Source: Financial Express BD]** and is listed as income in Indian cold-store business plans. For Pakistan I found no published source, but Izhan's store does it. **[Owner]**
- **Security.** The stored goods. At Izhan's store peshgi is given "against stock". **[Owner]** It follows that goods should not leave while the peshgi they secure is unpaid, unless a manager allows it. **[Inference]**
- **Markup.** Charging interest is religiously sensitive. Whether stores charge a markup, charge a higher rent instead, or lend free to win the client's goods is **not confirmed**. (Open question 6.)
- **Recovery.** From the client's payments, or from the sale money when goods are sold. **[Inference]**

## 6. Where stores differ

This is the list the settings must cover. "Seen" means I have evidence that a store works that way.

| # | The difference | Choices seen | Evidence |
|---|---|---|---|
| 1 | Goods and unit | Potato in bags; apples and kinnow in crates; other goods | Owner; SMEDA; Commerce study |
| 2 | Bag or crate size | 40, 50, 60, 100, 120 kg bags | Pakka Khata; Dawn; SMEDA |
| 3 | Is weight recorded | Never; sometimes; always | Owner (most do not) |
| 4 | Rent basis | Per season; per month; half month then months then days; per day | Section 4.1 |
| 5 | Part-period rule | Full month; half month; by days | Owner; Pakka Khata |
| 6 | Rate differs by | Commodity; bag size; room; client | Pakka Khata; inference for client |
| 7 | When rent is paid | At each withdrawal; on khata, settled later; part in advance at arrival; from sale money | Owner (first two); Pakka Khata (advance) |
| 8 | Labour charge | Billed by the store per bag; paid by client direct | Commerce study; not confirmed |
| 9 | Peshgi | None; against stock; with or without markup | Owner; Bangladesh reports |
| 10 | May goods leave with dues unpaid | Never; with a manager's approval; freely for khata clients | Owner (khata clients take goods on account) |
| 11 | Store sells for the client | No; yes, with or without commission | Owner (yes; terms unknown) |
| 12 | Arhti's role | Arhti pays for his farmers' lots; farmer pays himself | Owner |
| 13 | Tax on bills | None; provincial sales tax at the province's rate; only on request | Owner (none); section 8 |
| 14 | Papers | Receipt and gate pass wording, numbering, number of copies, language | Owner (copy list still to come) |
| 15 | Who may do what | One munshi does everything; separate desk, manager and gate | The software's history of owner decisions |
| 16 | Season | Fixed season with a closing date; goods all year | SMEDA (season); Owner (mixed goods) |

## 7. What is still uncertain

Each of these is a question in `docs/30_questionnaire.md`.

1. Do stores book space or take a deposit before the season?
2. Is one receipt written per truck, per owner, or per mark? Can one receipt hold two varieties or sizes?
3. Do regular clients get their own rate? Is the rate fixed at arrival or at settlement?
4. When the store sells a client's goods: who receives the money, what is deducted, is commission charged, and what paper does the client get?
5. Who pays the labourers, and is labour on the store's bill?
6. Is there any markup or fee on peshgi? Is there a limit per bag?
7. What happens to goods nobody collects?
8. Who bears shrinkage and rot? Is there ever a claim against the store?
9. How does a change of owner happen on paper, and who pays the rent up to that day?
10. Who may collect goods for the owner, and on what proof?
11. When is a khata settled: monthly, at season end, or when the client next brings money?
12. Does any client store charge sales tax on its bills today?
13. How many copies of each paper, and who keeps each?
14. What does the owner look at every day, and at season end?

## 8. Tax

**This section is not tax advice. Rates change every year and must be confirmed with a tax adviser before a client turns tax on.**

### 8.1 Provincial sales tax on services
Cold storage is a service, taxed by the province where it is provided.

| Province | Position for 2026–27 | Evidence |
|---|---|---|
| Punjab (PRA) | "Services provided by warehouse or depots for storage or cold storages including letting of space for storages" moved from 5% to 8%, **without input tax adjustment**, from 1 July 2026. Standard rate 16%. One guide lists as exempt only "storage of agricultural produce for personal use". | **[Source: KPMG brief on the Punjab Finance Act 2026, read directly — it words this as the "proposed change"; ConSerIC guide 2026–27 lists 9833.0000 at 8%]** The Act's own text was not reachable (the Punjab laws site returned errors). |
| Sindh (SRB) | Standard rate 15%. The First Schedule exempts "storage and warehousing services", and the 2026 Act narrowed this from "food and agricultural commodities" to "food grains and fresh vegetables and fruits not subjected to further processing". So storing fresh potatoes or apples appears exempt; storing processed food does not. | **[Source: KPMG brief on the Sindh Finance Act 2026, read directly]** |
| Khyber Pakhtunkhwa (KPRA) | Standard rate 15%. The cold storage rate was not found. | **[Source: secondary commentary only]** |
| Balochistan (BRA) | Warehouses and cold storage at 5% without input tax adjustment under the 2025 Act; a similar food and agriculture exemption is reported. 2026 position not found. | **[Source: secondary commentary only]** |

What this means for the software **[Inference]**:
- The rate has changed in each of the last two years, and differs by province. Tax must be a dated setting.
- A reduced rate "without input tax adjustment" and a standard rate with it are different regimes. The setting must name the regime, not only a percentage.
- Exemption can depend on **what is stored**. Tax must be decided per commodity, not per store.
- Many stores charge no tax at all (Izhan's own bills carry none **[Owner]**). "No tax" must be a normal, complete setup, not a broken one.

### 8.2 Income tax withheld from the store
A company or other withholding agent that pays the store for storage deducts income tax under section 153. For 2026–27 warehousing is reported in the group raised from 6% to 7%, doubled for a person not on the Active Taxpayers List. **[Source: PkRevenue, secondary]** This only matters for stores with corporate clients. The software already records a party's NTN and filer status.

### 8.3 What the existing code assumes
One undated rate per store, applied to the whole bill (`apps/api/src/modules/invoice/invoice.builder.ts:78`). This cannot express any of the points in 8.1.

## 9. Sources

Primary or official:
- Planning Commission of Pakistan / CABI, *Potato Cluster Feasibility and Transformation Study*, February 2020 — https://www.pc.gov.pk/uploads/report/Potato_Cluster_Report.pdf (read directly)
- SMEDA, *Potato Cluster Profile, Okara* — https://smeda.org/phocadownload/Punjab/cluster_profiles/potato%20-%20okara.pdf (read directly; undated, rupee figures old)
- Ministry of Commerce / SMEDA, *Pre-Feasibility Study: Cold Storage (Fruit & Vegetable)*, December 2015 — https://www.commerce.gov.pk/wp-content/uploads/pdf/Cold-Storage-Fruit-Vegetable.pdf (the file could not be opened; figures are from search summaries)
- Uttar Pradesh Regulation of Cold Storages Act 1976 — https://www.indiacode.nic.in/bitstream/123456789/16903/1/english11of1976.pdf (India; section summaries only)
- KPMG Pakistan, *A Brief of Provincial Tax Laws 2026*, July 2026 — https://assets.kpmg.com/content/dam/kpmgsites/pk/pdf/2026/07/A-Brief-of-Provincial-Tax-Laws-2026.pdf.coredownload.inline.pdf (read directly)

News:
- Dawn, "Anatomy of Pakistan's potato crisis", 2 February 2026 — https://www.dawn.com/news/1970471 (over 800 potato cold stores in Punjab, capacity over 3.5 million tonnes)
- Dawn, "Punjab potato growers face collapse" — https://www.dawn.com/news/1965459
- Dawn, "Okara potato growers face crunch time" — https://www.dawn.com/news/1436644
- Dawn, Sahiwal rent dispute (Rs 260 per bag) — https://www.dawn.com/news/473431 (date not confirmed)
- Profit, "Cold storage owners hint at fruit, vegetable shortage", 19 January 2023 — https://profit.pakistantoday.com.pk/2023/01/19/cold-storage-owners-hint-at-fruit-vegetable-shortage
- Express Tribune, "Failure to register warehouses in Punjab hinders regulation" — https://tribune.com.pk/story/2459860/failure-to-register-warehouses-in-punjab-hinders-regulation-efforts
- The Wire, on Bengal potato bonds — https://m.thewire.in/article/economy/bengals-potato-story-why-are-farmers-caught-in-a-web-of-debt-despite-record-harvest
- Business Standard via PressReader, unclaimed potatoes in Agra, 2017 — https://www.pressreader.com/india/business-standard/20171223/281831464099032
- Down To Earth, Indian Punjab cold store owners — https://www.downtoearth.org.in/agriculture/punjab-s-cold-storage-owners-struggle-to-stay-in-business-63240
- Financial Express (Bangladesh), cold storage loans and rent — https://thefinancialexpress.com.bd/national/country/excessive-cold-storage-rent-puts-potato-farmers-in-crisis-1541344212

Tax commentary (secondary):
- ConSerIC, Punjab sales tax on services 2026–27 — https://conseric.pk/punjab-sales-tax-on-services/
- PkRevenue, withholding on services raised to 7% — https://pkrevenue.com/fbr-raises-withholding-tax-on-various-services-to-7/
- TaxSupportHub, Balochistan Finance Act 2025 — https://taxsupporthub.com/balochistan-finance-act-2025-major-overhaul-in-sales-tax-regime-on-services/

Software vendors (lowest trust; used for vocabulary and feature lists):
- Pakka Khata blog (Urdu): cold storage rent — https://pakkakhata.com/ur/blog/cold-storage-rent-pakistan ; commission — https://pakkakhata.com/ur/blog/how-adhat-mandi-commission-is-calculated ; deductions — https://pakkakhata.com/ur/blog/mandi-deductions-explained ; kacha and pakka arhti — https://pakkakhata.com/ur/blog/kacha-vs-pakka-arhti-difference-settlement
- ColdStoreApp (India) listing — https://www.techjockey.com/detail/coldstoreapp

Sources I looked for and did not find: any Pakistani cold-store law on receipts, liability or unclaimed goods; the All Pakistan Cold Stores Association's rate terms; a published study of how Pakistani cold stores bill and lend; the Punjab, KP and Balochistan 2026 Acts' own text.

## 10. Glossary

Spellings vary; the common Roman spelling is given first.

| Term | Urdu | English meaning |
|---|---|---|
| Amad | آمد | Arrival of goods at the store; the inward entry |
| Nikasi | نکاسی | Withdrawal of goods from the store; the outward entry |
| Kiraya | کرایہ | Rent for storage |
| Parchi / Rasid | پرچی / رسید | Slip or receipt; here, the storage receipt given at arrival |
| Gate pass | گیٹ پاس | Paper that lets a loaded vehicle leave or enter |
| Bilty | بلٹی | Transporter's consignment note |
| Bori | بوری | Sack or bag |
| Peti / Crate | پیٹی / کریٹ | Box or crate, used for fruit |
| Bardana | بردانہ | Empty bags or packing material, and the charge for them |
| Marka | مارکہ | Owner's mark painted or stamped on the bags |
| Maal | مال | Goods |
| Lot | لاٹ | One batch of goods from one owner |
| Khata | کھاتہ | A client's running account |
| Bahi | بہی | The paper ledger book |
| Katcha / Kachi | کچا / کچی | Rough, provisional (a rough entry or rough receipt) |
| Pakka / Pakki | پکا / پکی | Final, official |
| Kacha arhti | کچا آڑھتی | Commission agent who only arranges the sale |
| Pakka arhti | پکا آڑھتی | Agent who buys the goods himself and resells |
| Arhti | آڑھتی | Commission agent in the mandi |
| Arhat | آڑھت | The agent's commission |
| Beopari | بیوپاری | Trader |
| Zamindar / Kisan | زمیندار / کسان | Farmer or landowner |
| Munshi | منشی | Clerk who keeps the store's books |
| Chowkidar | چوکیدار | Watchman, gate guard |
| Palledar | پلے دار | Labourer who carries and stacks bags |
| Palledari / Mazdoori | پلے داری / مزدوری | Labour charge for loading, unloading, stacking |
| Tulai | تلائی | Weighing, and the weighing charge |
| Kanda | کنڈا | Weighing scale or weighbridge |
| Kaat | کاٹ | A cut from weight or price, for moisture, dirt or quality |
| Peshgi | پیشگی | Money given in advance; here, cash lent to a client against his goods |
| Udhaar | ادھار | Credit; buying or taking on account |
| Wasooli | وصولی | Collection of money owed |
| Baqaya | بقایا | Balance outstanding |
| Hisab | حساب | Account; settling up |
| Adhi | آدھی | Half; here, a half-month rent period |
| Mann (maund) | من | Unit of weight, 40 kg in Pakistani mandis (to be confirmed for each market) |
| Mandi | منڈی | Wholesale produce market |
| Market committee fee | مارکیٹ کمیٹی فیس | Government fee on a mandi sale |
| Chamber / Kamra | چیمبر / کمرہ | A cold room |
| Beej | بیج | Seed; here, seed potato kept for the next planting |
