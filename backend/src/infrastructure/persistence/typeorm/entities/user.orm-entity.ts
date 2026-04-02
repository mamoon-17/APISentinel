import { Column, Entity, PrimaryGeneratedColumn } from "typeorm";

/**
 * TypeORM Entity - Infrastructure concern with ORM decorators.
 * This is NOT the domain entity - it's the persistence representation.
 */
@Entity("user")
export class UserOrmEntity {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column()
  username: string;

  @Column()
  password: string;
}
