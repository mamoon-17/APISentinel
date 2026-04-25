import crypto from "crypto";

/**
 * Represents an explicit link between a GitHub repository and a spec.
 * A repository can be linked to one spec at a time.
 * A spec can be linked to many repositories.
 */
export class RepoSpecLink {
  constructor(
    public readonly id: string,
    public readonly repositoryId: string,
    public readonly specId: string,
    public readonly linkedAt: Date,
  ) {}

  static createNew(repositoryId: string, specId: string): RepoSpecLink {
    return new RepoSpecLink(
      crypto.randomUUID(),
      repositoryId,
      specId,
      new Date(),
    );
  }
}
