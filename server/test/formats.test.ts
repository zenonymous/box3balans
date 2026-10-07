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
      ["withdrawal", "BTC", "0.0099", "", ""],
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
});
