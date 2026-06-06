export type Doc<TableName extends string = string> = {
  _id: string;
  _creationTime: number;
} & Record<string, unknown>;

export type Id<TableName extends string = string> = string & {
  __tableName: TableName;
};

export type DataModel = {
  highScores: {
    document: Doc<"highScores"> & {
      subject: string;
      name: string;
      avatarUrl?: string;
      bestScore: number;
      updatedAt: number;
    };
    fieldPaths:
      | "_id"
      | "_creationTime"
      | "subject"
      | "name"
      | "avatarUrl"
      | "bestScore"
      | "updatedAt";
    indexes: {
      by_subject: ["subject", "_creationTime"];
      by_best_score: ["bestScore", "_creationTime"];
    };
    searchIndexes: Record<string, never>;
    vectorIndexes: Record<string, never>;
  };
};
