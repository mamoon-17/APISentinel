import { Request, Response, NextFunction } from "express";
import { UserService } from "../../../application/user";
import { User } from "../../../domain/user";
import { AppError } from "../../../shared/errors/app-error";

/**
 * HTTP Adapter - Translates HTTP requests to application service calls.
 * Express-specific code stays here, not in the application layer.
 */
export class UserController {
  constructor(private readonly userService: UserService) {}

  getAllUsers = async (
    _req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    const result = await this.userService.getAllUsers();

    result.match(
      (users: User[]) => res.json(users),
      (error: AppError) => next(error),
    );
  };

  getUserById = async (
    req: Request<{ id: string }>,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    const { id } = req.params;
    const result = await this.userService.getUserById(id);

    result.match(
      (user: User | null) => {
        if (user) {
          res.json(user);
        } else {
          res
            .status(404)
            .json({ code: "NOT_FOUND", message: "User not found" });
        }
      },
      (error: AppError) => next(error),
    );
  };

  createUser = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    const { username, password } = req.body;
    const result = await this.userService.createUser(username, password);

    result.match(
      (user: User) => res.status(201).json(user),
      (error: AppError) => next(error),
    );
  };

  deleteUser = async (
    req: Request<{ id: string }>,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    const { id } = req.params;
    const result = await this.userService.deleteUser(id);

    result.match(
      () => res.status(204).send(),
      (error: AppError) => next(error),
    );
  };
}
