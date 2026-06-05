/* eslint-disable */
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
