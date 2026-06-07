/* eslint-disable */
/**
 * Generated API types. Hand-authored to match `convex codegen` output for this
 * project's function modules.
 */
import type * as scores from "../scores.js";
import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

/**
 * The full API surface, derived from our function modules.
 */
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
