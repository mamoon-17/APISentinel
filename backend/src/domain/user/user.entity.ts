/**
 * Domain Entity - Pure business object, no framework dependencies.
 * This is what the business logic works with.
 */
export class User {
  constructor(
    public readonly id: string,
    public readonly username: string,
    public readonly password: string,
    public readonly email: string | null = null,
    public readonly googleId: string | null = null,
    public readonly githubId: string | null = null,
    public readonly githubLogin: string | null = null,
    public readonly githubAccessToken: string | null = null,
    public readonly name: string | null = null,
    public readonly avatarUrl: string | null = null,
  ) {}

  /**
   * Factory method for creating a new user (before persistence)
   */
  static create(
    username: string,
    password: string,
    email: string | null = null,
    googleId: string | null = null,
    githubId: string | null = null,
    githubLogin: string | null = null,
    githubAccessToken: string | null = null,
    name: string | null = null,
    avatarUrl: string | null = null,
  ): User {
    return new User(
      "",
      username,
      password,
      email,
      googleId,
      githubId,
      githubLogin,
      githubAccessToken,
      name,
      avatarUrl,
    );
  }
}
