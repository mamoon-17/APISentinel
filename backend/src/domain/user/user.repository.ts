import { ResultAsync } from "neverthrow";
import { User } from "./user.entity";
import { AppError } from "../../shared/errors/app-error";

/**
 * Port (Interface) - Defines how the application layer communicates
 * with persistence. The domain doesn't know HOW data is stored.
 */
export interface UserRepository {
  findAll(): ResultAsync<User[], AppError>;
  findById(id: string): ResultAsync<User | null, AppError>;
  findByUsername(username: string): ResultAsync<User | null, AppError>;
  findByEmail(email: string): ResultAsync<User | null, AppError>;
  findAllByEmail(email: string): ResultAsync<User[], AppError>;
  findByGoogleId(googleId: string): ResultAsync<User | null, AppError>;
  save(user: User): ResultAsync<User, AppError>;
  delete(id: string): ResultAsync<void, AppError>;
}
