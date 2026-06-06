/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * This file is committed for mocked/eval builds so TypeScript can resolve
 * Convex function references without contacting a deployment.
 */

import { anyApi } from "convex/server";
import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";
import type * as scores from "../scores";

declare const fullApi: ApiFromModules<{
  scores: typeof scores;
}>;

export const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
> = anyApi as unknown as FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;
export const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
> = anyApi as unknown as FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;
