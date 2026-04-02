import { User } from "../../../../domain/user";
import { UserOrmEntity } from "../entities/user.orm-entity";

/**
 * Mapper - Converts between Domain entities and ORM entities.
 * Keeps the domain clean from persistence concerns.
 */
export class UserMapper {
  static toDomain(ormEntity: UserOrmEntity): User {
    return new User(ormEntity.id, ormEntity.username, ormEntity.password);
  }

  static toOrm(domain: User): UserOrmEntity {
    const orm = new UserOrmEntity();
    if (domain.id) {
      orm.id = domain.id;
    }
    orm.username = domain.username;
    orm.password = domain.password;
    return orm;
  }
}
