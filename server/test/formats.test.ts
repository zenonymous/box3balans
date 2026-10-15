import { afterEach, describe, expect, it } from "vitest";
import { recognise } from "../src/import/formats/index.js";
import { createTestApp, type TestApp } from "./helpers.js";

// Small files in the layout of each export (made up, not real accounts).
const lines = (...l: string[]) => l.join("\n") + "\n";

const read = (content: string) => {
  const r = recognise(content);
  if (!r) throw new Error("not recognised");
  return { id: r.format.id, rows: r.result.rows, skipped: Object.fromEntries(r.result.skipped), notes: r.notes, r };
};

describe("broker exports", () => {
  it("DEGIRO account statement: trades with costs, dividends with tax, cash left out", () => {
    const { id, rows, skipped, r } = read(
      lines(
        "Datum,Tijd,Valutadatum,Product,ISIN,Omschrijving,FX,Mutatie,,Saldo,,Order Id",
        '02-05-2024,07:30,30-04-2024,ASML HOLDING,NL0010273215,Dividendbelasting,,EUR,"-1,32",EUR,"120,08",',
        '02-05-2024,07:30,30-04-2024,ASML HOLDING,NL0010273215,Dividend,,EUR,"8,80",EUR,"121,40",',
        '05-03-2024,09:10,05-03-2024,ISHARES CORE MSCI WORLD,IE00B4L5Y983,DEGIRO Transactiekosten en/of kosten van derden,,EUR,"-1,00",EUR,"112,60",aaaa-1111',
        '05-03-2024,09:10,05-03-2024,ISHARES CORE MSCI WORLD,IE00B4L5Y983,"Koop 10 @ 88,14 EUR",,EUR,"-881,40",EUR,"113,60",aaaa-1111',
        '02-01-2024,08:00,01-01-2024,,,Aansluitingskosten 2024 (Euronext Amsterdam - EAM),,EUR,"-2,50",EUR,"995,00",',
        '16-12-2023,09:05,15-12-2023,COCA-COLA COMPANY (THE,US1912161007,Dividend,,USD,"0,44",USD,"1,36",',
        '16-12-2023,09:05,15-12-2023,COCA-COLA COMPANY (THE,US1912161007,Dividendbelasting,,USD,"-0,07",USD,"0,92",',
        '15-12-2023,16:55,15-12-2023,VICI PROPERTIES INC. C,US9256521090,Valuta Creditering,"1,0624",USD,"33,90",USD,"0,00",5925d76b-eb36-',
        ",,,,,,,,,,,46e3-b017",
        '15-12-2023,16:55,15-12-2023,VICI PROPERTIES INC. C,US9256521090,Valuta Debitering,,EUR,"-31,91",EUR,"0,07",5925d76b-eb36-46e3-b017',
        '15-12-2023,16:55,15-12-2023,VICI PROPERTIES INC. C,US9256521090,DEGIRO Transactiekosten en/of kosten van derden,,EUR,"-1,00",EUR,"31,98",5925d76b-eb36-46e3-b017',
        '15-12-2023,16:55,15-12-2023,VICI PROPERTIES INC. C,US9256521090,"Koop 1 @ 33,9 USD",,USD,"-33,90",USD,"-33,90",5925d76b-eb36-46e3-b017',
        '14-12-2023,10:00,14-12-2023,,,iDEAL Deposit,,EUR,"500,00",EUR,"500,00",',
      ),
    );
    expect(id).toBe("degiro-account");
    expect(r.result.mapping).toEqual({ feeCurrency: "EUR" });
    expect(rows).toEqual([
      expect.objectContaining({
        date: "2023-12-15",
        type: "buy",
        isin: "US9256521090",
        quantity: "1",
        price: "33.9",
        currency: "USD",
        fee: "1.00",
        id: "degiro:5925d76b-eb36-46e3-b017",
      }),
      expect.objectContaining({
        date: "2023-12-16",
        type: "dividend",
        isin: "US1912161007",
        currency: "USD",
        amount: "0.4400",
        tax: "0.0700",
      }),
      expect.objectContaining({
        date: "2024-03-05",
        type: "buy",
        isin: "IE00B4L5Y983",
        quantity: "10",
        price: "88.14",
        currency: "EUR",
        fee: "1.00",
      }),
      expect.objectContaining({
        date: "2024-05-02",
        type: "dividend",
        isin: "NL0010273215",
        amount: "8.8000",
        tax: "1.3200",
      }),
    ]);
    // Two currency exchange lines and the deposit; the connection fee.
    expect(skipped).toEqual({
      "Cash movements (deposits, withdrawals, currency exchange)": 3,
      "Platform costs (connection fees)": 1,
    });
  });

  // Review fix: patterns from a real statement that used to be skipped as "other lines".
  it("DEGIRO account statement: transaction tax, corporate actions and interest", () => {
    const { rows, skipped, notes } = read(
      lines(
        "Datum,Tijd,Valutadatum,Product,ISIN,Omschrijving,FX,Mutatie,,Saldo,,Order Id",
        '31-12-2024,23:00,31-12-2024,,,Flatex Interest Income,,EUR,"0,00",EUR,"10,23",',
        '12-12-2024,07:00,12-12-2024,ACME DS,FR0000000002,"DELISTING: Verkoop 30 @ 0 EUR",,EUR,"0,00",EUR,"10,23",',
        '30-11-2024,08:00,30-11-2024,,,Rente,,EUR,"-0,12",EUR,"10,23",',
        '20-11-2024,07:00,20-11-2024,ACME DS,FR0000000002,"CLAIMEMISSIE: Koop 30 @ 0 EUR",,EUR,"0,00",EUR,"10,35",',
        '15-11-2024,09:00,15-11-2024,,,Flatex Interest Income,,EUR,"0,35",EUR,"10,35",',
        '25-04-2024,10:00,25-04-2024,ACME SA,FR0000000001,Transactiebelasting Frankrijk,,EUR,"-1,20",EUR,"10,00",',
        '25-04-2024,10:00,25-04-2024,ACME SA,FR0000000001,Transactiebelasting Frankrijk,,EUR,"1,00",EUR,"11,20",',
        '04-04-2024,09:00,04-04-2024,ACME SA,FR0000000001,Transactiebelasting Frankrijk,,EUR,"-1,00",EUR,"10,20",bbbb-2222',
        '04-04-2024,09:00,04-04-2024,ACME SA,FR0000000001,DEGIRO Transactiekosten en/of kosten van derden,,EUR,"-2,00",EUR,"11,20",bbbb-2222',
        '04-04-2024,09:00,04-04-2024,ACME SA,FR0000000001,"Koop 50 @ 5 EUR",,EUR,"-250,00",EUR,"13,20",bbbb-2222',
      ),
    );
    expect(rows).toEqual([
      // Costs 2.00 + tax 1.00 on the order, then the correction three weeks later: −1.00 + 1.20.
      expect.objectContaining({ date: "2024-04-04", type: "buy", isin: "FR0000000001", quantity: "50", fee: "3.20" }),
      expect.objectContaining({
        date: "2024-11-15",
        type: "reward",
        symbol: "EUR",
        assetType: "cash",
        quantity: "0.35",
      }),
      expect.objectContaining({
        date: "2024-11-20",
        type: "buy",
        isin: "FR0000000002",
        quantity: "30",
        price: "0",
        notes: "CLAIMEMISSIE: Koop 30 @ 0 EUR",
      }),
      expect.objectContaining({ date: "2024-11-30", type: "fee", symbol: "EUR", assetType: "cash", quantity: "0.12" }),
      expect.objectContaining({
        date: "2024-12-12",
        type: "sell",
        isin: "FR0000000002",
        notes: "DELISTING: Verkoop 30 @ 0 EUR",
      }),
    ]);
    expect(skipped).toEqual({ "Interest lines without an amount": 1 });
    expect(notes.filter((n) => n.startsWith("Corporate action read as a purchase or sale"))).toHaveLength(2);
  });

  it("Lightyear: trades with costs, dividends net of fund fees, cash left out", () => {
    const { id, rows, skipped } = read(
      lines(
        "Date,Reference,Ticker,ISIN,Type,Quantity,CCY,Price/share,Gross Amount,FX Rate,Fee,Net Amt.,Tax Amt.",
        "14/01/2026 15:31:07,OR-AB12CD34EF,VBWLD,IE0000000001,Buy,10.000000000,EUR,120.500000000,1206.50,,1.50,1205.00,",
        "20/03/2026 16:02:44,OR-GH56IJ78KL,VBWLD,IE0000000001,Sell,4.000000000,EUR,130.000000000,520.00,,1.00,519.00,",
        "02/04/2026 06:10:12,DD-MN90OP12QR,VBUS,US0000000002,Dividend,,USD,,10.00,,,8.50,1.50",
        "01/05/2026 13:20:00,IN-ST34UV56WX,VBGELD,IE0000000003,Distribution,,EUR,,3.20,,0.10,3.10,0.00",
        "01/05/2026 03:15:00,IN-YZ78AB90CD,,,Interest,,EUR,,0.42,,,0.42,0.00",
        "05/01/2026 09:00:00,DT-EF12GH34IJ,,,Deposit,,EUR,,500.00,,0.00,500.00,",
        "10/02/2026 11:45:30,CN-KL56MN78OP,USD,,Conversion,,USD,,108.00,0.92593,,108.00,",
        "10/02/2026 11:45:30,CN-KL56MN78OP,EUR,,Conversion,,EUR,,-100.35,1.08000,0.35,-100.00,",
      ),
    );
    expect(id).toBe("lightyear");
    expect(rows).toEqual([
      expect.objectContaining({
        date: "2026-01-14",
        time: "15:31:07",
        type: "buy",
        isin: "IE0000000001",
        symbol: "VBWLD",
        price: "120.500000000",
        currency: "EUR",
        fee: "1.5",
        id: "lightyear:OR-AB12CD34EF",
      }),
      expect.objectContaining({ date: "2026-03-20", type: "sell", isin: "IE0000000001", fee: "1" }),
      // Gross 10.00 = net 8.50 + tax 1.50, in the security's currency.
      expect.objectContaining({
        date: "2026-04-02",
        type: "dividend",
        currency: "USD",
        amount: "10",
        tax: "1.5",
      }),
      // A money market fund's 3.20 less its 0.10 fee.
      expect.objectContaining({ date: "2026-05-01", type: "dividend", isin: "IE0000000003", amount: "3.1" }),
    ]);
    expect(rows.map((r) => Number(r.quantity ?? 0))).toEqual([10, 4, 0, 0]);
    // Interest, the deposit and the two sides of the currency exchange.
    expect(skipped).toEqual({ "Cash movements (deposits, withdrawals, currency exchange)": 4 });
  });

  it("Scalable Capital: German notation, savings plans, gross distributions and the cash", () => {
    const { id, rows, skipped, r } = read(
      lines(
        "date;time;status;reference;description;assetType;type;isin;shares;price;amount;fee;tax;currency",
        '2026-01-05;01:00:00;Executed;"AB12CD34EF56GH78IJ90KL";"Voorbeeldstorting";Cash;Deposit;;;;1.500,00;0,00;;EUR',
        '2026-01-06;10:15:30;Executed;"SCALaB3cD4eF5gH";"Voorbeeld Wereld ETF (Acc)";Security;Buy;IE0000000001;12;85,40;-1.024,80;0,00;0,00;EUR',
        '2026-02-02;14:02:11;Executed;"SCALiJ6kL7mN8oP";"Voorbeeld Wereld ETF (Acc)";Security;Savings plan;IE0000000001;1,171;85,39;-99,99169;0,00;0,00;EUR',
        '2026-03-01;09:00:00;Canceled;"SCALzZ1yY2xX3wW";"Voorbeeld Wereld ETF (Acc)";Security;Buy;IE0000000001;5;80,00;-400,00;0,00;0,00;EUR',
        '2026-05-20;16:40:05;Executed;"SCALqR9sT0uV1wX";"Voorbeeld Aandeel";Security;Sell;NL0000000002;30;41,10;1.233,00;0,00;0,00;EUR',
        '2026-05-21;02:00:00;Executed;"WWEK 10000002";"Voorbeeld Aandeel";Cash;Taxes;NL0000000002;;;-3,10;0,00;;EUR',
        '2026-06-15;02:00:00;Executed;"WWEK 10000001";"Voorbeeld Dividend ETF (Dist)";Cash;Distribution;IE0000000003;;;12,75;0,00;2,25;EUR',
        '2026-07-01;02:00:00;Executed;"CD34EF56GH78IJ90KL12MN";"Voorbeeldopname";Cash;Withdrawal;;;;-200,00;0,00;;EUR',
      ),
    );
    expect(id).toBe("scalable-capital");
    expect(r.result.mapping).toEqual({ settleCash: true, feeCurrency: "EUR" });
    expect(rows).toEqual([
      // "1.500,00" is fifteen hundred, not one and a half.
      expect.objectContaining({
        date: "2026-01-05",
        type: "deposit",
        symbol: "EUR",
        assetType: "cash",
        quantity: "1500",
      }),
      expect.objectContaining({
        date: "2026-01-06",
        type: "buy",
        isin: "IE0000000001",
        name: "Voorbeeld Wereld ETF (Acc)",
        quantity: "12",
        price: "85.40",
        id: "scalable:SCALaB3cD4eF5gH",
      }),
      expect.objectContaining({ date: "2026-02-02", type: "buy", quantity: "1.171", price: "85.39" }),
      expect.objectContaining({
        date: "2026-05-20",
        type: "sell",
        isin: "NL0000000002",
        quantity: "30",
        price: "41.10",
      }),
      expect.objectContaining({ date: "2026-05-21", type: "fee", symbol: "EUR", quantity: "3.1" }),
      // Paid out 12.75 after 2.25 tax: 15.00 gross.
      expect.objectContaining({ date: "2026-06-15", type: "dividend", amount: "15", tax: "2.25" }),
      expect.objectContaining({ date: "2026-07-01", type: "withdrawal", symbol: "EUR", quantity: "200" }),
    ]);
    expect(skipped).toEqual({ "Orders that weren't executed": 1 });
  });

  it("DEGIRO transactions: sign gives buy or sell, AutoFX counts as cost", () => {
    const { id, rows } = read(
      lines(
        "Date,Time,Product,ISIN,Reference exchange,Venue,Quantity,Price,,Local value,,Value,,Exchange rate,AutoFX Fee,Transaction and/or third,,Total,,Order ID",
        "11-07-2024,15:31,ASML HOLDING,NL0010273215,EAM,XAMS,-3,980.00,EUR,2940.00,EUR,2940.00,EUR,,0.00,-2.00,EUR,2938.00,EUR,b-2",
        "15-06-2023,15:40,APPLE INC,US0378331005,NDQ,XNAS,5,185.50,USD,-927.50,USD,-850.92,EUR,1.0900,-2.13,-1.00,EUR,-854.05,EUR,d-4",
        "15-06-2023,10:02,ASML HOLDING,NL0010273215,EAM,XAMS,8,650.00,EUR,-5200.00,EUR,-5200.00,EUR,,0.00,-2.00,EUR,-5202.00,EUR,c-3",
      ),
    );
    expect(id).toBe("degiro-transactions");
    expect(rows).toEqual([
      expect.objectContaining({
        date: "2023-06-15",
        time: "10:02",
        type: "buy",
        quantity: "8",
        price: "650.00",
        fee: "2.00",
        id: "degiro:c-3",
      }),
      expect.objectContaining({
        date: "2023-06-15",
        type: "buy",
        isin: "US0378331005",
        currency: "USD",
        price: "185.50",
        fee: "3.13",
      }),
      expect.objectContaining({ date: "2024-07-11", type: "sell", quantity: "3", price: "980.00", fee: "2.00" }),
    ]);
  });

  it("Bitvavo: trades in euros with cash, coin fees on their own line", () => {
    const { id, rows, skipped, r } = read(
      lines(
        "Timezone,Date,Time,Type,Currency,Amount,Quote Currency,Quote Price,Received / Paid Currency,Received / Paid Amount,Fee currency,Fee amount,Status,Transaction ID,Address",
        "Europe/Amsterdam,2024-03-02,10:00:00,staking,ETH,0.0012,,,,,,,Completed,t-5,",
        "Europe/Amsterdam,2024-03-01,11:37:41,withdrawal,BTC,-0.0099,,,,,BTC,0.0001,Completed,t-4,bc1qxyz",
        "Europe/Amsterdam,2024-03-01,11:00:00,buy,BTC,0.01,EUR,58000,EUR,-581.45,EUR,1.45,Canceled,t-x,",
        "Europe/Amsterdam,2024-02-20,15:15:46.637,sell,ETH,-0.1,EUR,2800,EUR,279.30,EUR,0.70,Completed,t-3,",
        "Europe/Amsterdam,2024-02-01,10:29:44.141,buy,BTC,0.01,EUR,40000,EUR,-401.00,EUR,1.00,Completed,t-2,",
        "Europe/Amsterdam,2024-02-01,10:29:03,deposit,EUR,1000,,,,,EUR,0,Completed,t-1,NL12***34",
      ),
    );
    expect(id).toBe("bitvavo");
    expect(r.result.mapping).toEqual({ settleCash: true });
    expect(rows.map((x) => [x.type, x.symbol, x.quantity, x.price ?? "", x.fee ?? ""])).toEqual([
      ["deposit", "EUR", "1000", "", ""],
      ["buy", "BTC", "0.01", "40000", "1.00"],
      ["sell", "ETH", "0.1", "2800", "0.70"],
      // 0.0099 left the account, 0.0001 of it the network fee.
      ["withdrawal", "BTC", "0.0098", "", ""],
      ["fee", "BTC", "0.0001", "", ""],
      ["reward", "ETH", "0.0012", "", ""],
    ]);
    expect(rows[1]).toMatchObject({ time: "10:29:44", currency: "EUR", id: "t-2" });
    expect(skipped).toEqual({ "Cancelled or pending": 1 });
  });

  it("Coinbase: conversions become a sale and a purchase, rewards keep their value", () => {
    const { id, rows, skipped } = read(
      lines(
        "Transactions",
        "User,Jane,abc",
        "ID,Timestamp,Transaction Type,Asset,Quantity Transacted,Price Currency,Price at Transaction,Subtotal,Total (inclusive of fees and/or spread),Fees and/or Spread,Notes",
        "c-5,2025-01-17 16:57:02 UTC,Staking Income,ETH,0.0001,EUR,€3300.00,€0.33,€0.33,€0.00,",
        "c-4,2025-01-07 19:26:56 UTC,Send,ETH,-0.1,EUR,€3302.65,-€330.27,-€330.27,€0.00,Sent 0.1 ETH",
        "c-3,2024-12-05 06:33:40 UTC,Convert,BTC,0.002,EUR,€96000.00,€185.00,€192.00,,Converted 0.002 BTC to 80.5 XRP",
        "c-2,2024-11-30 10:00:00 UTC,Deposit,EUR,100,EUR,€1.00,€100.00,€100.00,€0.00,",
        "c-1,2022-03-25 06:45:27 UTC,Buy,BTC,0.0025,EUR,€40000.00,€100.00,€102.99,€2.99,Bought 0.0025 BTC for 102.99 EUR",
      ),
    );
    expect(id).toBe("coinbase");
    expect(rows).toEqual([
      expect.objectContaining({
        date: "2022-03-25T06:45:27Z",
        type: "buy",
        symbol: "BTC",
        quantity: "0.0025",
        price: "40000.00",
        fee: "2.99",
        currency: "EUR",
      }),
      expect.objectContaining({
        type: "sell",
        symbol: "BTC",
        quantity: "0.002",
        price: "96000.00",
        fee: "7.00000000",
        id: "c-3:sell",
      }),
      expect.objectContaining({ type: "buy", symbol: "XRP", quantity: "80.5", total: "185.00", id: "c-3:buy" }),
      expect.objectContaining({ type: "withdrawal", symbol: "ETH", quantity: "0.1" }),
      expect.objectContaining({ type: "reward", symbol: "ETH", quantity: "0.0001", price: "3300.00" }),
    ]);
    expect(skipped).toEqual({ "Euro deposits and withdrawals": 1 });
  });

  it("Crypto.com App: trades, card buys, rewards, paired balance conversions; Earn moves and euros left out", () => {
    const { id, rows, skipped } = read(
      lines(
        "Timestamp (UTC),Transaction Description,Currency,Amount,To Currency,To Amount,Native Currency,Native Amount,Native Amount (in USD),Transaction Kind,Transaction Hash",
        // Newest first, as the app exports it.
        "2025-06-01 09:00:00,Transfer: App wallet -> Exchange,CRO,-100.0,,,EUR,9.00,10.50,crypto_to_exchange_transfer,",
        "2025-03-31 12:00:00,Balance Conversion,USDC,50.0,,,EUR,46.00,53.00,crypto_wallet_swap_credited,",
        "2025-03-31 12:00:00,Balance Conversion,USDT,-50.0,,,EUR,45.90,52.90,crypto_wallet_swap_debited,",
        "2025-02-10 08:00:00,CRO Stake Reward,CRO,2.5,,,EUR,0.25,0.29,finance.lockup.dpos_compound_interest.crypto_wallet,",
        "2025-02-03 08:00:00,Card Cashback,CRO,4.0,,,EUR,0.40,0.46,referral_card_cashback,",
        "2025-02-02 08:00:00,USDT -> EUR,USDT,-30.0,,,EUR,-27.50,-32.00,card_top_up,",
        "2025-01-20 07:00:00,Cardholder CRO Stake,CRO,-1000.0,,,EUR,90.00,105.00,finance.lockup.dpos_lock.crypto_wallet,",
        "2025-01-15 10:00:00,XRP -> BTC,XRP,-100.0,BTC,0.002,EUR,190.00,221.00,crypto_exchange,",
        "2025-01-10 10:00:00,Buy BTC,EUR,-200.0,BTC,0.0021,EUR,200.00,233.00,viban_purchase,",
        "2025-01-05 10:00:00,Buy CRO,CRO,1100.0,,,EUR,99.00,115.00,crypto_purchase,",
        "2025-01-04 10:00:00,XRP Deposit,XRP,100.0,,,EUR,180.00,210.00,crypto_deposit,0xabc",
        "2025-01-03 10:00:00,EUR Deposit,EUR,500.0,,,EUR,500.00,582.00,viban_deposit,",
      ),
    );
    expect(id).toBe("crypto-com");
    expect(rows).toEqual([
      expect.objectContaining({ date: "2025-01-04T10:00:00Z", type: "deposit", symbol: "XRP", total: "180.00" }),
      // Bought by card: the value in euros is what it cost.
      expect.objectContaining({ type: "buy", symbol: "CRO", quantity: "1100.0", total: "99.00", currency: "EUR" }),
      // From the euro wallet.
      expect.objectContaining({ type: "buy", symbol: "BTC", quantity: "0.0021", total: "200.0", currency: "EUR" }),
      // One coin for another: a sale and a purchase at the same value.
      expect.objectContaining({ type: "sell", symbol: "XRP", quantity: "100.0", total: "190.00" }),
      expect.objectContaining({ type: "buy", symbol: "BTC", quantity: "0.002", total: "190.00" }),
      // Sold to top up the card; the value's minus sign doesn't matter.
      expect.objectContaining({ type: "sell", symbol: "USDT", quantity: "30.0", total: "27.50" }),
      expect.objectContaining({ type: "reward", symbol: "CRO", quantity: "4.0", total: "0.40" }),
      expect.objectContaining({ type: "reward", symbol: "CRO", quantity: "2.5", total: "0.25" }),
      expect.objectContaining({ type: "withdrawal", symbol: "CRO", quantity: "100.0" }),
      // The two halves of the conversion, after the rest.
      expect.objectContaining({ type: "sell", symbol: "USDT", quantity: "50.0", total: "45.90" }),
      expect.objectContaining({ type: "buy", symbol: "USDC", quantity: "50.0", total: "46.00" }),
    ]);
    expect(rows).toHaveLength(11);
    expect(skipped).toEqual({
      "Euro deposits and withdrawals": 1,
      "Moves within Crypto.com (Earn, staking, lockups)": 1,
    });
  });

  it("Crypto.com App: unknown kinds and a conversion without its other half are named", () => {
    const { rows, skipped } = read(
      lines(
        "Timestamp (UTC),Transaction Description,Currency,Amount,To Currency,To Amount,Native Currency,Native Amount,Native Amount (in USD),Transaction Kind,Transaction Hash",
        "2025-03-31 12:00:00,Balance Conversion,USDT,-50.0,,,EUR,45.90,52.90,crypto_wallet_swap_debited,",
        "2025-03-01 12:00:00,Something new,CRO,5.0,,,EUR,0.50,0.58,brand_new_kind,",
      ),
    );
    expect(rows).toEqual([]);
    expect(skipped).toEqual({
      "Other kinds: brand_new_kind": 1,
      "Balance conversions without their other half": 1,
    });
  });

  it("Kraken ledgers: trades paired by reference, staking rewards, euro cash", () => {
    const { id, rows, r } = read(
      lines(
        '"txid","refid","time","type","subtype","aclass","asset","wallet","amount","fee","balance"',
        '"L1","R1","2024-01-02 09:00:00","deposit","","currency","ZEUR","spot / main",1000.0000,0.0000,1000.0000',
        '"L2","R2","2024-01-03 10:00:00","trade","","currency","ZEUR","spot / main",-500.0000,1.3000,498.7000',
        '"L3","R2","2024-01-03 10:00:00","trade","","currency","XXBT","spot / main",0.0125000000,0.0000000000,0.0125000000',
        '"L4","R3","2024-01-05 00:00:00","staking","","currency","DOT.S","earn / bonded",0.0500000000,0.0000000000,0.0500000000',
      ),
    );
    expect(id).toBe("kraken-ledgers");
    expect(r.result.mapping).toEqual({ settleCash: true });
    expect(rows.map((x) => [x.type, x.symbol, x.quantity])).toEqual([
      ["deposit", "EUR", "1000"],
      ["buy", "BTC", "0.0125"],
      ["reward", "DOT", "0.05"],
    ]);
    // 500 paid plus 1.30 fee: a purchase of 500 with 1.30 costs.
    expect(rows[1]).toMatchObject({ total: "500.00000000", fee: "1.30000000", currency: "EUR" });
  });

  it("Rabobank Beleggen: fund trades, dividend tax from gross minus net, costs and interest", () => {
    const { id, rows, r } = read(
      "\uFEFF" +
        lines(
          "Portefeuille;Naam;Datum;Type mutatie;Valuta mutatie;Volume;Koers;Valuta koers;Valuta kosten €;Waarde;Bedrag;Isin code;Tijd;Beurs",
          "12345678;1895 Wereld Aandelen Enh Indexfonds;08-02-2024;Verkoop Fondsen;EUR;-1,2343;134,776 ;EUR;0;166,36;166,36;NL0014065450;11:46:02.924;Clearstream - Vestima",
          "12345678;;06-01-2024;Tarieven en services;EUR;0;0,00 ;EUR;0;0,00;-17,44;;;",
          "12345678;;03-01-2024;Rente beleggersrekening;EUR;0;0,00 ;EUR;0;0,00;1,63;;;",
          "12345678;1895 Wereld Aandelen Enh Indexfonds;28-12-2023;Koop Fondsen;EUR;1,3699;127,224 ;EUR;0,50;174,28;-174,78;NL0014065450;12:11:49.471;Clearstream - Vestima",
          "12345678;;27-12-2023;Storting / opname;EUR;0;0,00 ;EUR;0;0,00;250,00;;;",
          "12345678;1895 Wereld Aandelen Enh Indexfonds;28-11-2023;Contant dividend;EUR;60,5563;1,331559 ;EUR;0;80,63;68,54;NL0014065450;;",
        ),
    );
    expect(id).toBe("rabobank");
    expect(r.result.mapping).toEqual({ feeCurrency: "EUR", settleCash: true });
    expect(rows.map((x) => [x.date, x.type, x.quantity ?? x.amount, x.price ?? x.tax ?? "", x.fee ?? ""])).toEqual([
      ["2023-11-28", "dividend", "80.63", "12.09", ""],
      ["2023-12-27", "deposit", "250.00", "", ""],
      ["2023-12-28", "buy", "1.3699", "127.224", "0.5"],
      ["2024-01-03", "reward", "1.63", "", ""],
      ["2024-01-06", "fee", "17.44", "", ""],
      ["2024-02-08", "sell", "1.2343", "134.776", ""],
    ]);
  });

  it("Trade Republic: net values with costs, deposits and interest", () => {
    const { id, rows } = read(
      lines(
        "Datum;Transactietype;Waarde (netto);Opmerking;ISIN;Aantal;Kosten;Belasting",
        "2024-12-10T10:25:01;Verkoop;86,71;Tesla;US88160R1014;0,2625;-1,00;",
        "2024-11-30;Rente;0,84;;;;;",
        "2024-09-25;Dividend;0,03;FTSE Developed World USD (Dist);IE00BKX55T58;;;",
        "2024-07-23;Aankoop;-5;FTSE Developed World USD (Dist);IE00BKX55T58;0,052361;;",
        "2024-07-01;Storting;100;Jane;;;;",
      ),
    );
    expect(id).toBe("trade-republic");
    expect(rows.map((x) => [x.date, x.type, x.quantity ?? x.amount, x.total ?? "", x.fee ?? ""])).toEqual([
      ["2024-07-01", "deposit", "100", "", ""],
      ["2024-07-23", "buy", "0.052361", "5", ""],
      ["2024-09-25", "dividend", "0.03", "", ""],
      ["2024-11-30", "reward", "0.84", "", ""],
      ["2024-12-10", "sell", "0.2625", "87.71", "1"],
    ]);
    expect(rows[4]).toMatchObject({ time: "10:25:01", isin: "US88160R1014" });
  });

  it("Trading 212: costs from every fee column, dividends gross in the security's currency, pence to pounds", () => {
    const { id, rows, skipped } = read(
      lines(
        "Action,Time,ISIN,Ticker,Name,No. of shares,Price / share,Currency (Price / share),Exchange rate,Result,Currency (Result),Total,Currency (Total),Withholding tax,Currency (Withholding tax),Notes,ID,Currency conversion fee,Currency (Currency conversion fee)",
        'Deposit,2023-12-18 11:45:06.326,,,,,,,,,,31.00,"EUR",,,"Transaction ID: X",dep-1,,',
        'Market buy,2023-12-18 14:30:03.613,US17275R1023,CSCO,"Cisco Systems",2.0000000000,49.96,USD,1.09303,,"EUR",91.55,"EUR",,,,EOF1,0.14,"EUR"',
        'Market sell,2023-12-26 14:30:05.104,GB00B03MLX29,RDSA,"Shell",1.0000000000,2650.00,GBX,0.86,1.20,"EUR",30.70,"EUR",,,,EOF2,,',
        'Dividend (Dividend),2023-12-27 12:05:25,US17275R1023,CSCO,"Cisco Systems",2.0000000000,0.39,USD,Not available,,,0.60,"EUR",0.12,USD,,,,',
      ),
    );
    expect(id).toBe("trading212");
    expect(rows).toEqual([
      expect.objectContaining({
        date: "2023-12-18T14:30:03Z",
        type: "buy",
        isin: "US17275R1023",
        quantity: "2.0000000000",
        price: "49.96",
        currency: "USD",
        fee: "0.14",
        id: "EOF1",
      }),
      expect.objectContaining({ type: "sell", price: "26.5", currency: "GBP" }),
      expect.objectContaining({ type: "dividend", currency: "USD", amount: "0.78", tax: "0.12" }),
    ]);
    expect(skipped).toEqual({ "Cash movements (deposits, withdrawals, currency exchange)": 1 });
  });

  it("BUX: the trading fee joins its trade; subscription fees are left out", () => {
    const { id, rows, skipped } = read(
      lines(
        "Transaction Time (CET),Transaction Category,Transaction Type,Transfer Type,Transaction Amount,Transaction Currency,Cash Balance Amount,Asset Id,Asset Name,Asset Quantity,Asset Price,Asset Currency,Currency Pair,Exchange Rate,Profit And Loss Amount,Profit And Loss Currency,Dividend Currency,Dividend Gross Amount,Dividend Net Amount,Dividend Tax Amount,Transaction Description",
        "2023-05-05 11:38:06.646000,dividends,Cash Dividend,,16.4,EUR,53.32,NL0011821202,ING,,,,,,,,EUR,19.29,16.4,2.89,",
        "2023-05-02 11:07:12.872000,fees,Subscription Fee,,-2.99,EUR,36.92,,,,,,,,,,,,,,",
        "2023-03-21 13:37:29.384000,fees,Trading Fee,,-1.5,EUR,46.99,NL0011821202,ING,,,,,,,,,,,,",
        "2023-03-21 13:37:29.383000,trades,Buy Trade,,-542.92,EUR,48.49,NL0011821202,ING,49,11.08,EUR,,,,,,,,,Transaction Amount: 542.92",
        "2020-11-18 12:15:23.606000,deposits,Sepa Deposit,,500,EUR,500,,,,,,,,,,,,,,",
      ),
    );
    expect(id).toBe("bux");
    expect(rows).toEqual([
      expect.objectContaining({
        date: "2023-03-21",
        time: "13:37:29",
        type: "buy",
        isin: "NL0011821202",
        quantity: "49",
        price: "11.08",
        fee: "1.50",
      }),
      expect.objectContaining({ type: "dividend", currency: "EUR", amount: "19.29", tax: "2.89" }),
    ]);
    expect(skipped).toEqual({
      "Costs without a trade (subscription, service fees)": 1,
      "Cash movements (deposits, withdrawals, currency exchange)": 1,
    });
  });

  it("Saxo: commission worked out from the amount, dividends net plus withholding tax", () => {
    const { id, rows } = read(
      lines(
        "Client ID,Trade Date,Value Date,Type,Instrument,Instrument ISIN,Instrument currency,Exchange Description,Instrument Symbol,Event,Amount,Order ID,Conversion Rate",
        ',02-Apr-2025,02-Apr-2025,Corporate action,NVIDIA Corp.,US67066G1040,USD,NASDAQ,NVDA:xnas,Withholding tax,"-0,18",,0.92',
        ',02-Apr-2025,02-Apr-2025,Corporate action,NVIDIA Corp.,US67066G1040,USD,NASDAQ,NVDA:xnas,Dividend,"1,00",,0.92',
        ',02-Jan-2025,02-Jan-2025,Cash amount,,,EUR,,,Custody Fee,"-3,91",,1',
        ',30-Dec-2024,31-Dec-2024,Trade,NVIDIA Corp.,US67066G1040,USD,NASDAQ,NVDA:xnas,Buy 3 @ 134.85 USD,"-373,10",5001,0.92',
      ),
    );
    expect(id).toBe("saxo");
    expect(rows[0]).toMatchObject({
      date: "2024-12-30",
      type: "buy",
      isin: "US67066G1040",
      symbol: "NVDA",
      quantity: "3",
      price: "134.85",
      currency: "USD",
      id: "saxo:5001",
    });
    // 373.10 EUR / 0.92 = 405.54 USD for 404.55 of shares: 0.99 commission.
    expect(rows[0]!.fee).toBe("0.99");
    // 1.00 EUR net + 0.18 tax, in dollars.
    expect(rows[1]).toMatchObject({ type: "dividend", currency: "USD", amount: "1.2826", tax: "0.1957" });
  });

  it("Revolut stocks: commission from the total, cash left out", () => {
    const { id, rows } = read(
      lines(
        "Date,Ticker,Type,Quantity,Price per share,Total Amount,Currency,FX Rate",
        "2023-09-22T13:30:10.514Z,O,BUY - MARKET,1.5,$52.00,$78.99,USD,1.0665",
        "2023-12-13T08:40:00.835101Z,O,DIVIDEND,,,$0.38,USD,1.1179",
        "2019-11-15T23:15:55.878985Z,,CASH TOP-UP,,,$5.22,USD,1.1055",
      ),
    );
    expect(id).toBe("revolut");
    expect(rows).toEqual([
      expect.objectContaining({
        type: "buy",
        symbol: "O",
        quantity: "1.5",
        price: "52.00",
        currency: "USD",
        fee: "0.99",
      }),
      expect.objectContaining({ type: "dividend", symbol: "O", amount: "0.3800" }),
    ]);
  });

  it("eToro: positions opened and closed, dividends, stamp duty on its purchase; cash and CFDs left out", () => {
    const { id, rows, skipped, notes } = read(
      lines(
        "Date,Type,Details,Amount,Units,Realized Equity Change,Realized Equity,Balance,Position ID,Asset type,NWA",
        '02/01/2025 00:10:00,Interest Payment,,0.05,-,0.05,"2,000.00",10.00,-,,0.00',
        '03/01/2025 00:10:00,Dividend,NKE/USD,0.21,-,0.21,"2,000.00",10.21,111,Stocks,0.00',
        '06/01/2025 14:30:00,Open Position,AAPL/USD,"1,250.00",5.5,0.00,"2,000.00",0.00,222,Stocks,0.00',
        '06/01/2025 14:31:00,Open Position,BARC.L/GBX,100.00,30.25,0.00,"2,000.00",0.00,333,Stocks,0.00',
        '06/01/2025 14:31:00,SDRT,BARC.L/GBX,(0.50),-,(0.50),"2,000.00",0.00,333,Stocks,0.00',
        '07/01/2025 10:00:00,Open Position,ASML.NV/EUR,200.00,0.25,0.00,"2,000.00",0.00,444,Stocks,0.00',
        '08/01/2025 10:00:00,Open Position,BTC/USD,500.00,0.005,0.00,"2,000.00",0.00,555,Crypto,0.00',
        '15/04/2025 14:00:00,Open Position,NKE/USD," 100,00 ",0.4,0.00," 1 757,95 "," 12,87 ",666,CFD," 0,00 "',
        '16/04/2025 00:46:00,Overnight fee,Daily,"(0,10)",-,"(0,10)"," 1 757,85 "," 12,77 ",666,CFD," 0,00 "',
        '20/05/2025 20:59:00,Position closed,AAPL/USD," 1 400,00 ",5.5," 150,00 "," 2 150,00 "," 1 400,00 ",222,Stocks," 0,00 "',
        '21/05/2025 13:00:00,Withdraw Request,-,-100.00,-,-100.00,"2,150.00",0.00,-,,0.00',
        '21/05/2025 13:00:00,Withdrawal Conversion Fee,-,-1.36,-,0.00,"2,150.00",0.00,-,,0.00',
        '01/06/2025 09:00:00,Staking,ETH/USD,0.01,-,0.01,"2,150.00",0.00,-,Crypto,0.00',
      ),
    );
    expect(id).toBe("etoro");
    expect(rows).toEqual([
      expect.objectContaining({
        date: "2025-01-03",
        time: "00:10:00",
        type: "dividend",
        symbol: "NKE",
        amount: "0.21",
        currency: "USD",
      }),
      expect.objectContaining({
        type: "buy",
        symbol: "AAPL",
        assetType: "stock",
        quantity: "5.5",
        total: "1250.00",
        currency: "USD",
      }),
      // The stamp duty joins its purchase.
      expect.objectContaining({ type: "buy", symbol: "BARC.L", quantity: "30.25", total: "100.00", fee: "0.5" }),
      // eToro's ".NV" is Yahoo's ".AS".
      expect.objectContaining({ type: "buy", symbol: "ASML.AS", quantity: "0.25", total: "200.00" }),
      expect.objectContaining({ type: "buy", symbol: "BTC", assetType: "crypto", quantity: "0.005", total: "500.00" }),
      // "1 400,00": a space between the thousands and a decimal comma.
      expect.objectContaining({ type: "sell", symbol: "AAPL", quantity: "5.5", total: "1400.00", notes: "eToro 222" }),
    ]);
    expect(skipped).toEqual({
      "Cash: deposits, withdrawals, interest and their fees": 3,
      "CFDs (no ownership of the underlying)": 2,
      "Other kinds: Staking": 1,
    });
    expect(notes).toContain("eToro amounts are read as US dollars, the currency of an eToro account.");
  });

  it("leaves other files alone", () => {
    expect(recognise("date,type,symbol,quantity,price\n2024-01-01,buy,BTC,1,1\n")).toBeNull();
  });
});

describe("importing a recognised export", () => {
  let t: TestApp | undefined;
  afterEach(async () => t?.close());

  it("previews, imports, finds the same rows again, and can be read as is", async () => {
    t = await createTestApp();
    const acc = (await t.api("POST", "/api/accounts", { name: "DEGIRO", kind: "broker" })).json();
    const content = lines(
      "Datum,Tijd,Valutadatum,Product,ISIN,Omschrijving,FX,Mutatie,,Saldo,,Order Id",
      '05-03-2024,09:10,05-03-2024,ISHARES CORE MSCI WORLD,IE00B4L5Y983,DEGIRO Transactiekosten en/of kosten van derden,,EUR,"-1,00",EUR,"112,60",aaaa-1111',
      '05-03-2024,09:10,05-03-2024,ISHARES CORE MSCI WORLD,IE00B4L5Y983,"Koop 10 @ 88,14 EUR",,EUR,"-881,40",EUR,"113,60",aaaa-1111',
      '14-12-2023,10:00,14-12-2023,,,iDEAL Deposit,,EUR,"500,00",EUR,"500,00",',
    );
    const upload = async (raw?: boolean) =>
      (await t!.api("POST", "/api/import/upload", { fileName: "Account.csv", content, raw })).json();
    const up = await upload();
    expect(up.format).toMatchObject({ id: "degiro-account", label: "DEGIRO account statement", rows: 1 });
    expect(up.preset).toBe("DEGIRO account statement");
    expect(up.mapping.feeCurrency).toBe("EUR");

    const preview = (u: any) =>
      t!.api("POST", "/api/import/preview", { uploadId: u.uploadId, accountId: acc.id, mapping: u.mapping });
    const plan = (await preview(up)).json();
    expect(plan.summary.new).toBe(1);
    expect(plan.warnings).toContain("Left out: Cash movements (deposits, withdrawals, currency exchange) (1)");
    expect(plan.rows[0]).toMatchObject({ type: "buy", quantity: "10", price: "88.14", fee: "1" });

    const done = (
      await t.api("POST", "/api/import/commit", { uploadId: up.uploadId, accountId: acc.id, mapping: up.mapping })
    ).json();
    expect(done.inserted).toBe(1);
    const again = await upload();
    expect((await preview(again)).json().summary).toMatchObject({ new: 0, duplicate: 1 });

    // As is: the file's own columns, guessed.
    const plain = await upload(true);
    expect(plain.format).toBeNull();
    expect(plain.preset).toBeNull();
  });

  it("previews an eToro statement without errors, prices in dollars", async () => {
    t = await createTestApp();
    const acc = (await t.api("POST", "/api/accounts", { name: "eToro", kind: "broker" })).json();
    const content = lines(
      "Date,Type,Details,Amount,Units,Realized Equity Change,Realized Equity,Balance,Position ID,Asset type,NWA",
      "06/01/2025 14:30:00,Open Position,AAPL/USD,1250.00,5,0.00,2000.00,0.00,222,Stocks,0.00",
      "03/02/2025 00:10:00,Dividend,AAPL/USD,1.25,-,1.25,2000.00,1.25,222,Stocks,0.00",
      "20/05/2025 20:59:00,Position closed,AAPL/USD,1400.00,5,150.00,2150.00,1400.00,222,Stocks,0.00",
    );
    const up = (await t.api("POST", "/api/import/upload", { fileName: "statement.csv", content })).json();
    expect(up.format).toMatchObject({ id: "etoro", rows: 3 });
    const plan = (
      await t.api("POST", "/api/import/preview", { uploadId: up.uploadId, accountId: acc.id, mapping: up.mapping })
    ).json();
    expect(plan.summary).toMatchObject({ new: 3 });
    expect(plan.rows.map((r: any) => [r.type, r.quantity ?? r.amount, r.price, r.currency])).toEqual([
      ["buy", "5", "250", "USD"],
      ["dividend", "1.25", undefined, "USD"],
      ["sell", "5", "280", "USD"],
    ]);
  });

  it("previews a Crypto.com App export without errors, and finds it again", async () => {
    t = await createTestApp();
    const acc = (await t.api("POST", "/api/accounts", { name: "Crypto.com", kind: "exchange" })).json();
    const content = lines(
      "Timestamp (UTC),Transaction Description,Currency,Amount,To Currency,To Amount,Native Currency,Native Amount,Native Amount (in USD),Transaction Kind,Transaction Hash",
      "2025-02-03 08:00:00,Card Cashback,BTC,0.00001,,,EUR,0.90,1.05,referral_card_cashback,",
      "2025-01-15 10:00:00,BTC -> EUR,BTC,-0.001,EUR,90.00,EUR,90.00,105.00,crypto_viban_exchange,",
      "2025-01-10 10:00:00,Buy BTC,EUR,-200.0,BTC,0.0021,EUR,200.00,233.00,viban_purchase,",
    );
    const upload = async () =>
      (await t!.api("POST", "/api/import/upload", { fileName: "crypto_transactions_record.csv", content })).json();
    const up = await upload();
    expect(up.format).toMatchObject({ id: "crypto-com", rows: 3 });
    const preview = async (u: any) =>
      (
        await t!.api("POST", "/api/import/preview", { uploadId: u.uploadId, accountId: acc.id, mapping: u.mapping })
      ).json();
    const plan = await preview(up);
    expect(plan.summary).toMatchObject({ new: 3 });
    expect(plan.rows.map((r: any) => [r.type, r.quantity, r.price])).toEqual([
      ["buy", "0.0021", expect.stringMatching(/^95238\.09/)],
      ["sell", "0.001", "90000"],
      ["reward", "0.00001", "90000"],
    ]);
    await t.api("POST", "/api/import/commit", { uploadId: up.uploadId, accountId: acc.id, mapping: up.mapping });
    expect((await preview(await upload())).summary).toMatchObject({ new: 0, duplicate: 3 });
  });
});
