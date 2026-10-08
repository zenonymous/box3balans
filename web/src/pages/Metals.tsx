import { useState, type FormEvent } from "react";
import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { del, get, post, put, type MetalItem, type MetalProduct } from "../api";
import { PhotoStrip, photoUrl } from "../components/Photos";
import { RefreshButton } from "../components/RefreshButton";
import {
  Alert,
  AmountInput,
  Badge,
  Button,
  Card,
  Delta,
  Empty,
  Field,
  Input,
  Modal,
  PageHeader,
  Select,
  Spinner,
  Stat,
  Textarea,
} from "../components/ui";
import { METAL_LABEL, date, eur, num, pct, todayIso, parseNumberInput, toApiNumber, toInputNumber } from "../format";
import { useAccounts, useInvalidateAll, useMetals } from "../queries";
import { t, tj } from "../i18n";

export function MetalsPage() {
  const metals = useMetals();
  const [editing, setEditing] = useState<MetalItem | "new" | null>(null);
  const [showSold, setShowSold] = useState(false);

  if (metals.isLoading) return <Spinner />;
  if (metals.error) return <Alert tone="danger">{metals.error.message}</Alert>;
  const m = metals.data!;
  const items = m.items.filter((i) => showSold || !i.soldDate);
  const soldCount = m.items.filter((i) => i.soldDate).length;

  return (
    <>
      <PageHeader
        title={t("Precious metals")}
        subtitle={t("Physical coins & bars valued at spot by fine weight, plus vaulted holdings")}
        actions={
          <>
            <RefreshButton />
            {m.items.some((i) => !i.soldDate) && (
              <Link
                to="/metals/inventory"
                className="rounded-lg border border-line bg-surface px-3.5 py-2 text-sm font-medium text-ink hover:bg-surface-2"
              >
                {t("Inventory")}
              </Link>
            )}
            <Button variant="primary" onClick={() => setEditing("new")}>
              {t("+ Add coin / bar")}
            </Button>
          </>
        }
      />

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {m.spot.map((s) => (
          <Stat
            key={s.metal}
            label={t("{metal} spot", { metal: METAL_LABEL[s.metal] ?? s.metal })}
            value={s.eurPerOz ? `${eur(s.eurPerOz)}/oz` : "—"}
            sub={<span className="text-muted">{s.eurPerGram ? `${eur(s.eurPerGram)}/g` : t("no price yet")}</span>}
          />
        ))}
      </div>

      {m.totals.length > 0 && (
        <Card title={t("Totals per metal")} padded={false} className="mb-4">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-line text-xs text-ink-2">
                  <th className="px-4 py-2 text-left font-medium">{t("Metal")}</th>
                  <th className="px-4 py-2 text-right font-medium">{t("Physical")}</th>
                  <th className="px-4 py-2 text-right font-medium">{t("Vaulted")}</th>
                  <th className="px-4 py-2 text-right font-medium">{t("Total")}</th>
                  <th className="px-4 py-2 text-right font-medium">{t("Value")}</th>
                  <th className="px-4 py-2 text-right font-medium">{t("P&L")}</th>
                  <th
                    className="px-4 py-2 text-right font-medium"
                    title={t("Price paid above spot on physical items, where spot at purchase is known")}
                  >
                    {t("Premium paid")}
                  </th>
                </tr>
              </thead>
              <tbody className="tabular divide-y divide-line">
                {m.totals.map((x) => (
                  <tr key={x.metal}>
                    <td className="px-4 py-2.5 font-medium">{METAL_LABEL[x.metal]}</td>
                    <td className="px-4 py-2.5 text-right text-ink-2">{num(x.physicalG, 2)} g</td>
                    <td className="px-4 py-2.5 text-right text-ink-2">{num(x.vaultedG, 2)} g</td>
                    <td className="px-4 py-2.5 text-right">
                      {num(x.totalG, 2)} g<div className="text-xs text-muted">{num(x.totalOz, 3)} oz</div>
                    </td>
                    <td className="px-4 py-2.5 text-right">{eur(x.valueEur)}</td>
                    <td className="px-4 py-2.5 text-right">
                      <Delta value={x.pnlEur} />
                    </td>
                    <td className="px-4 py-2.5 text-right text-ink-2">
                      {Number(x.premiumPaidEur) ? (
                        <>
                          {eur(x.premiumPaidEur)}
                          {x.premiumPaidPct && (
                            <div className="text-xs text-muted">
                              {t("{pct} over spot", { pct: pct(x.premiumPaidPct, { sign: false }) })}
                            </div>
                          )}
                        </>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Card
        title={t("Physical items")}
        padded={false}
        className="mb-4"
        actions={
          soldCount > 0 && (
            <label className="flex items-center gap-1.5 text-xs text-ink-2">
              <input type="checkbox" checked={showSold} onChange={(e) => setShowSold(e.target.checked)} />{" "}
              {t("Show sold ({n})", { n: soldCount })}
            </label>
          )
        }
      >
        {items.length === 0 ? (
          <Empty title={t("No physical metal yet")}>
            {t("Add coins and bars you hold at home or in a safe deposit box.")}
          </Empty>
        ) : (
          <ul className="divide-y divide-line">
            {items.map((i) => (
              <li key={i.id}>
                <button
                  type="button"
                  onClick={() => setEditing(i)}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm hover:bg-surface-2"
                >
                  {i.photoIds.length > 0 ? (
                    <img
                      src={photoUrl(i.photoIds[0]!)}
                      alt=""
                      loading="lazy"
                      className="size-10 shrink-0 rounded-md border border-line object-cover"
                    />
                  ) : (
                    <span aria-hidden className="size-10 shrink-0 rounded-md border border-dashed border-line" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium text-ink">
                      {i.quantity > 1 && <span className="text-ink-2">{i.quantity}× </span>}
                      {i.product} {i.soldDate && <Badge>{t("sold {date}", { date: date(i.soldDate) })}</Badge>}
                    </div>
                    <div className="truncate text-xs text-muted">
                      {METAL_LABEL[i.metal]} ·{" "}
                      {t("{grams} g fine ({oz} oz)", { grams: num(i.fineWeightG, 3), oz: num(i.fineWeightOz, 4) })} ·{" "}
                      {i.accountName} · {t("bought {date}", { date: date(i.purchaseDate) })}
                      {i.premiumPct && ` · ${t("{pct} premium", { pct: pct(i.premiumPct, { sign: false }) })}`}
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="tabular text-ink">{i.soldDate ? eur(i.salePriceEur) : eur(i.valueEur)}</div>
                    <div className="text-xs">
                      <Delta value={i.pnlEur} percent={i.pnlPct} />
                    </div>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title={t("Vaulted & allocated")} padded={false}>
        {m.vaulted.length === 0 ? (
          <Empty title={t("No vaulted metal")}>
            {tj(
              "For Goldrepublic or similar, create a <0>vault account</0> and record <1>buy transactions</1> on the Gold or Silver asset, in grams.",
              [
                <Link key="a" to="/accounts" className="text-accent underline" />,
                <Link key="t" to="/transactions" className="text-accent underline" />,
              ],
            )}
          </Empty>
        ) : (
          <ul className="divide-y divide-line">
            {m.vaulted.map((v) => (
              <li key={`${v.metal}-${v.accountId}`} className="flex items-center gap-3 px-4 py-3 text-sm">
                <div className="flex-1">
                  <div className="font-medium text-ink">
                    {METAL_LABEL[v.metal]} · {v.accountName}
                  </div>
                  <div className="text-xs text-muted">
                    {num(v.grams, 3)} g ({num(v.oz, 4)} oz) · {t("cost {amount}", { amount: eur(v.costEur) })}
                  </div>
                </div>
                <div className="text-right">
                  <div className="tabular">{eur(v.valueEur)}</div>
                  <div className="text-xs">
                    <Delta value={v.pnlEur} />
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {editing && <ItemModal item={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
    </>
  );
}

/** A stored NUMERIC prepared for editing in the user's number format (see Transactions). */
const strip = (v: string | null | undefined) =>
  v == null ? "" : toInputNumber(v.includes(".") ? v.replace(/\.?0+$/, "") : v);

function ItemModal({ item, onClose }: { item: MetalItem | null; onClose: () => void }) {
  const accounts = useAccounts();
  const invalidate = useInvalidateAll();
  const metals = useMetals();
  // Photos change while the dialog is open; read them from the live list.
  const photoIds = metals.data?.items.find((i) => i.id === item?.id)?.photoIds ?? item?.photoIds ?? [];
  const products = useQuery({
    queryKey: ["metal-products"],
    queryFn: () => get<MetalProduct[]>("/api/metals/products"),
    staleTime: Infinity,
  });
  const [f, setF] = useState({
    accountId: item ? String(item.accountId) : "",
    metal: item?.metal ?? "gold",
    product: item?.product ?? "",
    grossWeightG: strip(item?.grossWeightG),
    purity: strip(item?.purity),
    quantity: String(item?.quantity ?? 1),
    purchaseDate: item?.purchaseDate ?? todayIso(),
    purchasePriceEur: strip(item?.purchasePriceEur),
    spotValueAtPurchaseEur: strip(item?.spotValueAtPurchaseEur),
    dealer: item?.dealer ?? "",
    notes: item?.notes ?? "",
    soldDate: item?.soldDate ?? "",
    salePriceEur: strip(item?.salePriceEur),
  });
  const [selling, setSelling] = useState(!!item?.soldDate);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (v: string) => setF((s) => ({ ...s, [k]: v }));
  const storage = accounts.data?.filter((a) => !a.archived || String(a.id) === f.accountId) ?? [];

  const pickProduct = (name: string) => {
    const p = products.data?.find((x) => x.metal === f.metal && x.name === name);
    if (p)
      setF((s) => ({
        ...s,
        product: p.name,
        grossWeightG: toInputNumber(p.grossWeightG),
        purity: toInputNumber(p.purity),
      }));
    else set("product")(name);
  };

  const asNumber = (v: string) => Number(parseNumberInput(v).value) || 0;
  const fine = asNumber(f.grossWeightG) * asNumber(f.purity) * (Number(f.quantity) || 0);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      const body = {
        accountId: Number(f.accountId),
        metal: f.metal,
        product: f.product,
        grossWeightG: toApiNumber(f.grossWeightG, t("Gross weight")),
        purity: toApiNumber(f.purity, t("Purity")),
        quantity: Number(f.quantity),
        purchaseDate: f.purchaseDate,
        purchasePriceEur: toApiNumber(f.purchasePriceEur, t("Price paid")),
        // Empty means "derive from stored spot history" on the server.
        ...(f.spotValueAtPurchaseEur
          ? { spotValueAtPurchaseEur: toApiNumber(f.spotValueAtPurchaseEur, t("Spot value")) }
          : {}),
        dealer: f.dealer || null,
        notes: f.notes || null,
        soldDate: selling && f.soldDate ? f.soldDate : null,
        salePriceEur: selling && f.salePriceEur ? toApiNumber(f.salePriceEur, t("Sale proceeds")) : null,
      };
      if (item) await put(`/api/metals/items/${item.id}`, body);
      else await post("/api/metals/items", body);
      await invalidate();
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (
      !confirm(
        t("Delete this item and its photos? If you sold it, mark it as sold instead to keep the realized result."),
      )
    )
      return;
    try {
      await del(`/api/metals/items/${item!.id}`);
      await invalidate();
      onClose();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      wide
      title={item ? t("Edit item") : t("Add coin or bar")}
      footer={
        <>
          {item && (
            <Button variant="danger" onClick={remove} className="mr-auto">
              {t("Delete")}
            </Button>
          )}
          <Button onClick={onClose}>{t("Cancel")}</Button>
          <Button variant="primary" type="submit" form="item-form" disabled={busy}>
            {busy ? t("Saving…") : t("Save")}
          </Button>
        </>
      }
    >
      <form id="item-form" onSubmit={submit} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {storage.length === 0 && (
          <div className="sm:col-span-2">
            <Alert>
              {tj(
                "Create a storage location first (an account of type “physical”, e.g. “Home safe”) on the <0>Accounts</0> page.",
                [<Link key="a" to="/accounts" className="underline" onClick={onClose} />],
              )}
            </Alert>
          </div>
        )}
        <Field label={t("Metal")}>
          {(id) => (
            <Select id={id} value={f.metal} onChange={(e) => set("metal")(e.target.value)}>
              {Object.entries(METAL_LABEL).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={t("Product")} hint={t("Pick a preset to fill weight and purity, or type your own")}>
          {(id) => (
            <>
              <Input
                id={id}
                list="metal-products"
                value={f.product}
                onChange={(e) => pickProduct(e.target.value)}
                required
              />
              <datalist id="metal-products">
                {products.data
                  ?.filter((p) => p.metal === f.metal)
                  .map((p) => (
                    <option key={p.name} value={p.name} />
                  ))}
              </datalist>
            </>
          )}
        </Field>
        <Field label={t("Gross weight per piece (g)")}>
          {(id) => (
            <AmountInput
              id={id}

              value={f.grossWeightG}
              onChange={(e) => set("grossWeightG")(e.target.value)}
              required
            />
          )}
        </Field>
        <Field label={t("Purity / fineness")} hint={t("e.g. 0.9999 or 0.9167 (22 ct)")}>
          {(id) => (
            <AmountInput
              id={id}

              value={f.purity}
              onChange={(e) => set("purity")(e.target.value)}
              required
            />
          )}
        </Field>
        <Field label={t("Quantity (pieces)")}>
          {(id) => (
            <Input
              id={id}
              type="number"
              min={1}
              step={1}
              value={f.quantity}
              onChange={(e) => set("quantity")(e.target.value)}
              required
            />
          )}
        </Field>
        <Field label={t("Storage location")}>
          {(id) => (
            <Select id={id} value={f.accountId} onChange={(e) => set("accountId")(e.target.value)} required>
              <option value="">{t("Choose…")}</option>
              {storage.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={t("Purchase date")}>
          {(id) => (
            <Input
              id={id}
              type="date"
              value={f.purchaseDate}
              max={todayIso()}
              onChange={(e) => set("purchaseDate")(e.target.value)}
              required
            />
          )}
        </Field>
        <Field label={t("Total price paid (EUR)")} hint={t("All pieces, incl. premium and shipping")}>
          {(id) => (
            <AmountInput
              id={id}

              value={f.purchasePriceEur}
              onChange={(e) => set("purchasePriceEur")(e.target.value)}
              required
            />
          )}
        </Field>
        <Field
          label={t("Spot value at purchase (EUR, optional)")}
          hint={t(
            "Used to compute the premium you paid. Left empty, it is filled from stored spot history when available.",
          )}
        >
          {(id) => (
            <AmountInput
              id={id}

              value={f.spotValueAtPurchaseEur}
              onChange={(e) => set("spotValueAtPurchaseEur")(e.target.value)}
            />
          )}
        </Field>
        <Field label={t("Dealer")}>
          {(id) => <Input id={id} value={f.dealer} onChange={(e) => set("dealer")(e.target.value)} />}
        </Field>
        <Field label={t("Notes")} className="sm:col-span-2">
          {(id) => <Textarea id={id} value={f.notes} onChange={(e) => set("notes")(e.target.value)} />}
        </Field>

        <p className="text-sm text-ink-2 sm:col-span-2">
          {tj("Fine metal: <0>{grams} g</0> ({oz} oz)", [<span key="g" className="tabular font-medium text-ink" />], {
            grams: num(fine, 3),
            oz: num(fine / 31.1034768, 4),
          })}
        </p>

        {item && (
          <div className="rounded-lg border border-line p-3 sm:col-span-2">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={selling} onChange={(e) => setSelling(e.target.checked)} /> {t("Sold")}
            </label>
            {selling && (
              <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label={t("Sale date")}>
                  {(id) => (
                    <Input
                      id={id}
                      type="date"
                      value={f.soldDate}
                      max={todayIso()}
                      onChange={(e) => set("soldDate")(e.target.value)}
                      required
                    />
                  )}
                </Field>
                <Field label={t("Sale proceeds (EUR)")}>
                  {(id) => (
                    <AmountInput
                      id={id}

                      value={f.salePriceEur}
                      onChange={(e) => set("salePriceEur")(e.target.value)}
                      required
                    />
                  )}
                </Field>
              </div>
            )}
          </div>
        )}
        {error && (
          <div className="sm:col-span-2">
            <Alert tone="danger">{error}</Alert>
          </div>
        )}
      </form>
      <div className="mt-4 border-t border-line pt-3">
        <h3 className="mb-2 text-xs font-medium text-ink-2">{t("Photos")}</h3>
        {item ? (
          <PhotoStrip itemId={item.id} photoIds={photoIds} onChange={() => void metals.refetch()} />
        ) : (
          <p className="text-xs text-muted">{t("Save the item first, then add photos (e.g. for your insurance).")}</p>
        )}
      </div>
    </Modal>
  );
}
