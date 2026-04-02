/**
 * Domain Entity - Pure business object, no framework dependencies.
 * This is what the business logic works with.
 */
export class User {
  constructor(
    public readonly id: string,
    public readonly username: string,
    public readonly password: string,
  ) {}

  /**
   * Factory method for creating a new user (before persistence)
   */
  static create(username: string, password: string): User {
    return new User("", username, password);
  }
}
