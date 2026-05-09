import { ObjectId } from "mongodb";
import { Column, Entity, ObjectIdColumn } from "typeorm";

@Entity("user_linked_public_repo")
export class UserLinkedPublicRepoOrmEntity {
  @ObjectIdColumn()
  _id: ObjectId;

  @Column()
  id: string;

  @Column()
  userId: string;

  @Column()
  repoId: string;

  @Column()
  name: string;

  @Column()
  fullName: string;

  @Column()
  url: string;

  @Column({ nullable: true })
  description: string | null;

  @Column()
  isPrivate: boolean;

  @Column()
  isFork: boolean;

  @Column()
  stars: number;

  @Column()
  updatedAt: string;

  @Column()
  linkedAt: string;
}
