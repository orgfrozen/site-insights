export interface CapturedRequest {
  input: RequestInfo | URL;
  init?: RequestInit;
}

export function fakeFetchSequence(responses: Response[]) {
  const calls: CapturedRequest[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    calls.push({ input, init });
    const response = responses.shift();
    if (!response) throw new Error("fake_fetch_exhausted");
    return response;
  };
  return { fetcher, calls };
}
