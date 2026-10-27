/**
 * The web keeps its own copies of the server's types (src/api.ts). This file checks each copy
 * against what the server really sends, so a copy can't silently fall behind: `npm run typecheck`
 * fails when a field the web expects is gone, renamed or of another type. Fields only the server
 * has are fine. Types only; this file is never run or bundled.
 */
import type * as Web from "../src/api";
import type * as Box3 from "../../server/src/domain/box3.js";
import type * as Box3Actual from "../../server/src/domain/box3Actual.js";
import type * as Box3Future from "../../server/src/domain/box3Future.js";
import type * as Dossier from "../../server/src/domain/dossier.js";
import type * as History from "../../server/src/domain/history.js";
import type * as Household from "../../server/src/domain/household.js";
import type * as Ledger from "../../server/src/domain/ledger.js";
import type * as MetalProducts from "../../server/src/domain/metal-products.js";
import type * as Peildatum from "../../server/src/domain/peildatum.js";
import type * as Performance from "../../server/src/domain/performance.js";
import type * as Portfolio from "../../server/src/domain/portfolio.js";
import type * as Yearly from "../../server/src/domain/yearly.js";
import type * as Bank from "../../server/src/import/bank.js";
import type * as Statement from "../../server/src/import/statement.js";
import type * as YearStatement from "../../server/src/import/yearStatement.js";
import type * as Prices from "../../server/src/prices/types.js";
import type * as Reconcile from "../../server/src/sync/reconcile.js";
import type * as Sync from "../../server/src/sync/service.js";
import type * as Wallets from "../../server/src/wallets/service.js";

/** What JSON makes of a value: a Date or a Decimal becomes the string its toJSON returns. */
type Json<T> = T extends { toJSON(): infer R }
  ? R
  : T extends (infer U)[]
    ? Json<U>[]
    : T extends object
      ? { [K in keyof T]: Json<T[K]> }
      : T;

/** A value as the server sends it. */
declare function sent<T>(): Json<T>;

// GET /api/box3/:year adds the actual return to the year, with its comparison to the deemed tax.
type ActualReturnSent = Awaited<ReturnType<typeof Box3Actual.actualReturn>> & {
  comparison: ReturnType<typeof Box3Future.compareWithDeemed>;
};
type Box3YearSent = Awaited<ReturnType<typeof Box3.computeBox3Year>> & { actualReturn: ActualReturnSent };
// GET /api/income: the events of loadEvents (the ledger's own IncomeEvent is another thing).
type IncomeEventSent = Awaited<ReturnType<typeof Performance.loadEvents>>["income"][number];

export const txType: Web.TxType = sent<Ledger.TxType>();
export const person: Web.Person = sent<Household.Person>();
export const attributionNote: Web.AttributionNote = sent<Household.AttributionNote>();
export const accountYear: Web.AccountYear = sent<Yearly.AccountYear>();
export const bankYear: Web.BankYear = sent<Bank.BankYear>();
export const bankImport: Web.BankImport = sent<Bank.BankImport>();
export const yearField: Web.YearField = sent<YearStatement.YearField>();
export const yearStatement: Web.YearStatement = sent<YearStatement.YearStatement>();
export const assetCandidate: Web.AssetCandidate = sent<Prices.AssetCandidate>();
export const holding: Web.Holding = sent<Portfolio.Holding>();
export const metalProduct: Web.MetalProduct = sent<MetalProducts.MetalProduct>();
export const mismatch: Web.Mismatch = sent<Reconcile.Mismatch>();
export const checklistItem: Web.ChecklistItem = sent<Peildatum.ChecklistItem>();
export const peildatumChecklist: Web.PeildatumChecklist = sent<Peildatum.PeildatumChecklist>();
export const statementRow: Web.StatementRow = sent<Statement.StatementRow>();
export const statementCheck: Web.StatementCheck = sent<Statement.StatementCheck>();
export const syncResult: Web.SyncResult = sent<Sync.SyncResult>();
export const walletSyncResult: Web.WalletSyncResult = sent<Wallets.WalletSyncResult>();
export const historyPoint: Web.HistoryPoint = sent<History.HistoryPoint>();
export const yearResult: Web.YearResult = sent<Performance.YearResult>();
export const realizedRow: Web.RealizedRow = sent<Performance.RealizedRow>();
export const incomeEvent: Web.IncomeEvent = sent<IncomeEventSent>();
export const box3Rates: Web.Box3Rates = sent<Box3.Box3Rates>();
export const box3Config: Web.Box3Config = sent<Box3.Box3Config>();
export const box3Row: Web.Box3Row = sent<Box3.Box3Row>();
export const box3Year: Web.Box3Year = sent<Box3YearSent>();
export const returnPart: Web.ReturnPart = sent<Box3Actual.ReturnPart>();
export const actualReturn: Web.ActualReturn = sent<ActualReturnSent>();
export const dossier: Web.Dossier = sent<Dossier.Dossier>();
