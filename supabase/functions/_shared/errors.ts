/** An error that carries the HTTP status the gateway should answer with. */
export class HttpError extends Error {
  status: number;

  /**
   * The status the *provider* answered with, when this wraps a provider
   * response. `status` collapses every non-retryable provider failure into 502
   * so the gateway never forwards a strange code, which loses the difference
   * between "your credentials were refused" and "that request was malformed".
   * Callers that need that difference — deciding whether a connection has to be
   * reconnected, for instance — read it here instead.
   */
  providerStatus?: number;

  constructor(status: number, message: string, providerStatus?: number) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.providerStatus = providerStatus;
  }
}
