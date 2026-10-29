// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DateInput, Field, Input } from "./ui";

/** A field's hint or error is read out with its control, whatever the control is. */
afterEach(cleanup);

const description = (label: string) =>
  (screen.getByLabelText(label).getAttribute("aria-describedby") ?? "")
    .split(" ")
    .map((id) => document.getElementById(id)?.textContent)
    .join(" | ");

describe("Field", () => {
  it("links its hint to an input, an input inside a fragment, and a date field", () => {
    render(
      <>
        <Field label="Naam" hint="Zoals op je bankafschrift">
          {(id) => <Input id={id} />}
        </Field>
        <Field label="Product" hint="Kies er een of typ je eigen">
          {(id) => (
            <>
              <Input id={id} list="presets" />
              <datalist id="presets" />
            </>
          )}
        </Field>
        <Field label="Geboortedatum" hint="Voor wanneer het 18 wordt">
          {(id) => <DateInput id={id} value="" onChange={() => {}} />}
        </Field>
      </>,
    );
    expect(description("Naam")).toBe("Zoals op je bankafschrift");
    expect(description("Product")).toBe("Kies er een of typ je eigen");
    expect(description("Geboortedatum")).toBe("Voor wanneer het 18 wordt");
  });

  it("marks the control invalid and reads the error instead of the hint", () => {
    render(
      <Field label="Bedrag" hint="In euro's" error="Moet een getal zijn">
        {(id) => <Input id={id} />}
      </Field>,
    );
    expect(screen.getByLabelText("Bedrag").getAttribute("aria-invalid")).toBe("true");
    expect(description("Bedrag")).toBe("Moet een getal zijn");
  });
});
