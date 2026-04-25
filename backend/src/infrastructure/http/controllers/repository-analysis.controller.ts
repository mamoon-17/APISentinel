import { Request, Response } from "express";
import { AnalysisService } from "../../../application/analysis";
import { AppError } from "../../../shared/errors/app-error";

export class RepositoryAnalysisController {
  constructor(private readonly analysisService: AnalysisService) {}

  getInconsistencies = async (
    req: Request<{ id: string }, unknown, unknown, { specId?: string }>,
    res: Response,
  ): Promise<void> => {
    const repositoryId = req.params.id;
    const specId =
      typeof req.query.specId === "string" && req.query.specId.length > 0
        ? req.query.specId
        : undefined;

    const result = await this.analysisService.getRepositoryInconsistencies({
      repositoryId,
      specId,
    });

    result.match(
      (payload) => res.json(payload),
      (error: AppError) => {
        if (
          error.code === "REPOSITORY_SNAPSHOT_NOT_FOUND" ||
          error.code === "SPEC_VERSION_NOT_FOUND"
        ) {
          res.status(404).json(error.toJSON());
          return;
        }

        res.status(500).json(error.toJSON());
      },
    );
  };
}
