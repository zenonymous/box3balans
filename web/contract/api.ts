/**
 * The web keeps its own copies of the server's types (src/api.ts). This file checks each copy
 * against what the server really sends, so a copy can't silently fall behind. `npm run typecheck`
 * fails when
 * - what the server sends no longer fits the web's type: a field has another type, or a required
 *   one is gone (the `export const` lines; the error says which field), or
 * - the web's type has a field the server doesn't have at all, optional ones included (the
 *   `NoneMissing` lines; the error names the field).
 * Fields only the server has are fine. Types only; this file is never run or bundled.
 *
 * What's compared is what the server builds for its answer: the route's own function where the
 * route reshapes (yearAnswer, incomeAnswer), else the domain type it returns. Sync results reach
 * the web as stored with a connection or wallet (`lastResult`), so one stored by an older version
 * can lack fields added since: a field added to them later should be optional on the web.
 */
import type * as Web from "../src/api";
import type * as Box3 from "../../server/src/domain/box3.js";
import type * as Box3Actual from "../../server/src/domain/box3Actual.js";
import type * as Dossier from "../../server/src/domain/dossier.js";
import type * as History from "../../server/src/domain/history.js";
import type * as Household from "../../server/src/domain/household.js";
import type * as Ledger from "../../server/src/domain/ledger.js";
import type * as MetalProducts from "../../server/src/domain/metal-products.js";
import type * as Peildatum from "../../server/src/domain/peildatum.js";
import type * as Performance from "../../server/src/domain/performance.js";
import type * as Portfolio from "../../server/src/domain/portfolio.js";
import type * as Yearly from "../../server/src/domain/yearly.js";
import type * as AnalyticsRoutes from "../../server/src/routes/analytics.js";
import type * as Box3Routes from "../../server/src/routes/box3.js";
// The routes use the app's dependencies (app.deps), which app.ts adds to Fastify's types.
import type {} from "../../server/src/app.js";
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

type AllKeys<T> = T extends unknown ? keyof T : never;
type At<T, K extends PropertyKey> = T extends unknown ? (K extends keyof T ? T[K] : never) : never;
/** The fields of the web's type W that the server's S doesn't have, at any depth; never if none. */
type Missing<W, S> = W extends readonly (infer WItem)[]
  ? Missing<WItem, S extends readonly (infer SItem)[] ? SItem : never>
  : W extends object
    ? {
        [K in keyof W]-?: K extends AllKeys<S>
          ? Missing<W[K], At<S, K>>
          : string extends K
            ? Missing<W[K], At<S, AllKeys<S>>> // a Record<string, …>: compare with each of the server's values
            : K;
      }[keyof W]
    : never;
/** What the server sends for S lacks these fields of the web's W. */
type MissingSent<W, S> = Missing<W, Json<S>>;
/** Fails, naming the field, when the web's type has a field the server doesn't send. */
type NoneMissing<M extends never> = M;

// Routes that reshape what the domain returns. (The ledger's own IncomeEvent is another thing.)
type Box3YearSent = ReturnType<typeof Box3Routes.yearAnswer>;
type ActualReturnSent = Box3YearSent["actualReturn"];
type IncomeSent = ReturnType<typeof AnalyticsRoutes.incomeAnswer>;
type IncomeEventSent = IncomeSent["events"][number];

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
export const incomeResponse: Web.IncomeResponse = sent<IncomeSent>();
export const box3Rates: Web.Box3Rates = sent<Box3.Box3Rates>();
export const box3Config: Web.Box3Config = sent<Box3.Box3Config>();
export const box3Row: Web.Box3Row = sent<Box3.Box3Row>();
export const box3Year: Web.Box3Year = sent<Box3YearSent>();
export const returnPart: Web.ReturnPart = sent<Box3Actual.ReturnPart>();
export const actualReturn: Web.ActualReturn = sent<ActualReturnSent>();
export const dossier: Web.Dossier = sent<Dossier.Dossier>();

export type FieldsSent = [
  NoneMissing<MissingSent<Web.TxType, Ledger.TxType>>,
  NoneMissing<MissingSent<Web.Person, Household.Person>>,
  NoneMissing<MissingSent<Web.AttributionNote, Household.AttributionNote>>,
  NoneMissing<MissingSent<Web.AccountYear, Yearly.AccountYear>>,
  NoneMissing<MissingSent<Web.BankYear, Bank.BankYear>>,
  NoneMissing<MissingSent<Web.BankImport, Bank.BankImport>>,
  NoneMissing<MissingSent<Web.YearField, YearStatement.YearField>>,
  NoneMissing<MissingSent<Web.YearStatement, YearStatement.YearStatement>>,
  NoneMissing<MissingSent<Web.AssetCandidate, Prices.AssetCandidate>>,
  NoneMissing<MissingSent<Web.Holding, Portfolio.Holding>>,
  NoneMissing<MissingSent<Web.MetalProduct, MetalProducts.MetalProduct>>,
  NoneMissing<MissingSent<Web.Mismatch, Reconcile.Mismatch>>,
  NoneMissing<MissingSent<Web.ChecklistItem, Peildatum.ChecklistItem>>,
  NoneMissing<MissingSent<Web.PeildatumChecklist, Peildatum.PeildatumChecklist>>,
  NoneMissing<MissingSent<Web.StatementRow, Statement.StatementRow>>,
  NoneMissing<MissingSent<Web.StatementCheck, Statement.StatementCheck>>,
  NoneMissing<MissingSent<Web.SyncResult, Sync.SyncResult>>,
  NoneMissing<MissingSent<Web.WalletSyncResult, Wallets.WalletSyncResult>>,
  NoneMissing<MissingSent<Web.HistoryPoint, History.HistoryPoint>>,
  NoneMissing<MissingSent<Web.YearResult, Performance.YearResult>>,
  NoneMissing<MissingSent<Web.RealizedRow, Performance.RealizedRow>>,
  NoneMissing<MissingSent<Web.IncomeEvent, IncomeEventSent>>,
  NoneMissing<MissingSent<Web.IncomeResponse, IncomeSent>>,
  NoneMissing<MissingSent<Web.Box3Rates, Box3.Box3Rates>>,
  NoneMissing<MissingSent<Web.Box3Config, Box3.Box3Config>>,
  NoneMissing<MissingSent<Web.Box3Row, Box3.Box3Row>>,
  NoneMissing<MissingSent<Web.Box3Year, Box3YearSent>>,
  NoneMissing<MissingSent<Web.ReturnPart, Box3Actual.ReturnPart>>,
  NoneMissing<MissingSent<Web.ActualReturn, ActualReturnSent>>,
  NoneMissing<MissingSent<Web.Dossier, Dossier.Dossier>>,
];
