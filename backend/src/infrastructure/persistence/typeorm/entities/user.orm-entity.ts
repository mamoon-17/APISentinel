import { ObjectId } from "mongodb";
import { Column, Entity, ObjectIdColumn } from "typeorm";

/**
 * TypeORM Entity - Infrastructure concern with ORM decorators.
 * This is NOT the domain entity - it's the persistence representation.
 */
@Entity("user")
export class UserOrmEntity {
  @ObjectIdColumn()
  _id: ObjectId;

  @Column()
  id: string;

  @Column()
  username: string;

  @Column()
  password: string;

  @Column({ nullable: true })
  email: string | null;

  @Column({ nullable: true })
  googleId: string | null;

  @Column({ nullable: true })
  name: string | null;

  @Column({ nullable: true })
  avatarUrl: string | null;
}
