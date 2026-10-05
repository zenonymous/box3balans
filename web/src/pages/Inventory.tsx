import { Link } from "react-router";
import type { MetalItem } from "../api";
import { photoUrl } from "../components/Photos";
import { Alert, Button, Empty, Spinner } from "../components/ui";
import { METAL_LABEL, date, eur, num, todayIso } from "../format";
import { useMetals } from "../queries";

const sum = (xs: (string | null)[]) => xs.reduce((a, x) => a + Number(x ?? 0), 0);

/** Printable list of the physical metal you hold, per storage location, with photos (e.g. for insurance). */
export function InventoryPage() {
  const metals = useMetals();
  if (metals.isLoading) return <Spinner />;
  if (metals.error) return <Alert tone="danger">{(metals.error as Error).message}</Alert>;
  const items = metals.data!.items.filter((i) => !i.soldDate);
  const byLocation = new Map<string, MetalItem[]>();
  for (const i of items) byLocation.set(i.accountName, [...(byLocation.get(i.accountName) ?? []), i]);
  const fineByMetal = new Map<string, number>();
  for (const i of items) fineByMetal.set(i.metal, (fineByMetal.get(i.metal) ?? 0) + Number(i.fineWeightG));

  return (
    <div className="text-ink">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2 print:hidden">
        <Link to="/metals" className="text-sm text-accent">
          ← Precious metals
        </Link>
        <Button onClick={() => window.print()} title="Use “Save as PDF” in the print dialog">
          ⎙ Print / PDF
        </Button>
      </div>

      <header className="mb-6">
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">Precious metals inventory</h1>
        <p className="mt-1 text-sm text-ink-2">
          {date(todayIso())} · {items.reduce((a, i) => a + i.quantity, 0)} pieces in {byLocation.size} location
          {byLocation.size === 1 ? "" : "s"}
        </p>
        <dl className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          {[...fineByMetal.entries()].map(([metal, g]) => (
            <div key={metal}>
              <dt className="text-xs text-ink-2">{METAL_LABEL[metal]} (fine)</dt>
              <dd className="tabular font-medium">
                {num(g, 2)} g · {num(g / 31.1034768, 3)} oz
              </dd>
            </div>
          ))}
          <div>
            <dt className="text-xs text-ink-2">Value at spot</dt>
            <dd className="tabular font-medium">{eur(sum(items.map((i) => i.valueEur)))}</dd>
          </div>
          <div>
            <dt className="text-xs text-ink-2">Paid</dt>
            <dd className="tabular font-medium">{eur(sum(items.map((i) => i.purchasePriceEur)))}</dd>
          </div>
        </dl>
      </header>

      {items.length === 0 && <Empty title="No physical metal">Items you hold appear here.</Empty>}

      {[...byLocation.entries()].map(([location, list]) => (
        <section key={location} className="mb-8 break-inside-auto">
          <div className="mb-2 flex items-baseline justify-between border-b border-line pb-1">
            <h2 className="text-base font-semibold">{location}</h2>
            <span className="tabular text-sm text-ink-2">{eur(sum(list.map((i) => i.valueEur)))}</span>
          </div>
          <ul className="flex flex-col">
            {list.map((i) => (
              <li key={i.id} className="flex gap-3 border-b border-line py-3 text-sm break-inside-avoid">
                <div className="flex shrink-0 gap-1.5">
                  {i.photoIds.slice(0, 3).map((id) => (
                    <img
                      key={id}
                      src={photoUrl(id)}
                      alt=""
                      className="size-20 rounded-md border border-line object-cover print:size-24"
                    />
                  ))}
                  {i.photoIds.length === 0 && (
                    <span className="flex size-20 items-center justify-center rounded-md border border-dashed border-line text-xs text-muted print:hidden">
                      no photo
                    </span>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="font-medium">
                    {i.quantity > 1 && `${i.quantity}× `}
                    {i.product}
                    <span className="font-normal text-ink-2"> · {METAL_LABEL[i.metal]}</span>
                  </div>
                  <div className="tabular text-xs text-ink-2">
                    {num(i.grossWeightG, 3)} g{i.quantity > 1 ? " each" : ""} · {num(Number(i.purity) * 1000, 1)}/1000
                    fine · {num(i.fineWeightG, 3)} g fine in total
                  </div>
                  <div className="text-xs text-ink-2">
                    Bought {date(i.purchaseDate)}
                    {i.dealer && ` from ${i.dealer}`} for {eur(i.purchasePriceEur)}
                  </div>
                  {i.notes && <div className="mt-0.5 text-xs text-muted">{i.notes}</div>}
                </div>
                <div className="tabular shrink-0 text-right">
                  <div>{i.valueEur ? eur(i.valueEur) : "—"}</div>
                  <div className="text-xs text-muted">at spot</div>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}

      {items.length > 0 && (
        <p className="text-xs text-muted">
          Values are fine weight × today's spot price. A dealer buying back would usually pay somewhat less; replacing
          an item would usually cost more (premium).
        </p>
      )}
    </div>
  );
}
