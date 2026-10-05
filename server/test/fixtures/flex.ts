// IBKR Activity Flex Query statement (XML) covering trades, FX, dividends, interest and positions.
export const FLEX_XML = `<?xml version="1.0" encoding="UTF-8"?>
<FlexQueryResponse queryName="pd" type="AF">
<FlexStatements count="1">
<FlexStatement accountId="U1234567" fromDate="20240101" toDate="20241231">
<Trades>
<Trade assetCategory="STK" subCategory="ETF" symbol="IWDA" description="ISHARES CORE MSCI WORLD" isin="IE00B4L5Y983" listingExchange="AEB" currency="EUR" tradeID="1001" dateTime="20240115;093000" quantity="10" tradePrice="80" ibCommission="-3" ibCommissionCurrency="EUR" buySell="BUY" levelOfDetail="EXECUTION" />
<Trade assetCategory="STK" subCategory="COMMON" symbol="AAPL" description="APPLE INC" isin="US0378331005" listingExchange="NASDAQ" currency="USD" tradeID="1002" dateTime="20240116;153000" quantity="5" tradePrice="180" ibCommission="-1" ibCommissionCurrency="USD" buySell="BUY" levelOfDetail="EXECUTION" />
<Trade assetCategory="CASH" symbol="EUR.USD" currency="USD" tradeID="1003" dateTime="20240116;150000" quantity="-1000" tradePrice="1.1" ibCommission="-2" ibCommissionCurrency="EUR" buySell="SELL" levelOfDetail="EXECUTION" />
<Trade assetCategory="OPT" symbol="AAPL  240621C00200000" currency="USD" tradeID="1004" dateTime="20240117;153000" quantity="1" tradePrice="5" ibCommission="-1" ibCommissionCurrency="USD" buySell="BUY" levelOfDetail="EXECUTION" />
</Trades>
<CashTransactions>
<CashTransaction type="Deposits/Withdrawals" currency="EUR" amount="3000" dateTime="20240110" transactionID="2001" description="CASH RECEIPTS" levelOfDetail="DETAIL" />
<CashTransaction type="Dividends" symbol="AAPL" isin="US0378331005" currency="USD" amount="1.2" dateTime="20240515" transactionID="2002" description="AAPL CASH DIVIDEND" levelOfDetail="DETAIL" />
<CashTransaction type="Withholding Tax" symbol="AAPL" isin="US0378331005" currency="USD" amount="-0.18" dateTime="20240515" transactionID="2003" description="AAPL US TAX" levelOfDetail="DETAIL" />
<CashTransaction type="Broker Interest Received" currency="EUR" amount="2.5" dateTime="20240603" transactionID="2004" description="EUR CREDIT INT" levelOfDetail="DETAIL" />
</CashTransactions>
<OpenPositions>
<OpenPosition assetCategory="STK" subCategory="ETF" symbol="IWDA" isin="IE00B4L5Y983" listingExchange="AEB" currency="EUR" position="10" levelOfDetail="SUMMARY" />
<OpenPosition assetCategory="STK" symbol="AAPL" isin="US0378331005" listingExchange="NASDAQ" currency="USD" position="5" levelOfDetail="SUMMARY" />
</OpenPositions>
<CashReport>
<CashReportCurrency currency="BASE_SUMMARY" endingCash="1379.33" />
<CashReportCurrency currency="EUR" endingCash="1197.5" />
<CashReportCurrency currency="USD" endingCash="200.02" />
</CashReport>
</FlexStatement>
</FlexStatements>
</FlexQueryResponse>`;
