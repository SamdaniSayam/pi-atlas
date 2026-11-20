/**
 * Regression: async search races must never let a superseded job write the
 * result the user sees. The HTTP transport is stubbed at the network boundary
 * so a "slow" job can be resolved on demand.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { useSearch } from "../../src/state/useSearch";

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  }) as unknown as Response;
}

function exactResult(query: string, position: number) {
  return {
    query,
    length: query.length,
    found: true,
    total: 1,
    positions: [position],
    position_cap: 100,
    truncated: false,
    incomplete: false,
    longest_existing_prefix: 0,
    longest_existing_prefix_position: 0,
  };
}

function doneSnapshot(id: number, query: string, position: number) {
  return json({
    id,
    kind: "exact",
    status: "done",
    progress: null,
    result: exactResult(query, position),
    error: null,
    elapsed_ms: 1,
  });
}

/** Install a transport with one gated (slow) job and one immediate job. */
function setup(slowJobId: number, fastJobId: number) {
  const gate = deferred<Response>();
  const polled = deferred<void>();
  const cancelled: number[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/jobs/exact") && init?.method === "POST") {
      const { query } = JSON.parse(String(init.body)) as { query: string };
      return json({ cached: false, job_id: query === "12" ? slowJobId : fastJobId });
    }
    const cancelMatch = /\/jobs\/(\d+)\/cancel/.exec(url);
    if (cancelMatch) {
      cancelled.push(Number(cancelMatch[1]));
      return json({ ok: true });
    }
    if (url.includes(`/jobs/${slowJobId}`)) {
      polled.resolve();
      return gate.promise;
    }
    if (url.includes(`/jobs/${fastJobId}`)) return doneSnapshot(fastJobId, "34", 762);
    return json({});
  });
  vi.stubGlobal("fetch", fetchMock);
  return { gate, polled, cancelled, fetchMock };
}

beforeEach(() => {
  useSearch.setState({
    digitsResult: null,
    lettersResult: null,
    datesResult: null,
    searching: false,
    progress: null,
    searchError: null,
    selectedOccurrence: 1,
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useSearch race hardening", () => {
  it("a slow job cannot overwrite a newer search's result", async () => {
    const { gate, polled } = setup(1, 2);
    const first = useSearch.getState().runDigits("12");
    await polled.promise;

    const second = await useSearch.getState().runDigits("34");
    expect(second?.query).toBe("34");

    gate.resolve(doneSnapshot(1, "12", 148));
    expect(await first).toBeNull();
    expect(useSearch.getState().digitsResult?.query).toBe("34");
    expect(useSearch.getState().searching).toBe(false);
  });

  it("cancelSearch invalidates a result that lands during the cancel request", async () => {
    const { gate, polled, cancelled } = setup(3, 4);
    const slow = useSearch.getState().runDigits("12");
    await polled.promise;

    await useSearch.getState().cancelSearch();
    expect(cancelled).toContain(3);
    gate.resolve(doneSnapshot(3, "12", 148));

    expect(await slow).toBeNull();
    expect(useSearch.getState().digitsResult).toBeNull();
    expect(useSearch.getState().searching).toBe(false);
    expect(useSearch.getState().progress).toBeNull();
  });

  it("clearing the query also invalidates the older job", async () => {
    const { gate, polled } = setup(5, 6);
    const slow = useSearch.getState().runDigits("12");
    await polled.promise;

    expect(await useSearch.getState().runDigits("")).toBeNull();
    gate.resolve(doneSnapshot(5, "12", 148));
    expect(await slow).toBeNull();
    expect(useSearch.getState().digitsResult).toBeNull();
    expect(useSearch.getState().searchError).toBeNull();
  });
});
