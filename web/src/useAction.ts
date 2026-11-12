import { useCallback, useState } from "react";

/**
 * A button's or form's action against the server: `run` keeps `busy` true while it goes and puts
 * what it threw in `error` (cleared when the next run starts). `run` gives true when it went well,
 * so a form can clear its fields after.
 */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const run = useCallback(async (action: () => Promise<unknown>): Promise<boolean> => {
    setBusy(true);
    setError(undefined);
    try {
      await action();
      return true;
    } catch (err) {
      setError((err as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }, []);
  return { run, busy, error };
}
