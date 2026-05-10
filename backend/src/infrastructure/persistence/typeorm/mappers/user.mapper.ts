import crypto from "crypto";
import { User } from "../../../../domain/user";
import { UserOrmEntity } from "../entities/user.orm-entity";

/**
 * Mapper - Converts between Domain entities and ORM entities.
 * Keeps the domain clean from persistence concerns.
 */
export class UserMapper {
  static toDomain(ormEntity: UserOrmEntity): User {
    return new User(
      ormEntity.id ?? ormEntity._id?.toHexString() ?? "",
      ormEntity.username,
      ormEntity.password,
      ormEntity.email ?? null,
      ormEntity.googleId ?? null,
      ormEntity.githubId ?? null,
      ormEntity.githubLogin ?? null,
      ormEntity.githubAccessToken ?? null,
      ormEntity.name ?? null,
      ormEntity.avatarUrl ?? null,
    );
  }

  static toOrm(domain: User): UserOrmEntity {
    const orm = new UserOrmEntity();
    orm.id = domain.id || crypto.randomUUID();
    orm.username = domain.username;
    orm.password = domain.password;
    orm.email = domain.email;
    orm.googleId = domain.googleId;
    orm.githubId = domain.githubId;
    orm.githubLogin = domain.githubLogin;
    orm.githubAccessToken = domain.githubAccessToken;
    orm.name = domain.name;
    orm.avatarUrl = domain.avatarUrl;
    return orm;
  }
}
