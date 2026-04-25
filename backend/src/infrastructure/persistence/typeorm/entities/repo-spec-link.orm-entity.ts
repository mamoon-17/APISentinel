import { ObjectId } from "mongodb";
import { Column, Entity, ObjectIdColumn } from "typeorm";

@Entity("repo_spec_links")
export class RepoSpecLinkOrmEntity {
  @ObjectIdColumn()
  _id: ObjectId;

  @Column()
  id: string;

  @Column()
  repositoryId: string;

  @Column()
  specId: string;

  @Column()
  linkedAt: Date;
}
