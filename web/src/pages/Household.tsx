import { useState, type FormEvent } from "react";
import { Link } from "react-router";
import { del, post, put, type Custody, type Person } from "../api";
import { Alert, Button, Card, Field, Input, PageHeader, Select, Spinner } from "../components/ui";
import { date } from "../format";
import { t, tj } from "../i18n";
import { custodyLabel } from "../labels";
import { useHousehold, useInvalidateAll } from "../queries";

const CUSTODY: Custody[] = ["together", "self", "self_half", "partner"];

/** Who box 3 is about: you, a partner and children. Accounts are then marked with their owner. */
export function HouseholdPage() {
  return (
    <>
      <PageHeader
        title={t("Household")}
        subtitle={t(
          "Who your box 3 is about: you, your partner and your children. Mark each account with its owner under Accounts.",
        )}
      />
      <HouseholdEditor />
    </>
  );
}

/** You, your partner and children; also step 1 of the start wizard. */
export function HouseholdEditor() {
  const people = useHousehold();
  if (people.isLoading) return <Spinner />;
  if (people.error) return <Alert tone="danger">{people.error.message}</Alert>;
  const list = people.data ?? [];
  const self = list.find((p) => p.role === "self") ?? null;
  const partner = list.find((p) => p.role === "partner") ?? null;
  const children = list.filter((p) => p.role === "child");

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <Card title={t("You and your partner")}>
        <div className="flex flex-col gap-4">
          <PersonRow role="self" person={self} label={t("Your name")} placeholder={t("e.g. box3balans")} />
          <PersonRow role="partner" person={partner} label={t("Your partner's name")} placeholder={t("e.g. Sam")} />
          <p className="text-xs text-muted">
            {tj(
              "Whether your partner is your fiscal partner can differ per year: set it per year on the <0>Box 3</0> page. Fiscal partners add up their box 3 and divide it as they like.",
              [<Link key="b" to="/box3" className="underline" />],
            )}
          </p>
        </div>
      </Card>

      <Card title={t("Children")}>
        <div className="flex flex-col gap-3">
          {children.map((c) => (
            <ChildRow key={c.id} child={c} />
          ))}
          <ChildRow child={null} />
          <p className="text-xs text-muted">
            {t(
              "The savings and investments of a child under 18 on 1 January count for the parents with custody, half each. From the year they turn 18 they file their own return.",
            )}
          </p>
        </div>
      </Card>
    </div>
  );
}

function PersonRow({
  role,
  person,
  label,
  placeholder,
}: {
  role: "self" | "partner";
  person: Person | null;
  label: string;
  placeholder: string;
}) {
  const invalidate = useInvalidateAll();
  const [name, setName] = useState(person?.name ?? "");
  const [error, setError] = useState<string>();
  const [saved, setSaved] = useState(false);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setError(undefined);
    try {
      if (person && !name.trim()) {
        if (role === "partner" && !confirm(t("Remove your partner? Their accounts become yours.")))
          return setName(person.name);
        await del(`/api/household/${person.id}`);
      } else if (person) await put(`/api/household/${person.id}`, { name });
      else if (name.trim()) await post("/api/household", { name, role });
      await invalidate();
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <form onSubmit={save} className="flex items-end gap-2">
      <Field label={label} className="flex-1">
        {(id) => <Input id={id} value={name} placeholder={placeholder} onChange={(e) => setName(e.target.value)} />}
      </Field>
      <Button type="submit">{t("Save")}</Button>
      {saved && <span className="pb-2 text-sm text-gain">✓</span>}
      {error && <Alert tone="danger">{error}</Alert>}
    </form>
  );
}

function ChildRow({ child }: { child: Person | null }) {
  const invalidate = useInvalidateAll();
  const [f, setF] = useState({
    name: child?.name ?? "",
    birthDate: child?.birthDate ?? "",
    custody: child?.custody ?? "together",
  });
  const [error, setError] = useState<string>();
  const [open, setOpen] = useState(!!child);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setError(undefined);
    const body = { ...f, birthDate: f.birthDate || null };
    try {
      if (child) await put(`/api/household/${child.id}`, body);
      else {
        await post("/api/household", { ...body, role: "child" });
        setF({ name: "", birthDate: "", custody: "together" });
        setOpen(false);
      }
      await invalidate();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const remove = async () => {
    if (!child || !confirm(t("Remove {name}? Their accounts become yours.", { name: child.name }))) return;
    try {
      await del(`/api/household/${child.id}`);
      await invalidate();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  if (!open)
    return (
      <div>
        <Button onClick={() => setOpen(true)}>+ {t("Add a child")}</Button>
      </div>
    );

  return (
    <form onSubmit={save} className="grid grid-cols-1 gap-2 rounded-lg border border-line p-3 sm:grid-cols-2">
      <Field label={t("Name")}>
        {(id) => <Input id={id} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required />}
      </Field>
      <Field
        label={t("Date of birth")}
        hint={child?.birthDate ? t("18 on {date}", { date: date(adultOn(child.birthDate)) }) : undefined}
      >
        {(id) => (
          <Input id={id} type="date" value={f.birthDate} onChange={(e) => setF({ ...f, birthDate: e.target.value })} />
        )}
      </Field>
      <Field label={t("Who has custody?")} className="sm:col-span-2">
        {(id) => (
          <Select id={id} value={f.custody} onChange={(e) => setF({ ...f, custody: e.target.value as Custody })}>
            {CUSTODY.map((c) => (
              <option key={c} value={c}>
                {custodyLabel(c)}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <div className="flex gap-2 sm:col-span-2">
        <Button type="submit" variant="primary">
          {child ? t("Save") : t("Add")}
        </Button>
        {child ? (
          <Button variant="danger" onClick={remove}>
            {t("Remove")}
          </Button>
        ) : (
          <Button onClick={() => setOpen(false)}>{t("Cancel")}</Button>
        )}
      </div>
      {error && (
        <div className="sm:col-span-2">
          <Alert tone="danger">{error}</Alert>
        </div>
      )}
    </form>
  );
}

const adultOn = (birthDate: string) => `${Number(birthDate.slice(0, 4)) + 18}${birthDate.slice(4)}`;
