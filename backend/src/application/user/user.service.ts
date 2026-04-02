import { ResultAsync } from "neverthrow";
import { User, UserRepository } from "../../domain/user";
import { AppError } from "../../shared/errors/app-error";

/**
 * Application Service (Use Case) - Orchestrates business logic.
 * Depends on the UserRepository PORT (interface), not the adapter.
 */
export class UserService {
  constructor(private readonly userRepository: UserRepository) {}

  getAllUsers(): ResultAsync<User[], AppError> {
    return this.userRepository.findAll();
  }

  getUserById(id: string): ResultAsync<User | null, AppError> {
    return this.userRepository.findById(id);
  }

  createUser(username: string, password: string): ResultAsync<User, AppError> {
    const user = User.create(username, password);
    return this.userRepository.save(user);
  }

  deleteUser(id: string): ResultAsync<void, AppError> {
    return this.userRepository.delete(id);
  }
}
