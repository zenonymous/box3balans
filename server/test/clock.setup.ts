import { vi } from "vitest";

// With FAKE_NOW set (see scripts/test-dates.sh), the tests run as if it were that moment, with the
// clock running on from there. Finds code and tests that only work on some days of the year.
const now = process.env.FAKE_NOW;
if (now) vi.useFakeTimers({ now: new Date(now), toFake: ["Date"], shouldAdvanceTime: true });
