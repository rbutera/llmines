import { makeFunctionReference } from "convex/server";

export const api = {
  scores: {
    submitScore: makeFunctionReference<"mutation">("scores:submitScore"),
    personalBest: makeFunctionReference<"query">("scores:personalBest"),
    topN: makeFunctionReference<"query">("scores:topN"),
  },
} as const;
