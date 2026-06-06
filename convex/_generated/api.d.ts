/* eslint-disable */
/**
 * Generated `api` types (HAND-AUTHORED — see api.js header). Typed from the
 * function modules so `api.scores.submitScore` etc. are fully typed.
 */
import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";
import type * as scores from "../scores.js";

declare const fullApi: ApiFromModules<{
  scores: typeof scores;
}>;

export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;
