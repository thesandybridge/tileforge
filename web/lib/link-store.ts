import { AsyncLocalStorage } from "async_hooks";

/** Request-scoped storage for the link-flow user ID. */
export const linkStore = new AsyncLocalStorage<string | undefined>();
