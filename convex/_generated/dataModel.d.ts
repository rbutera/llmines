/* eslint-disable */
/**
 * Generated data model types. Hand-authored to match `convex codegen` output
 * for this project's schema.
 */
import type {
  DataModelFromSchemaDefinition,
  DocumentByName,
  TableNamesInDataModel,
  SystemTableNames,
} from "convex/server";
import type { GenericId } from "convex/values";
import type schema from "../schema.js";

/** The data model derived from `convex/schema.ts`. */
export type DataModel = DataModelFromSchemaDefinition<typeof schema>;

export type Doc<TableName extends TableNamesInDataModel<DataModel>> =
  DocumentByName<DataModel, TableName>;

export type Id<
  TableName extends TableNamesInDataModel<DataModel> | SystemTableNames,
> = GenericId<TableName>;
