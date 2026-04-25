import { Request, Response } from "express";
import { SpecService } from "../../../application/spec";
import { AppError } from "../../../shared/errors/app-error";

interface UploadSpecBody {
  content?: string;
  fileName?: string;
}

export class SpecController {
  constructor(private readonly specService: SpecService) {}

  upload = async (
    req: Request<unknown, unknown, UploadSpecBody>,
    res: Response,
  ): Promise<void> => {
    const content = req.body.content;
    const fileName = req.body.fileName;

    if (!content || content.trim().length === 0) {
      res.status(400).json({
        code: "VALIDATION_ERROR",
        message: "Spec content is required",
      });
      return;
    }

    const result = await this.specService.uploadSpec({ content, fileName });
    result.match(
      (version) => res.status(201).json({ version }),
      (error: AppError) => {
        if (error.code === "SPEC_PARSE_FAILED") {
          res.status(400).json(error.toJSON());
          return;
        }

        res.status(500).json(error.toJSON());
      },
    );
  };

  listSpecs = async (_req: Request, res: Response): Promise<void> => {
    const result = await this.specService.getSpecs();

    result.match(
      (specs) => res.json({ specs }),
      (error: AppError) => res.status(500).json(error.toJSON()),
    );
  };

  listVersions = async (
    req: Request<{ id: string }>,
    res: Response,
  ): Promise<void> => {
    const result = await this.specService.getVersionsBySpecId(req.params.id);

    result.match(
      (versions) => res.json({ versions }),
      (error: AppError) => res.status(500).json(error.toJSON()),
    );
  };

  deleteVersion = async (
    req: Request<{ versionId: string }>,
    res: Response,
  ): Promise<void> => {
    const result = await this.specService.deleteVersion(req.params.versionId);

    result.match(
      () => res.status(204).send(),
      (error: AppError) => {
        if (error.code === "SPEC_VERSION_NOT_FOUND") {
          res.status(404).json(error.toJSON());
          return;
        }

        if (error.code === "SPEC_VERSION_IN_USE") {
          res.status(409).json(error.toJSON());
          return;
        }

        res.status(500).json(error.toJSON());
      },
    );
  };
}
