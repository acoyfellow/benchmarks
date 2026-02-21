import { Schema } from "effect"

export class BenchmarkNotFound extends Schema.TaggedError<BenchmarkNotFound>()(
  "BenchmarkNotFound",
  { benchmarkId: Schema.String }
) {}

export class ModelUnavailable extends Schema.TaggedError<ModelUnavailable>()(
  "ModelUnavailable",
  { modelId: Schema.String }
) {}

export class RunFailed extends Schema.TaggedError<RunFailed>()(
  "RunFailed",
  { runId: Schema.String, reason: Schema.String }
) {}

export class DbError extends Schema.TaggedError<DbError>()(
  "DbError",
  { message: Schema.String }
) {}

export class ApiError extends Schema.TaggedError<ApiError>()(
  "ApiError",
  { message: Schema.String, status: Schema.Number }
) {}
